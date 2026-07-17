'use client';

/**
 * HOME — near-empty mode select. Title, one-line tagline, two poster mode
 * cards. No form, no video, no toggles; everything else lives on SETUP.
 *
 * The posters carry baked-in instruction labels near the bottom of the
 * frame — the cards crop from the top (`object-top`) so a clean part of
 * the image shows and our own caption carries the words.
 */
import { Camera } from 'lucide-react';
import { MODE_MEDIA } from '@/lib/media/mode-media';
import type { PlayMode } from './profile';
import { MuteButton } from './screen-chrome';

function ModeCard({
  poster,
  label,
  sublabel,
  onClick,
}: {
  poster: string;
  label: string;
  sublabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative h-40 w-full overflow-hidden rounded-glass border border-white/10 text-left shadow-glass transition hover:border-cyan-400/40"
    >
      <img
        src={poster}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover object-top transition duration-300 motion-safe:group-hover:scale-105"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/40 to-transparent" />
      <div className="absolute bottom-3 left-4 right-4">
        <div className="flex items-center gap-2 font-heading text-xl font-bold text-slate-50">
          <Camera className="h-5 w-5 text-cyan-300" />
          {label}
        </div>
        <div className="text-sm text-slate-300">{sublabel}</div>
      </div>
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
          poster={MODE_MEDIA.pose.poster}
          label="Body Control"
          sublabel="Jump & squat to play"
          onClick={() => onSelectMode('pose')}
        />
        <ModeCard
          poster={MODE_MEDIA.head.poster}
          label="Neck Workout"
          sublabel="Look up & down to play"
          onClick={() => onSelectMode('head')}
        />
      </div>
    </main>
  );
}
