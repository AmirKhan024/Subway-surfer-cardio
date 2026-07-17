'use client';

/**
 * How-to-play — the chosen mode's demo video + a one-line layman caption.
 * Revealed on demand from the setup screen (mode is already picked, so no
 * tabs). Never gates Start or any game state.
 *
 * iOS-safe autoplay: muted + playsInline + autoplay together, plus an
 * imperative el.muted = true (React can drop the attribute). The video is
 * object-contain (letterboxed on the dark fill) so the full jump arc and
 * the labels baked into the frame are never cropped. The instructional
 * poster renders as its own object-contain layer under the video and fades
 * out once real frames are playing (a contain-fit video no longer covers
 * it); any failure (error, blocked autoplay, Low-Power Mode,
 * reduced-motion) leaves the poster — never a blank box.
 */
import { useEffect, useRef, useState } from 'react';
import { preloadCueImages } from '@/lib/media/cue-preloader';
import { MODE_MEDIA } from '@/lib/media/mode-media';
import type { PlayMode } from './profile';

const CAPTION: Record<PlayMode, string> = {
  pose: 'Jump over hurdles. Squat under the beams.',
  head: 'Look up to jump. Look down to squat.',
};

export default function HowToPlay({ mode }: { mode: PlayMode }) {
  const [videoFailed, setVideoFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setReducedMotion(true);
    }
  }, []);

  // warm the mode's cue icons (deduped; setup/handlePlay re-fires harmlessly)
  useEffect(() => {
    preloadCueImages(mode);
  }, [mode]);

  const showVideo = !reducedMotion && !videoFailed;

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !showVideo) return;
    let cancelled = false;
    el.muted = true; // imperative: React can drop the muted attribute, breaking iOS autoplay
    el.play().catch(() => {
      if (!cancelled) setVideoFailed(true);
    });
    return () => {
      cancelled = true; // ignore the pause-interrupt AbortError + unmount race
      el.pause();
    };
  }, [mode, showVideo]);

  const media = MODE_MEDIA[mode];

  return (
    <div>
      <div className="relative aspect-video overflow-hidden rounded-xl border border-white/10 bg-slate-900">
        {/* instructional poster: object-contain so its text labels never crop;
            fades out once the (also contain-fit) video is actually painting */}
        <img
          src={media.poster}
          alt=""
          draggable={false}
          className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-300 ${
            showVideo && playing ? 'opacity-0' : 'opacity-100'
          }`}
        />
        {showVideo && (
          <video
            key={mode} // clean remount on mode change: no stale play() promise
            ref={videoRef}
            src={media.demo}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            disablePictureInPicture
            aria-hidden
            onPlaying={() => setPlaying(true)}
            onError={() => {
              setPlaying(false);
              setVideoFailed(true);
            }}
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          />
        )}
      </div>
      <p className="mt-2 text-center text-sm text-slate-300">{CAPTION[mode]}</p>
    </div>
  );
}
