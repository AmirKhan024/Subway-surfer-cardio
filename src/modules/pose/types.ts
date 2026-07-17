export interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export type PoseLandmarks = NormalizedLandmark[];

export interface PoseResult {
  landmarks: PoseLandmarks;
  timestamp: number;
}

export type PoseCallback = (result: PoseResult | null) => void;

export interface PoseEngineConfig {
  wasmPath?: string;
  modelPath?: string;
  delegate?: 'CPU' | 'GPU';
  numPoses?: number;
  minDetectionConfidence?: number;
  minTrackingConfidence?: number;
}
