// [NEW] Kriya Gap Bridge v5 - GameEngine interface and types

import type { RawGameData } from '@/types/raw-data';

/** Normalized landmark from MediaPipe PoseLandmarker */
export interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

/** MediaPipe Pose Landmark indices */
export const LM = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

/** Game metrics displayed on HUD during play */
export interface HudMetrics {
  score?: number | string;
  timer?: number | string | { elapsed: number; total: number };
  label?: string;
  primary?: { label: string; value: number | string; color?: string };
  secondary?: { label: string; value: number | string; color?: string };
  /** Live rep-intensity 0-100. Reaches 100 exactly when a proper rep registers. */
  repProgressPct?: number;
  /** Rep count displayed above the intensity gauge. */
  repsDisplay?: number;
  [key: string]: unknown;
}

/** Alias for backward compat */
export type GameMetrics = HudMetrics;

/** Calibration state reported by engine */
export interface CalibrationStatus {
  isCalibrated?: boolean;
  isReady?: boolean;
  progress?: number; // 0-1
  feedback?: string;
  message?: string;
  framesReady?: number;
  requiredFrames?: number;
  /** Set when calibration timed out — the layer shows a tappable "Tap to retry". */
  isTimedOut?: boolean;
  [key: string]: unknown;
}

/** Alias for backward compat */
export type CalibrationState = CalibrationStatus;

/** Interface that every per-game engine must implement */
export interface GameEngine {
  /** One-time reset - set up test-specific state */
  reset(): void;

  /** Process calibration frame */
  processCalibration(landmarks: NormalizedLandmark[]): CalibrationStatus;

  /** Called every frame with pose landmarks */
  processFrame(landmarks: NormalizedLandmark[], timestampMs: number): void;

  /** Render overlays on canvas */
  render(ctx: CanvasRenderingContext2D, width: number, height: number): void;

  /** Current game metrics for HUD */
  getHudMetrics(): HudMetrics;

  /** Whether game has auto-completed (e.g. timer expired) */
  isComplete(): boolean;

  /** Produce raw game data for score submission */
  getRawData(): RawGameData | Record<string, unknown>;

  /** Clean up resources */
  destroy(): void;
}
