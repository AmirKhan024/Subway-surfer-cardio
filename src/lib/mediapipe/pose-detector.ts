/**
 * PoseDetector — Singleton wrapper around the PoseEngine.
 *
 * Ensures only one MediaPipe PoseLandmarker instance exists at a time.
 * Games should use the `usePoseDetector` hook (use-pose.ts) instead of
 * instantiating this directly — this module handles lifecycle.
 *
 * Wraps: src/modules/pose/engine.ts (PoseEngine)
 */
import { PoseEngine } from '@/modules/pose/engine';
import type { PoseCallback, PoseEngineConfig, PoseResult } from '@/modules/pose/types';

/**
 * Default config — uses CDN for WASM + model to avoid requiring local
 * file downloads. PoseEngine defaults already point to CDN; we pass an
 * empty override so the engine's own defaults take effect.
 */
const DEFAULT_CONFIG: Partial<PoseEngineConfig> = {
  delegate: 'GPU',
  numPoses: 1,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
};

let _instance: PoseDetector | null = null;

export class PoseDetector {
  private engine: PoseEngine;
  private _initialized = false;
  private _initializing: Promise<void> | null = null;

  private constructor(config: Partial<PoseEngineConfig> = {}) {
    this.engine = new PoseEngine({ ...DEFAULT_CONFIG, ...config });
  }

  /**
   * Get or create the singleton PoseDetector instance.
   * If a previous instance was destroyed, creates a fresh one.
   */
  static getInstance(config?: Partial<PoseEngineConfig>): PoseDetector {
    if (!_instance) {
      _instance = new PoseDetector(config);
    }
    return _instance;
  }

  /**
   * Initialize the MediaPipe model. Safe to call multiple times —
   * returns immediately if already initialized or in progress.
   */
  async init(): Promise<void> {
    if (this._initialized) return;
    if (this._initializing) {
      await this._initializing;
      return;
    }

    this._initializing = this.engine.init();
    try {
      await this._initializing;
      this._initialized = true;
    } finally {
      this._initializing = null;
    }
  }

  /**
   * Run pose detection on a single video frame.
   * Returns landmarks for the first detected person, or null.
   */
  detectForVideo(video: HTMLVideoElement, timestamp: number): PoseResult | null {
    if (!this._initialized) return null;
    return this.engine.detectForVideo(video, timestamp);
  }

  /** Register a callback invoked after each detection */
  onResults(callback: PoseCallback): void {
    this.engine.onResults(callback);
  }

  /** Whether the model is loaded and ready for detection */
  get isReady(): boolean {
    return this._initialized && this.engine.isReady;
  }

  /** Tear down the model and release the singleton */
  destroy(): void {
    this.engine.destroy();
    this._initialized = false;
    this._initializing = null;
    _instance = null;
  }
}
