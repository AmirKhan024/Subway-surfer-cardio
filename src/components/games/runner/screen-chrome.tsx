'use client';

/**
 * Shared screen chrome: the top-left back arrow and the persistent
 * top-right mute toggle. Host screens must be `relative` — chrome is
 * absolutely positioned (never `fixed`, which would break inside the
 * transformed screen-transition wrapper).
 */
import { useEffect, useState } from 'react';
import { ArrowLeft, Volume2, VolumeX } from 'lucide-react';
import { audioManager } from '@/lib/audio/audio-manager';

const CHIP =
  'rounded-xl border border-white/15 bg-slate-950/60 p-2 text-slate-200 backdrop-blur-md transition hover:bg-white/5';

export function BackButton({ onClick, label = 'Back' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`absolute left-4 top-4 z-10 ${CHIP}`}
    >
      <ArrowLeft className="h-5 w-5" />
    </button>
  );
}

export function MuteButton() {
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    setMuted(audioManager.isMuted());
  }, []);

  const toggle = () => {
    const next = !audioManager.isMuted();
    audioManager.setMuted(next);
    setMuted(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={muted ? 'Unmute sound' : 'Mute sound'}
      className={`absolute right-4 top-4 z-10 ${CHIP}`}
    >
      {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
    </button>
  );
}
