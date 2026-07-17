/**
 * Player profile persistence — shared by the setup screen and page shell.
 *
 * PlayMode is the UI-facing mode set; the engine's ControlMode additionally
 * keeps 'keyboard' as an internal/test-only input path (the vitest suite
 * drives it via setControlInput) — it is no longer offered in the product.
 */

export type PlayMode = 'pose' | 'head';

export interface RunnerProfile {
  age: number;
  gender: 'male' | 'female' | 'other';
  /** engine capability kept dormant — UI always saves false */
  lowImpact: boolean;
  /** camera-bob amplitude: 0.4 gentle default, 0 under reduced-motion */
  bobScale: number;
}

export const PROFILE_KEY = 'kr1-profile';

export function loadProfile(): RunnerProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as RunnerProfile;
    if (typeof p.age !== 'number' || p.age < 5 || p.age > 110) return null;
    return p;
  } catch {
    return null;
  }
}

export function saveProfile(p: RunnerProfile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable — session still works */
  }
}
