'use client';

/**
 * usePoseDetector — React hook for continuous pose detection.
 *
 * Wraps the PoseDetector singleton with a requestAnimationFrame detection
 * loop. Provides landmarks on every frame via a callback, and exposes
 * init/start/stop lifecycle methods.
 *
 * Usage:
 *   const pose = usePoseDetector();
 *   await pose.init();
 *   pose.startDetection(videoRef.current, (landmarks) => { ... });
 *   // auto-cleaned on unmount
 */
import { useRef, useState, useCallback, useEffect } from 'react';
import { PoseDetector } from './pose-detector';
import type { PoseLandmarks } from '@/modules/pose/types';

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

      const detectLoop = () => {
        if (!detectorRef.current?.isReady || !videoRef.current) return;

        const timestamp = performance.now();
        const result = detectorRef.current.detectForVideo(videoRef.current, timestamp);

        callbackRef.current?.(result?.landmarks ?? null, timestamp);

        rafRef.current = requestAnimationFrame(detectLoop);
      };

      detectLoop();
    },
    [],
  );

  const stopDetection = useCallback(() => {
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
