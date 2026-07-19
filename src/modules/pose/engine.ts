import type { PoseLandmarks, PoseCallback, PoseEngineConfig, PoseResult } from './types';

// We dynamically import to avoid SSR issues
let PoseLandmarker: unknown = null;
let FilesetResolver: unknown = null;

/** CDN paths — used when local WASM/model files are not available */
const CDN_WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm';
const CDN_MODEL_PATH = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';

const DEFAULT_CONFIG: PoseEngineConfig = {
  wasmPath: CDN_WASM_PATH,
  modelPath: CDN_MODEL_PATH,
  delegate: 'GPU',
  numPoses: 1,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.6,
};

export class PoseEngine {
  private landmarker: unknown = null;
  private callback: PoseCallback | null = null;
  private config: PoseEngineConfig;
  private _destroyed = false;
  private _lastTimestamp = -1;

  constructor(config: Partial<PoseEngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async init(): Promise<void> {
    if (this._destroyed) throw new Error('PoseEngine destroyed');

    // Dynamic import to avoid SSR
    const vision = await import('@mediapipe/tasks-vision');
    PoseLandmarker = vision.PoseLandmarker;
    FilesetResolver = vision.FilesetResolver;

    const filesetResolver = await (FilesetResolver as unknown as { forVisionTasks: (path: string) => Promise<unknown> }).forVisionTasks(this.config.wasmPath!);

    this.landmarker = await (PoseLandmarker as unknown as { createFromOptions: (resolver: unknown, config: unknown) => Promise<unknown> }).createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: this.config.modelPath!,
        delegate: this.config.delegate,
      },
      runningMode: 'VIDEO',
      numPoses: this.config.numPoses,
      minPoseDetectionConfidence: this.config.minDetectionConfidence,
      minPosePresenceConfidence: this.config.minDetectionConfidence,
      minTrackingConfidence: this.config.minTrackingConfidence,
    });
  }

  onResults(callback: PoseCallback): void {
    this.callback = callback;
  }

  /**
   * Accepts a video element (main thread) or an ImageBitmap (Web Worker —
   * the worker has no DOM; the main thread grabs frames and transfers
   * bitmaps in). MediaPipe's real detectForVideo takes either (ImageSource).
   */
  detectForVideo(video: HTMLVideoElement | ImageBitmap, timestamp: number): PoseResult | null {
    if (!this.landmarker || this._destroyed) return null;

    // Ensure strictly increasing timestamps
    if (timestamp <= this._lastTimestamp) {
      timestamp = this._lastTimestamp + 1;
    }
    this._lastTimestamp = timestamp;

    try {
      const result = (this.landmarker as unknown as { detectForVideo: (video: HTMLVideoElement | ImageBitmap, timestamp: number) => unknown }).detectForVideo(video, timestamp);
      const detectionResult = result as unknown as { landmarks?: Array<Array<{ x: number; y: number; z: number; visibility?: number }>> };

      if (detectionResult.landmarks && detectionResult.landmarks.length > 0) {
        const landmarks: PoseLandmarks = detectionResult.landmarks[0].map((lm: { x: number; y: number; z: number; visibility?: number }) => ({
          x: lm.x,
          y: lm.y,
          z: lm.z,
          visibility: lm.visibility ?? 0,
        }));

        const poseResult: PoseResult = { landmarks, timestamp };
        this.callback?.(poseResult);
        return poseResult;
      }

      this.callback?.(null);
      return null;
    } catch (err) {
      console.warn('[PoseEngine] Detection error:', err);
      return null;
    }
  }

  destroy(): void {
    this._destroyed = true;
    if (this.landmarker) {
      (this.landmarker as unknown as { close: () => void }).close();
      this.landmarker = null;
    }
    this.callback = null;
  }

  get isReady(): boolean {
    return this.landmarker !== null && !this._destroyed;
  }
}
