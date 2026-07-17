import { describe, expect, it } from 'vitest';
import {
  MODE_MEDIA,
  candidateUrls,
  cueLabel,
  directionForCueType,
} from '../mode-media';

describe('MODE_MEDIA map', () => {
  it('keyboard reuses the pose (Body) set by reference', () => {
    expect(MODE_MEDIA.keyboard).toBe(MODE_MEDIA.pose);
  });

  it('head mode has its own neck assets', () => {
    expect(MODE_MEDIA.head.demo).toBe('/media/neck-rom.mp4');
    expect(MODE_MEDIA.head.up.base).toBe('/media/cue-neck-up');
    expect(MODE_MEDIA.head.down.base).toBe('/media/cue-neck-down');
  });

  it('all asset URLs are root-relative under /media/', () => {
    for (const media of Object.values(MODE_MEDIA)) {
      for (const url of [media.demo, media.poster, media.up.base, media.down.base]) {
        expect(url.startsWith('/media/')).toBe(true);
      }
    }
  });
});

describe('directionForCueType', () => {
  it('hurdle → up, beam → down', () => {
    expect(directionForCueType('hurdle')).toBe('up');
    expect(directionForCueType('beam')).toBe('down');
  });
});

describe('candidateUrls', () => {
  it('tries webp strictly before png', () => {
    expect(candidateUrls('/media/cue-jump')).toEqual([
      '/media/cue-jump.webp',
      '/media/cue-jump.png',
    ]);
  });
});

describe('cueLabel — exact parity with the original ActionCue ternary', () => {
  it('head mode reads LOOK UP / LOOK DOWN', () => {
    expect(cueLabel('head', 'hurdle', false)).toBe('LOOK UP');
    expect(cueLabel('head', 'beam', false)).toBe('LOOK DOWN');
  });

  it('body/keyboard read JUMP / SQUAT', () => {
    expect(cueLabel('pose', 'hurdle', false)).toBe('JUMP');
    expect(cueLabel('pose', 'beam', false)).toBe('SQUAT');
    expect(cueLabel('keyboard', 'hurdle', false)).toBe('JUMP');
  });

  it('low-impact swaps JUMP → HEEL RAISE for body and keyboard', () => {
    expect(cueLabel('pose', 'hurdle', true)).toBe('HEEL RAISE');
    expect(cueLabel('keyboard', 'hurdle', true)).toBe('HEEL RAISE');
  });

  it('low-impact never overrides head mode', () => {
    expect(cueLabel('head', 'hurdle', true)).toBe('LOOK UP');
    expect(cueLabel('head', 'beam', true)).toBe('LOOK DOWN');
  });

  it('low-impact never affects the down cue', () => {
    expect(cueLabel('pose', 'beam', true)).toBe('SQUAT');
  });
});
