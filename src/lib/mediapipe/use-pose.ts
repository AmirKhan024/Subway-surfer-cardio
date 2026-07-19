'use client';

/**
 * usePoseDetector — React hook for continuous pose detection.
 *
 * Two backends, chosen at init (fallback ladder: worker+GPU → main-thread):
 *  - 'worker': the whole MediaPipe stack runs in a Web Worker
 *    (pose.worker.ts) — the main thread only grabs camera frames
 *    (createImageBitmap, transferred) and receives plain-POJO landmarks.
 *    Inference NEVER blocks the render thread. Backpressure: at most ONE
 *    frame in flight; extra camera frames are dropped, not queued.
 *  - 'main': the previous synchronous PoseDetector singleton path — the
 *    known-good baseline for browsers without worker-GL/createImageBitmap
 *    (Safari <17 lineage) and the failover target if the worker dies.
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
import { poseWorkerClient, setPoseBackend } from './pose-worker-client';
import { klog } from '@/lib/debug/run-logger';
import type { PoseLandmarks } from '@/modules/pose/types';

/** fallback rAF loop: skip detections closer together than this (~33fps) */
const RAF_MIN_GAP_MS = 30;
/** watchdog: no rVFC tick for this long (tab visible) → rVFC isn't firing */
const RVFC_STALL_MS = 750;
/** watchdog: a frame in flight with no worker result for this long → dead */
const WORKER_STALL_MS = 3000;

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
  const [isReady, setIsReady] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Terminate the worker path and hot-swap to the main-thread detector
   *  (one-time model-load hiccup is acceptable; input resumes on ready). */
  const failoverToMain = useCallback((reason: string) => {
    if (backendRef.current !== 'worker') return;
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

  const init = useCallback(async () => {
    setError(null);
    try {
      if (typeof Worker !== 'undefined' && typeof createImageBitmap === 'function') {
        try {
          await poseWorkerClient.init();
          backendRef.current = 'worker';
          setPoseBackend('worker-gpu', 'init');
          // one handler for the hook's lifetime — the gen echo drops stale
          // sessions' results; inFlight always clears so it can't wedge
          poseWorkerClient.onResult((r) => {
            inFlightRef.current = false;
            if (r.gen !== genRef.current) return;
            callbackRef.current?.(r.landmarks, r.timestamp);
          });
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

      /** one detection tick; false = this session is over (torn down) */
      const detectOnce = (): boolean => {
        if (genRef.current !== gen || !videoRef.current) return false;
        if (backendRef.current === 'worker') {
          if (inFlightRef.current) return true; // backpressure: drop frame
          inFlightRef.current = true;
          const timestamp = performance.now();
          lastSentAtRef.current = timestamp;
          createImageBitmap(videoRef.current)
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
        const result = detectorRef.current.detectForVideo(videoRef.current, timestamp);
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
        if (
          backendRef.current === 'worker' &&
          inFlightRef.current &&
          now - lastSentAtRef.current > WORKER_STALL_MS
        ) {
          failoverToMain('worker-stall');
        }
      }, 1000);
    },
    [failoverToMain],
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
