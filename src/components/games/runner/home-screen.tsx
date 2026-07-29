'use client';

/**
 * HOME — near-empty mode select. Title, one-line tagline, two glass mode
 * cards. No form, no video, no toggles; everything else lives on SETUP.
 *
 * Card art is the mode's circular single-figure cue icon at a FIXED size —
 * never a stretched or cropped background. The wide dual-panel posters
 * (baked-in JUMP/SQUAT labels) belong to the How-to-play demo only; rule:
 * never object-cover an image with meaning at its edges.
 */
import { Camera, ChevronRight } from 'lucide-react';
import { MODE_MEDIA, candidateUrls } from '@/lib/media/mode-media';
import type { PlayMode } from './profile';
import { MuteButton } from './screen-chrome';

function ModeCard({
  iconBase,
  label,
  sublabel,
  onClick,
}: {
  /** extensionless cue-icon base — rendered webp with native png fallback */
  iconBase: string;
  label: string;
  sublabel: string;
  onClick: () => void;
}) {
  const [webp, png] = candidateUrls(iconBase);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-28 w-full items-center gap-4 rounded-glass border border-brass/20 bg-gradient-to-r from-teak/80 to-teak-deep/40 px-5 text-left shadow-glass transition hover:border-brass/50 hover:bg-brass/5"
    >
      <picture>
        <source type="image/webp" srcSet={webp} />
        <img
          src={png}
          alt=""
          draggable={false}
          className="h-20 w-20 rounded-full object-contain shadow-[0_0_24px_rgba(201,162,39,0.25)]"
        />
      </picture>
      <div>
        <div className="flex items-center gap-2 font-heading text-xl font-bold text-brass-pale">
          <Camera className="h-5 w-5 text-brass" />
          {label}
        </div>
        <div className="mt-0.5 text-sm text-brass-pale/60">{sublabel}</div>
      </div>
      <ChevronRight className="ml-auto h-5 w-5 shrink-0 text-brass/60" />
    </button>
  );
}

/**
 * The soldier walking into the sunrise with the Kosha on his back — the game's
 * one piece of key art, and the whole promise of the run in a single frame.
 *
 * Transparent PNG/webp, so it sits on the page background with no plate behind
 * it. Same webp→png chain as the mode cards, and object-contain in a FIXED box:
 * the ridgeline runs to both edges, so a crop would eat the valley (see the
 * file header rule). The fixed box also reserves the space, so nothing shifts
 * when it lands.
 */
const HERO_BASE = '/media/hero-soldier';

function HeroArt() {
  const [webp, png] = candidateUrls(HERO_BASE);
  return (
    <picture>
      <source type="image/webp" srcSet={webp} />
      <img
        src={png}
        alt="" /* decorative — the title below names the game */
        draggable={false}
        fetchPriority="high" /* first paint of the first screen */
        decoding="async"
        className="h-40 w-40 object-contain sm:h-48 sm:w-48"
      />
    </picture>
  );
}

export default function HomeScreen({
  onSelectMode,
}: {
  onSelectMode: (mode: PlayMode) => void;
}) {
  return (
    <main className="relative flex min-h-[100dvh] flex-col items-center justify-center gap-6 p-4">
      <MuteButton />
      <div className="flex flex-col items-center text-center">
        <HeroArt />
        <h1 className="mt-1 font-heading text-4xl font-bold text-brass-pale">The Final Run</h1>
        <p className="mt-3 max-w-sm text-balance text-brass-pale/70">
          Run from Kaho to Dong — out of the dark, into India&apos;s first light.
          Everything you&apos;ve earned is on your back.
        </p>
      </div>
      <div className="flex w-full max-w-md flex-col gap-4">
        <ModeCard
          iconBase={MODE_MEDIA.pose.up.base}
          label="Body Control"
          sublabel="Run, jump and scoop down the valley"
          onClick={() => onSelectMode('pose')}
        />
        <ModeCard
          iconBase={MODE_MEDIA.head.up.base}
          label="Neck Workout"
          sublabel="Look up and down to take the trail"
          onClick={() => onSelectMode('head')}
        />
      </div>
    </main>
  );
}
