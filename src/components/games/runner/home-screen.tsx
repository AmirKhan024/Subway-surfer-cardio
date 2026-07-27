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
 * The soldier, silhouette-first: olive greatcoat, blanket roll, the brass
 * Kosha strapped across his back. Inline SVG on purpose — there is no such
 * art in public/media, and the start screen should not wait on a download.
 * He appears here and on the report only; the run itself stays first-person.
 */
function SoldierSilhouette() {
  return (
    <svg viewBox="0 0 120 150" aria-hidden className="h-32 w-auto">
      {/* the sun he is walking into */}
      <circle cx="60" cy="40" r="34" fill="#E8913A" opacity="0.16" />
      <circle cx="60" cy="40" r="21" fill="#F5C542" opacity="0.2" />
      {/* Kosha — the brass-bound casket strapped across his back, tucked
          behind the torso so it rides on him rather than hanging at his side */}
      <g transform="rotate(-7 54 70)">
        <rect x="41" y="58" width="23" height="20" rx="2.5" fill="#8A6F1E" />
        <rect x="41" y="58" width="23" height="20" rx="2.5" fill="none" stroke="#E8C46A" strokeWidth="1.5" />
        <path d="M41 66h23" stroke="#E8C46A" strokeWidth="1.5" />
        <rect x="49.5" y="63" width="5" height="7" rx="1" fill="#F2DFA6" />
      </g>
      {/* shoulder strap + blanket roll */}
      <path d="M63 52l-9 9" stroke="#6B5A45" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M57 55c-6 4-9 11-8 19" stroke="#6B5A45" strokeWidth="6" strokeLinecap="round" fill="none" />
      {/* body */}
      <circle cx="66" cy="41" r="9" fill="#3A4030" />
      <path d="M60 50h13l6 26-5 30h-6l-2-26-4 26h-6l-4-32z" fill="#3A4030" />
      {/* forward leg mid-stride + trailing leg */}
      <path d="M68 105l9 30h-7l-9-28z" fill="#2E3327" />
      <path d="M60 105l-8 30h7l8-28z" fill="#2E3327" />
      {/* rifle slung at the shoulder */}
      <path d="M74 46l14 34" stroke="#241F1A" strokeWidth="3" strokeLinecap="round" />
    </svg>
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
        <SoldierSilhouette />
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
