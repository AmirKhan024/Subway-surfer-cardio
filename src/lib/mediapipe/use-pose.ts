'use client';

/**
 * usePoseDetector — React hook for continuous pose detection.
 *
 * Wraps the PoseDetector singleton with a detection loop paced to the REAL
 * camera frame rate, not the display refresh rate:
 *  - primary: video.requestVideoFrameCallback fires once per decoded camera
 *    frame (~30fps) — half the main-thread inference load of the old
 *    unthrottled 60fps rAF loop, which starved the render loop in bursts.
 *  - fallback: a rAF loop throttled to ~33fps (old browsers without rVFC).
 *  - watchdog: the pose <video> is display:none, and some browsers (Safari
 *    lineage) may not fire rVFC for non-rendered videos — if no rVFC tick
 *    arrives for 750ms while the tab is visible, we permanently switch that
 *    session to the throttled-rAF fallback. klog('POSE_LOOP') records which
 *    mode actually ran (shows up in the copied diagnostics blob).
 *
 * Timestamps stay on performance.now(): the PoseDetector singleton survives
 * across layers and PoseEngine enforces strictly-increasing timestamps —
 * switching timebases (e.g. to metadata.mediaTime) would break its guard.
 *
 * Usage:
 *   const pose = usePoseDetector();
 *   await pose.init();
 *   pose.startDetection(videoRef.current, (landmarks) => { ... });
 *   // auto-cleaned on unmount
 */
import { useRef, useState, useCallback, useEffect } from 'react';
import { PoseDetector } from './pose-detector';
import { klog } from '@/lib/debug/run-logger';
import type { PoseLandmarks } from '@/modules/pose/types';

/** fallback rAF loop: skip detections closer together than this (~33fps) */
const RAF_MIN_GAP_MS = 30;
/** watchdog: no rVFC tick for this long (tab visible) → rVFC isn't firing */
const RVFC_STALL_MS = 750;

/** Callback for each detection frame */
export type LandmarkCallback = (landmarks: PoseLandmarks | null, timestamp: number) => void;

export interface UsePoseDetectorReturn {
  /** Initialize the MediaPipe model (call once before startDetection) */
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
  const rafRef = useRef<number | null>(null);
  const rvfcRef = useRef<number | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** generation token: bumped on every start/stop — a stale closure from a
   *  previous session (StrictMode double-boot) can never re-register */
  const genRef = useRef(0);
  const lastVfcAtRef = useRef(0);
  const callbackRef = useRef<LandmarkCallback | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const init = useCallback(async () => {
    setError(null);
    try {
      const detector = PoseDetector.getInstance();
      detectorRef.current = detector;
      await detector.init();
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
      if (!detectorRef.current?.isReady) {
        console.warn('[usePoseDetector] Cannot start — model not ready');
        return;
      }

      videoRef.current = video;
      callbackRef.current = onFrame;
      setIsDetecting(true);
      const gen = ++genRef.current;

      /** one inference; false = this session is over (stale gen / torn down) */
      const detectOnce = (): boolean => {
        if (genRef.current !== gen || !detectorRef.current?.isReady || !videoRef.current) {
          return false;
        }
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

      // preserve the old synchronous first detect (rVFC waits for the NEXT
      // presented frame; the engine's timestamp guard makes this safe)
      detectOnce();

      if (typeof video.requestVideoFrameCallback === 'function') {
        lastVfcAtRef.current = performance.now();
        const onVideoFrame = () => {
          if (genRef.current !== gen || !videoRef.current) return;
          lastVfcAtRef.current = performance.now();
          detectOnce();
          if (genRef.current !== gen || !videoRef.current) return;
          rvfcRef.current = videoRef.current.requestVideoFrameCallback(onVideoFrame);
        };
        rvfcRef.current = video.requestVideoFrameCallback(onVideoFrame);
        klog('POSE_LOOP', { mode: 'rvfc' });

        // watchdog: some browsers may never fire rVFC for a display:none
        // video — detect the stall and fall back so detection can't die
        watchdogRef.current = setInterval(() => {
          if (genRef.current !== gen) {
            if (watchdogRef.current !== null) clearInterval(watchdogRef.current);
            watchdogRef.current = null;
            return;
          }
          if (
            document.visibilityState === 'visible' &&
            performance.now() - lastVfcAtRef.current > RVFC_STALL_MS
          ) {
            if (watchdogRef.current !== null) clearInterval(watchdogRef.current);
            watchdogRef.current = null;
            if (rvfcRef.current !== null && videoRef.current) {
              videoRef.current.cancelVideoFrameCallback(rvfcRef.current);
            }
            rvfcRef.current = null;
            klog('POSE_LOOP', { mode: 'rvfc->raf-watchdog' });
            startThrottledRaf();
          }
        }, 1000);
      } else {
        klog('POSE_LOOP', { mode: 'raf-throttled' });
        startThrottledRaf();
      }
    },
    [],
  );

  const stopDetection = useCallback(() => {
    genRef.current++; // kill any in-flight closure regardless of handles
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
    detectorRef.current?.destroy();
    detectorRef.current = null;
    setIsReady(false);
  }, [stopDetection]);

  // Auto-cleanup on unmount
  useEffect(() => {
    return () => {
      genRef.current++;
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
      // Don't destroy the singleton on unmount — it may be reused
      // by the next layer (calibration → playing). Only stopDetection.
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
