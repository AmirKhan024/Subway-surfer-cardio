/**
 * MODE_MEDIA — single source of truth for mode-conditional media.
 *
 * Pure data + pure helpers only: no DOM, no side effects, node-testable.
 * The browser-side loading lives in cue-preloader.ts; this module must stay
 * importable from tests and from the (SSR-evaluated) component tree.
 *
 * "up" = the jump/extension cue (engine cue.type 'hurdle'),
 * "down" = the squat/flexion cue (engine cue.type 'beam').
 */
import type { ControlMode, CueState } from '@/modules/game/engines/runner-engine';

export type CueDirection = 'up' | 'down';

export interface CueAsset {
  /** Extensionless base URL — the loader tries `${base}.webp` then `${base}.png`. */
  base: string;
  label: string;
}

export interface ModeMedia {
  demo: string;
  poster: string;
  up: CueAsset;
  down: CueAsset;
}

const BODY: ModeMedia = {
  demo: '/media/intro.mp4',
  poster: '/media/intro-poster.jpg',
  up: { base: '/media/cue-jump', label: 'JUMP' },
  down: { base: '/media/cue-squat', label: 'SQUAT' },
};

export const MODE_MEDIA = {
  pose: BODY,
  // keyboard reuses the Body set (same reference — preload dedups automatically)
  keyboard: BODY,
  head: {
    demo: '/media/neck-rom.mp4',
    poster: '/media/neck-rom-poster.jpg',
    up: { base: '/media/cue-neck-up', label: 'LOOK UP' },
    down: { base: '/media/cue-neck-down', label: 'LOOK DOWN' },
  },
} as const satisfies Record<ControlMode, ModeMedia>;

export function directionForCueType(type: CueState['type']): CueDirection {
  return type === 'hurdle' ? 'up' : 'down';
}

/** Ordered fallback chain: webp first, png for browsers that can't decode webp. */
export function candidateUrls(base: string): string[] {
  return [`${base}.webp`, `${base}.png`];
}

/**
 * Cue caption text. Low-impact swaps JUMP → HEEL RAISE for body/keyboard only;
 * head mode always reads LOOK UP / LOOK DOWN.
 */
export function cueLabel(
  mode: ControlMode,
  type: CueState['type'],
  lowImpact: boolean,
): string {
  const dir = directionForCueType(type);
  if (mode !== 'head' && dir === 'up' && lowImpact) return 'HEEL RAISE';
  return MODE_MEDIA[mode][dir].label;
}
