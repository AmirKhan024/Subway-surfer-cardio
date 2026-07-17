/**
 * Cue-icon preloader — module singleton, browser-only at the call sites.
 *
 * Icons are loaded AND decoded ahead of gameplay (start click / How-to-play
 * warm-up), so the HUD never pays a decode cost mid-run. The HUD reads
 * readiness synchronously via getReadyCueImage(); null means "render the
 * arrow glyph fallback" — the game is fully playable with zero images.
 *
 * img.decode() rejects on network failure AND on an undecodable format
 * (older iOS/tablets without WebP), so one mechanism covers preload,
 * webp→png fallback, and total failure.
 */
import type { ControlMode } from '@/modules/game/engines/runner-engine';
import { MODE_MEDIA, candidateUrls, type CueDirection } from './mode-media';

/** extensionless base → decoded, ready-to-paint URL */
const readySrc = new Map<string, string>();
/** bases currently loading — makes preloadCueImages idempotent under double-fire */
const inflight = new Set<string>();
/** keep decoded elements referenced so the bitmaps stay cached */
const retain: HTMLImageElement[] = [];

async function loadFirstDecodable(base: string): Promise<void> {
  for (const url of candidateUrls(base)) {
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      if (typeof img.decode === 'function') {
        await img.decode();
      } else {
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error(`load failed: ${url}`));
        });
      }
      retain.push(img);
      readySrc.set(base, url);
      return;
    } catch {
      // webp unsupported or 404 → try the next candidate
    }
  }
  // every candidate failed → base never becomes ready → arrow fallback
}

/** Fire-and-forget. Safe to call repeatedly and from SSR-evaluated code paths. */
export function preloadCueImages(mode: ControlMode): void {
  if (typeof window === 'undefined' || typeof Image === 'undefined') return;
  for (const dir of ['up', 'down'] as const) {
    const base = MODE_MEDIA[mode][dir].base;
    if (readySrc.has(base) || inflight.has(base)) continue;
    inflight.add(base);
    void loadFirstDecodable(base).finally(() => inflight.delete(base));
  }
}

/** Synchronous readiness check — null means the caller renders the arrow. */
export function getReadyCueImage(mode: ControlMode, dir: CueDirection): string | null {
  return readySrc.get(MODE_MEDIA[mode][dir].base) ?? null;
}
