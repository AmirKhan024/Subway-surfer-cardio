'use client';

/**
 * useCamera — React hook for camera stream management.
 *
 * Wraps the CameraManager from src/modules/camera/camera.ts with
 * React-friendly state and automatic cleanup on unmount.
 *
 * Usage:
 *   const camera = useCamera();
 *   await camera.start(videoRef.current);
 *   // ...
 *   camera.stop(); // or auto-cleaned on unmount
 */
import { useRef, useState, useCallback, useEffect } from 'react';
import { CameraManager } from '@/modules/camera/camera';

export interface UseCameraReturn {
  /** Start the camera stream on the given video element */
  start: (videoElement: HTMLVideoElement) => Promise<void>;
  /** Stop the camera stream and release the video element */
  stop: () => void;
  /** Whether the camera is currently streaming */
  isRunning: boolean;
  /** Error message if camera init failed (e.g., permission denied) */
  error: string | null;
  /** The underlying CameraManager (for advanced use) */
  manager: CameraManager | null;
}

export function useCamera(): UseCameraReturn {
  const managerRef = useRef<CameraManager | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getManager = useCallback(() => {
    if (!managerRef.current) {
      managerRef.current = new CameraManager();
    }
    return managerRef.current;
  }, []);

  const start = useCallback(async (videoElement: HTMLVideoElement) => {
    setError(null);
    try {
      const manager = getManager();
      await manager.start(videoElement);
      setIsRunning(true);
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Camera permission denied. Please allow camera access and try again.'
          : err instanceof DOMException && err.name === 'NotFoundError'
          ? 'No camera found. Please connect a camera and try again.'
          : err instanceof Error
          ? err.message
          : 'Failed to start camera';
      setError(message);
      setIsRunning(false);
      throw err;
    }
  }, [getManager]);

  const stop = useCallback(() => {
    managerRef.current?.stop();
    setIsRunning(false);
  }, []);

  // Auto-cleanup on unmount
  useEffect(() => {
    return () => {
      managerRef.current?.stop();
      managerRef.current = null;
    };
  }, []);

  return {
    start,
    stop,
    isRunning,
    error,
    manager: managerRef.current,
  };
}
