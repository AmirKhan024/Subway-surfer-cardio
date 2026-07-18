'use client';

/**
 * SETUP — per-mode age/gender form, then Start or an optional inline
 * How-to-play demo. Gender is three pill buttons (Kriya style). Low-impact
 * and camera-bob are no longer user options: lowImpact is always false and
 * bobScale defaults gentle (0.4), 0 under prefers-reduced-motion.
 */
import { useEffect, useState } from 'react';
import { audioManager } from '@/lib/audio/audio-manager';
import { preloadCueImages } from '@/lib/media/cue-preloader';
import HowToPlay from './how-to-play';
import {
  loadProfile,
  saveProfile,
  type PlayMode,
  type RunnerProfile,
} from './profile';
import { BackButton, MuteButton } from './screen-chrome';

const GENDERS: { id: RunnerProfile['gender']; label: string }[] = [
  { id: 'male', label: 'Male' },
  { id: 'female', label: 'Female' },
  { id: 'other', label: 'Other' },
];

export default function SetupScreen({
  mode,
  onPlay,
  onBack,
}: {
  mode: PlayMode;
  onPlay: (profile: RunnerProfile, mode: PlayMode) => void;
  onBack: () => void;
}) {
  const [age, setAge] = useState<string>('35');
  const [gender, setGender] = useState<RunnerProfile['gender']>('male');
  const [sessionSec, setSessionSec] = useState(60);
  const [showHow, setShowHow] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const saved = loadProfile();
    if (saved) {
      setAge(String(saved.age));
      setGender(saved.gender);
      if (saved.sessionSec === 30 || saved.sessionSec === 60 || saved.sessionSec === 90) {
        setSessionSec(saved.sessionSec);
      }
    }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setReducedMotion(true);
    }
  }, []);

  // warm this mode's cue icons while the user fills the form
  useEffect(() => {
    preloadCueImages(mode);
  }, [mode]);

  const start = () => {
    // audio MUST init inside a user gesture (autoplay policy)
    audioManager.init();
    const parsed = Math.round(Number(age));
    const validAge = Number.isFinite(parsed) && parsed >= 5 && parsed <= 110 ? parsed : 35;
    const profile: RunnerProfile = {
      age: validAge,
      gender,
      lowImpact: false, // UI removed — engine capability kept dormant
      bobScale: reducedMotion ? 0 : 0.4, // gentle default
      sessionSec,
    };
    saveProfile(profile);
    onPlay(profile, mode);
  };

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center p-4 py-8">
      <BackButton onClick={onBack} />
      <MuteButton />
      <div className="w-full max-w-md rounded-glass border border-white/10 bg-surface p-7 shadow-glass">
        <span className="rounded-full border border-cyan-400/40 bg-cyan-500/15 px-3 py-1 text-xs font-semibold text-cyan-100">
          {mode === 'head' ? 'Neck Workout' : 'Body Control'}
        </span>
        <h1 className="mt-4 text-lg font-semibold text-slate-100">
          We need your age and gender to calculate your personalized score.
        </h1>

        <label className="mt-5 block text-sm text-slate-300">
          Age
          <input
            type="number"
            min={5}
            max={110}
            value={age}
            onChange={(e) => setAge(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-slate-50"
          />
        </label>

        <div className="mt-4 text-sm text-slate-300">
          Gender
          <div className="mt-2 flex gap-2">
            {GENDERS.map((g) => (
              <button
                key={g.id}
                type="button"
                aria-pressed={gender === g.id}
                onClick={() => setGender(g.id)}
                className={
                  gender === g.id
                    ? 'rounded-full border border-cyan-400/50 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100'
                    : 'rounded-full border border-white/15 bg-slate-900/60 px-4 py-2 text-sm text-slate-300 transition hover:border-white/30'
                }
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 text-sm text-slate-300">
          Workout length
          <div className="mt-2 flex gap-2">
            {([30, 60, 90] as const).map((sec) => (
              <button
                key={sec}
                type="button"
                aria-pressed={sessionSec === sec}
                onClick={() => setSessionSec(sec)}
                className={
                  sessionSec === sec
                    ? 'rounded-full border border-cyan-400/50 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100'
                    : 'rounded-full border border-white/15 bg-slate-900/60 px-4 py-2 text-sm text-slate-300 transition hover:border-white/30'
                }
              >
                {sec}s
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            Active movement time — the clock pauses while you rest.
          </p>
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <button
            onClick={start}
            className="rounded-xl bg-cyan-500 px-5 py-3 font-heading font-bold text-slate-950 transition hover:bg-cyan-400"
          >
            Start
          </button>
          <button
            type="button"
            aria-expanded={showHow}
            onClick={() => setShowHow((s) => !s)}
            className="rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-5 py-3 font-heading font-semibold text-cyan-100 transition hover:bg-cyan-500/20"
          >
            How to play
          </button>
        </div>

        {showHow && (
          <div className="mt-4 motion-safe:animate-fade-up">
            <HowToPlay mode={mode} />
          </div>
        )}

        {mode === 'head' && (
          <p className="mt-4 text-xs text-slate-400">
            Move your head gently, only as far as is comfortable — never force
            your neck. Stop right away if you feel pain, dizziness, or tingling.
          </p>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Needs camera permission and internet (first run) for the pose model.
        </p>

        <p className="mt-5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-200">
          ⚠️ Avoid if you have active pain. Consult a physician first.
        </p>
      </div>
    </main>
  );
}
