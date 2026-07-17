'use client';

/**
 * How-to-play — start-screen demo panel with Body/Neck toggle chips.
 *
 * iOS-safe autoplay: muted + playsInline + autoplay together, plus an
 * imperative el.muted = true (React can drop the attribute). The poster is
 * a wide instructional split-image with text labels, so it renders as its
 * own object-contain layer UNDER the video (a poster attribute inside
 * <video> would inherit the video's object-cover and crop the labels);
 * before the first frame the video element is transparent, so the poster
 * shows through instantly. Any video failure (error, blocked autoplay,
 * Low-Power Mode, reduced-motion) leaves the poster — never a blank box.
 *
 * Nothing here gates the CTAs or any game state.
 */
import { useEffect, useRef, useState } from 'react';
import { preloadCueImages } from '@/lib/media/cue-preloader';
import { MODE_MEDIA } from '@/lib/media/mode-media';

type Tab = 'pose' | 'head';

const TABS: { id: Tab; label: string }[] = [
  { id: 'pose', label: 'Body & Keyboard' },
  { id: 'head', label: 'Neck' },
];

export default function HowToPlay() {
  const [tab, setTab] = useState<Tab>('pose');
  const [videoFailed, setVideoFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setReducedMotion(true);
    }
  }, []);

  // warm the revealed mode's cue icons early (deduped; handlePlay re-fires harmlessly)
  useEffect(() => {
    preloadCueImages(tab);
  }, [tab]);

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
  }, [tab, showVideo]);

  const media = MODE_MEDIA[tab];

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
          How to play
        </span>
        <div className="flex gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={tab === t.id}
              onClick={() => {
                setTab(t.id);
                setVideoFailed(false);
              }}
              className={`rounded-xl border px-2.5 py-1 text-xs font-semibold transition-colors ${
                tab === t.id
                  ? 'border-cyan-400/40 bg-cyan-500/20 text-cyan-100'
                  : 'border-white/15 bg-slate-900/60 text-slate-300 hover:border-white/30'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative mt-2 aspect-video overflow-hidden rounded-xl border border-white/10 bg-slate-900">
        {/* instructional poster: object-contain so its text labels never crop */}
        <img
          src={media.poster}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full object-contain"
        />
        {showVideo && (
          <video
            key={tab} // full remount on toggle: clean src swap, no stale play() promise
            ref={videoRef}
            src={media.demo}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            disablePictureInPicture
            aria-hidden
            onError={() => setVideoFailed(true)}
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          />
        )}
      </div>
    </div>
  );
}
