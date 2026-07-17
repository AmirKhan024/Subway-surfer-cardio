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
      className="flex h-28 w-full items-center gap-4 rounded-glass border border-white/10 bg-gradient-to-r from-slate-900/80 to-slate-900/40 px-5 text-left shadow-glass transition hover:border-cyan-400/40 hover:bg-white/5"
    >
      <picture>
        <source type="image/webp" srcSet={webp} />
        <img
          src={png}
          alt=""
          draggable={false}
          className="h-20 w-20 rounded-full object-contain shadow-[0_0_24px_rgba(6,182,212,0.25)]"
        />
      </picture>
      <div>
        <div className="flex items-center gap-2 font-heading text-xl font-bold text-slate-50">
          <Camera className="h-5 w-5 text-cyan-300" />
          {label}
        </div>
        <div className="mt-0.5 text-sm text-slate-300">{sublabel}</div>
      </div>
      <ChevronRight className="ml-auto h-5 w-5 shrink-0 text-slate-500" />
    </button>
  );
}

export default function HomeScreen({
  onSelectMode,
}: {
  onSelectMode: (mode: PlayMode) => void;
}) {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <MuteButton />
      <div className="text-center">
        <h1 className="font-heading text-4xl font-bold text-slate-50">Kriya Runner</h1>
        <p className="mt-2 text-slate-300">Move your body. See your Muscle Age.</p>
      </div>
      <div className="flex w-full max-w-md flex-col gap-4">
        <ModeCard
          iconBase={MODE_MEDIA.pose.up.base}
          label="Body Control"
          sublabel="Jump & squat to play"
          onClick={() => onSelectMode('pose')}
        />
        <ModeCard
          iconBase={MODE_MEDIA.head.up.base}
          label="Neck Workout"
          sublabel="Look up & down to play"
          onClick={() => onSelectMode('head')}
        />
      </div>
    </main>
  );
}
