'use client';

/**
 * usePoseDetector — React hook for continuous pose detection.
 *
 * Two backends (ladder: worker+CPU → RESTART worker → main-thread only if a
 * worker can't exist at all):
 *  - 'worker': the whole MediaPipe stack runs in a Web Worker
 *    (pose.worker.ts, CPU delegate) — the main thread only grabs camera
 *    frames (createImageBitmap, downscaled to POSE_INPUT_WIDTH, transferred)
 *    and receives plain-POJO landmarks. Inference NEVER blocks the render
 *    thread. Backpressure: at most ONE frame in flight; extras are dropped.
 *  - 'main': the synchronous PoseDetector singleton — for browsers without
 *    Worker/createImageBitmap (Safari <17 lineage) ONLY.
 *
 * CRITICAL: an unhealthy worker (wedged, or returning zero results) is
 * RESTARTED IN THE WORKER — it must NOT fail over to the main thread.
 * Main-thread inference starves the render loop; that cascade once took
 * FRAME_STATS from 113fps to 28fps and added a ~5s model-reload freeze.
 * Off-thread CPU beats on-thread GPU here: the render is what the user sees.
 *
 * Cadence is paced to the REAL camera frame rate, not the display refresh:
 *  - primary: video.requestVideoFrameCallback (~once per decoded frame)
 *  - fallback: rAF throttled to ~33fps (old browsers)
 *  - a 1s watchdog handles BOTH stall cases: rVFC never firing for a
 *    display:none video (→ throttled rAF), and a wedged worker (no result
 *    for 3s with a frame in flight → terminate + main-thread failover).
 *
 * Timestamps: main-thread performance.now() is passed through the worker
 * and echoed back — the worker never stamps with its own clock (different
 * timeOrigin would trip PoseEngine's strictly-increasing guard).
 * klog('POSE_LOOP'/'POSE_BACKEND') record which paths actually ran.
 */
import { useRef, useState, useCallback, useEffect } from 'react';
import { PoseDetector } from './pose-detector';
import { poseWorkerClient, setPoseBackend, getWorkerDelegate } from './pose-worker-client';
import { isDebug, klog } from '@/lib/debug/run-logger';
import type { PoseLandmarks } from '@/modules/pose/types';

/** fallback rAF loop: skip detections closer together than this (~33fps) */
const RAF_MIN_GAP_MS = 30;
/**
 * Downscale every camera frame to this width BEFORE inference. Full-body
 * pose landmarks don't need native cam resolution (~1396px on the test
 * phone), and inference cost scales with pixel count — on the CPU delegate
 * this roughly halves (or better) the per-frame time. Landmarks are
 * normalized 0..1, so the projection stays correct as long as we preserve
 * the camera's aspect ratio.
 *
 * NOTE: this is the tuning knob if low-res makes crouch/jump detection
 * noisy near the SQUAT_CLEAR / jump thresholds — bump the WIDTH, never the
 * detection thresholds. Target is detectFps ≥ ~28 on the primary phone.
 */
const POSE_INPUT_WIDTH = 288;

/** createImageBitmap resize opts targeting POSE_INPUT_WIDTH, aspect-preserved;
 *  undefined when the video isn't measurable yet or is already small enough. */
function poseResizeOpts(video: HTMLVideoElement): ImageBitmapOptions | undefined {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh || vw <= POSE_INPUT_WIDTH) return undefined;
  return {
    resizeWidth: POSE_INPUT_WIDTH,
    resizeHeight: Math.round((POSE_INPUT_WIDTH * vh) / vw),
    resizeQuality: 'low',
  };
}
/** watchdog: no rVFC tick for this long (tab visible) → rVFC isn't firing */
const RVFC_STALL_MS = 750;
/** watchdog: a frame in flight with no worker result for this long → dead */
const WORKER_STALL_MS = 3000;
/** watchdog: fed frames this long with ZERO results ever → worker is broken
 *  (GPU-in-worker inits fine then yields nothing). Restart it, don't wait
 *  for the 3s stall and don't fall back to the main thread. */
const WORKER_NO_RESULT_MS = 1200;

/** Callback for each detection frame */
export type LandmarkCallback = (landmarks: PoseLandmarks | null, timestamp: number) => void;

export interface UsePoseDetectorReturn {
  /** Initialize the pose backend (call once before startDetection) */
  init: () => Promise<void>;
  /** Start the continuous detection loop on a video element */
  startDetection: (video: HTMLVideoElement, onFrame: LandmarkCallback) => void;
  /** Stop the detection loop (call when leaving calibration/playing) */
  stopDetection: () => void;
  /** Tear down the model entirely */
  destroy: () => void;
  /** Whether the model is loaded */
  isReady: boolean;
  /** Whether the detection loop is running */
  isDetecting: boolean;
  /** Error message if init failed */
  error: string | null;
}

export function usePoseDetector(): UsePoseDetectorReturn {
  const detectorRef = useRef<PoseDetector | null>(null);
  const backendRef = useRef<'worker' | 'main'>('main');
  const rafRef = useRef<number | null>(null);
  const rvfcRef = useRef<number | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** generation token: bumped on every start/stop — a stale closure from a
   *  previous session (StrictMode double-boot) can never re-register */
  const genRef = useRef(0);
  const lastVfcAtRef = useRef(0);
  /** worker backpressure: one frame in flight max; extras are dropped */
  const inFlightRef = useRef(false);
  const lastSentAtRef = useRef(0);
  const callbackRef = useRef<LandmarkCallback | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  /** reusable canvas for the main-thread path's frame downscale (§1) — the
   *  worker path resizes via createImageBitmap; the sync main path can't, so
   *  it draws the video into this small canvas and detects on that instead */
  const scaleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /** POSE_TIMING aggregation (~1s windows, klogged only under debug):
   *  grabs = cadence ticks (camera rate), results = actual inferences,
   *  ms = inference time (worker inferMs / main sync duration) */
  const timingRef = useRef({ windowStart: 0, grabs: 0, results: 0, sumMs: 0, worstMs: 0 });
  const [isReady, setIsReady] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** worker restart in progress — skip frames, don't re-trigger the watchdog */
  const restartingRef = useRef(false);
  /** has the CURRENT worker ever returned a result? (health check) */
  const sawResultRef = useRef(false);
  /** when the current worker started being fed frames (health-check window) */
  const workerFedAtRef = useRef(0);

  /** The worker's result handler. Extracted so a worker RESTART can
   *  re-register it (destroy() clears the client's callback). */
  const registerWorkerResult = useCallback(() => {
    poseWorkerClient.onResult((r) => {
      inFlightRef.current = false;
      sawResultRef.current = true;
      if (r.gen !== genRef.current) return;
      const timing = timingRef.current;
      timing.results += 1;
      timing.sumMs += r.inferMs;
      if (r.inferMs > timing.worstMs) timing.worstMs = r.inferMs;
      callbackRef.current?.(r.landmarks, r.timestamp);
    });
  }, []);

  /** LAST RESORT ONLY — main-thread pose starves the render (that cascade
   *  took FRAME_STATS from 113fps to 28fps). Reserved for "a worker cannot be
   *  created at all" (no Worker / no createImageBitmap / re-init failed).
   *  A merely UNHEALTHY worker must be restarted, not moved here. */
  const failoverToMain = useCallback((reason: string) => {
    if (backendRef.current === 'main') return;
    backendRef.current = 'main';
    poseWorkerClient.destroy();
    inFlightRef.current = false;
    setPoseBackend('main-gpu', reason);
    const detector = PoseDetector.getInstance();
    detectorRef.current = detector;
    if (!detector.isReady) {
      detector.init().catch((err) => {
        console.warn('[usePoseDetector] main-thread fallback init failed:', err);
      });
    }
  }, []);

  /** A stalled/resultless WORKER is a WORKER problem — fix it IN the worker.
   *  Restarting keeps the model load off the render thread (the old
   *  main-thread failover is where the ~5s worstMs freeze came from). */
  const restartWorker = useCallback(
    (reason: string) => {
      if (backendRef.current !== 'worker' || restartingRef.current) return;
      restartingRef.current = true;
      klog('POSE_WORKER_RESTART', { reason });
      poseWorkerClient.destroy();
      inFlightRef.current = false;
      sawResultRef.current = false;
      workerFedAtRef.current = 0;
      poseWorkerClient
        .init()
        .then(() => {
          registerWorkerResult();
          setPoseBackend(getWorkerDelegate() === 'GPU' ? 'worker-gpu' : 'worker-cpu', `restart:${reason}`);
        })
        .catch((err) => {
          // the worker genuinely cannot be created — only NOW go main-thread
          console.warn('[usePoseDetector] worker restart failed:', err);
          failoverToMain(`worker-restart-failed:${reason}`);
        })
        .finally(() => {
          restartingRef.current = false;
        });
    },
    [registerWorkerResult, failoverToMain],
  );

  const init = useCallback(async () => {
    setError(null);
    try {
      if (typeof Worker !== 'undefined' && typeof createImageBitmap === 'function') {
        try {
          await poseWorkerClient.init();
          backendRef.current = 'worker';
          // honest label from the delegate the worker actually loaded (CPU by
          // design — see pose.worker.ts initEngine).
          setPoseBackend(getWorkerDelegate() === 'GPU' ? 'worker-gpu' : 'worker-cpu', 'init');
          // the gen echo drops stale sessions' results; inFlight always
          // clears so it can't wedge
          registerWorkerResult();
          setIsReady(true);
          return;
        } catch (err) {
          console.warn('[usePoseDetector] worker init failed — main-thread fallback:', err);
        }
      }
      const detector = PoseDetector.getInstance();
      detectorRef.current = detector;
      await detector.init();
      backendRef.current = 'main';
      setPoseBackend('main-gpu', 'worker-unavailable');
      setIsReady(true);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to load pose detection model';
      setError(message);
      console.error('[usePoseDetector] Init failed:', err);
    }
  }, []);

  const startDetection = useCallback(
    (video: HTMLVideoElement, onFrame: LandmarkCallback) => {
      const backendReady =
        backendRef.current === 'worker'
          ? poseWorkerClient.isReady
          : !!detectorRef.current?.isReady;
      if (!backendReady) {
        console.warn('[usePoseDetector] Cannot start — model not ready');
        return;
      }

      videoRef.current = video;
      callbackRef.current = onFrame;
      setIsDetecting(true);
      const gen = ++genRef.current;
      inFlightRef.current = false;
      sawResultRef.current = false;
      workerFedAtRef.current = 0;

      /** one detection tick; false = this session is over (torn down) */
      const detectOnce = (): boolean => {
        if (genRef.current !== gen || !videoRef.current) return false;
        // POSE_TIMING window: camera-cadence ticks vs actual inferences
        const timing = timingRef.current;
        const tickAt = performance.now();
        if (timing.windowStart === 0) timing.windowStart = tickAt;
        timing.grabs += 1;
        if (tickAt - timing.windowStart >= 1000) {
          if (isDebug()) {
            const avg = timing.results > 0 ? timing.sumMs / timing.results : 0;
            klog('POSE_TIMING', {
              backend: backendRef.current,
              grabFps: timing.grabs,
              detectFps: timing.results,
              avgMs: Math.round(avg * 10) / 10,
              worstMs: Math.round(timing.worstMs * 10) / 10,
            });
          }
          timing.windowStart = tickAt;
          timing.grabs = 0;
          timing.results = 0;
          timing.sumMs = 0;
          timing.worstMs = 0;
        }
        if (backendRef.current === 'worker') {
          // mid-restart: no worker to send to. Skip WITHOUT setting inFlight,
          // or the stall watchdog would re-fire on a frame that never shipped.
          if (!poseWorkerClient.isReady) {
            inFlightRef.current = false;
            return true;
          }
          if (inFlightRef.current) return true; // backpressure: drop frame
          inFlightRef.current = true;
          const timestamp = performance.now();
          lastSentAtRef.current = timestamp;
          // health-check window opens on the first frame fed to this worker
          if (workerFedAtRef.current === 0) workerFedAtRef.current = timestamp;
          const opts = poseResizeOpts(videoRef.current);
          const grab = opts
            ? createImageBitmap(videoRef.current, opts)
            : createImageBitmap(videoRef.current);
          grab
            .then((bitmap) => {
              if (genRef.current !== gen) {
                bitmap.close();
                inFlightRef.current = false;
                return;
              }
              poseWorkerClient.detect(bitmap, timestamp, gen);
            })
            .catch(() => {
              // Safari <17: video frames unsupported as a bitmap source —
              // permanent main-thread fallback for this session
              inFlightRef.current = false;
              failoverToMain('createImageBitmap-unsupported');
            });
          return true;
        }
        // main-thread path. NOT-ready is "alive but warming up" (mid-session
        // failover re-downloads the model) — never kills the loop.
        if (!detectorRef.current?.isReady) return true;
        const timestamp = performance.now();
        // downscale to POSE_INPUT_WIDTH via a reusable canvas (drawImage is
        // cheap/GPU-accelerated); fall back to the raw video if not measurable
        const video = videoRef.current;
        const opts = poseResizeOpts(video);
        let source: HTMLVideoElement | HTMLCanvasElement = video;
        if (opts) {
          let canvas = scaleCanvasRef.current;
          if (!canvas) {
            canvas = document.createElement('canvas');
            scaleCanvasRef.current = canvas;
          }
          if (canvas.width !== opts.resizeWidth) canvas.width = opts.resizeWidth!;
          if (canvas.height !== opts.resizeHeight) canvas.height = opts.resizeHeight!;
          const g = canvas.getContext('2d');
          if (g) {
            g.drawImage(video, 0, 0, canvas.width, canvas.height);
            source = canvas;
          }
        }
        const result = detectorRef.current.detectForVideo(source, timestamp);
        const detectMs = performance.now() - timestamp;
        timing.results += 1;
        timing.sumMs += detectMs;
        if (detectMs > timing.worstMs) timing.worstMs = detectMs;
        callbackRef.current?.(result?.landmarks ?? null, timestamp);
        return true;
      };

      const startThrottledRaf = () => {
        let lastDetectAt = 0;
        const loop = () => {
          if (genRef.current !== gen) return;
          const now = performance.now();
          if (now - lastDetectAt >= RAF_MIN_GAP_MS) {
            lastDetectAt = now;
            if (!detectOnce()) return;
          }
          rafRef.current = requestAnimationFrame(loop);
        };
        loop();
      };

      // synchronous first tick (rVFC waits for the NEXT presented frame)
      detectOnce();

      let usingRvfc = false;
      if (typeof video.requestVideoFrameCallback === 'function') {
        usingRvfc = true;
        lastVfcAtRef.current = performance.now();
        const onVideoFrame = () => {
          if (genRef.current !== gen || !videoRef.current) return;
          lastVfcAtRef.current = performance.now();
          detectOnce();
          if (genRef.current !== gen || !videoRef.current) return;
          rvfcRef.current = videoRef.current.requestVideoFrameCallback(onVideoFrame);
        };
        rvfcRef.current = video.requestVideoFrameCallback(onVideoFrame);
        klog('POSE_LOOP', { mode: 'rvfc', backend: backendRef.current });
      } else {
        klog('POSE_LOOP', { mode: 'raf-throttled', backend: backendRef.current });
        startThrottledRaf();
      }

      // ONE 1s watchdog for both stall cases (rVFC-never-fires + dead worker)
      watchdogRef.current = setInterval(() => {
        if (genRef.current !== gen) {
          if (watchdogRef.current !== null) clearInterval(watchdogRef.current);
          watchdogRef.current = null;
          return;
        }
        const now = performance.now();
        if (
          usingRvfc &&
          document.visibilityState === 'visible' &&
          now - lastVfcAtRef.current > RVFC_STALL_MS
        ) {
          usingRvfc = false;
          if (rvfcRef.current !== null && videoRef.current) {
            videoRef.current.cancelVideoFrameCallback(rvfcRef.current);
          }
          rvfcRef.current = null;
          klog('POSE_LOOP', { mode: 'rvfc->raf-watchdog', backend: backendRef.current });
          startThrottledRaf();
        }
        // WORKER HEALTH — both branches RESTART THE WORKER; neither falls to
        // the main thread (main-thread pose starves the render).
        if (backendRef.current === 'worker' && !restartingRef.current) {
          // (a) wedged: a frame in flight with no reply for WORKER_STALL_MS
          if (inFlightRef.current && now - lastSentAtRef.current > WORKER_STALL_MS) {
            restartWorker('worker-stall');
          } else if (
            // (b) resultless: we've been feeding it frames but it has NEVER
            // returned a landmark set (the GPU-in-worker failure mode —
            // detectFps stuck at 0). Catches it in ~1s instead of 3s.
            !sawResultRef.current &&
            workerFedAtRef.current > 0 &&
            now - workerFedAtRef.current > WORKER_NO_RESULT_MS
          ) {
            restartWorker('worker-no-results');
          }
        }
      }, 1000);
    },
    [restartWorker],
  );

  const stopDetection = useCallback(() => {
    genRef.current++; // kill any in-flight closure regardless of handles
    inFlightRef.current = false;
    if (watchdogRef.current !== null) {
      clearInterval(watchdogRef.current);
      watchdogRef.current = null;
    }
    // cancel the rVFC handle BEFORE dropping the video reference
    if (rvfcRef.current !== null && videoRef.current) {
      videoRef.current.cancelVideoFrameCallback(rvfcRef.current);
    }
    rvfcRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    videoRef.current = null;
    callbackRef.current = null;
    setIsDetecting(false);
  }, []);

  const destroy = useCallback(() => {
    stopDetection();
    poseWorkerClient.destroy();
    detectorRef.current?.destroy();
    detectorRef.current = null;
    setPoseBackend('none', 'destroy');
    setIsReady(false);
  }, [stopDetection]);

  // Auto-cleanup on unmount
  useEffect(() => {
    return () => {
      genRef.current++;
      inFlightRef.current = false;
      if (watchdogRef.current !== null) {
        clearInterval(watchdogRef.current);
        watchdogRef.current = null;
      }
      if (rvfcRef.current !== null && videoRef.current) {
        videoRef.current.cancelVideoFrameCallback(rvfcRef.current);
        rvfcRef.current = null;
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      // Don't destroy the singletons (worker OR main detector) on unmount —
      // they may be reused by the next layer (calibration → playing).
      videoRef.current = null;
      callbackRef.current = null;
    };
  }, []);

  return {
    init,
    startDetection,
    stopDetection,
    destroy,
    isReady,
    isDetecting,
    error,
  };
}
