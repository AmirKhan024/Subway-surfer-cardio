'use client';

/**
 * START screen — collects the profile the local scoring mirror needs
 * (age; gender stored for prod-integration parity but NEVER used by KR1
 * scoring, which is age-only like prod), the low-impact toggle, and the
 * control-mode choice.
 */
import { useEffect, useState } from 'react';
import { audioManager } from '@/lib/audio/audio-manager';
import HowToPlay from './how-to-play';

export interface RunnerProfile {
  age: number;
  gender: 'male' | 'female' | 'other';
  lowImpact: boolean;
  /** camera-bob amplitude: 1 full, 0.4 gentle, 0 off */
  bobScale: number;
}

const PROFILE_KEY = 'kr1-profile';

export function loadProfile(): RunnerProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as RunnerProfile;
    if (typeof p.age !== 'number' || p.age < 5 || p.age > 110) return null;
    return p;
  } catch {
    return null;
  }
}

export function saveProfile(p: RunnerProfile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable — session still works */
  }
}

export default function StartScreen({
  onPlay,
}: {
  onPlay: (profile: RunnerProfile, mode: 'keyboard' | 'pose' | 'head') => void;
}) {
  const [age, setAge] = useState<string>('35');
  const [gender, setGender] = useState<RunnerProfile['gender']>('male');
  const [lowImpact, setLowImpact] = useState(false);
  const [bobScale, setBobScale] = useState(1);
  const [sound, setSound] = useState(true);

  useEffect(() => {
    setSound(!audioManager.isMuted());
  }, []);

  useEffect(() => {
    const saved = loadProfile();
    if (saved) {
      setAge(String(saved.age));
      setGender(saved.gender);
      setLowImpact(saved.lowImpact);
      setBobScale(saved.bobScale ?? 1);
    } else if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setBobScale(0.4); // respect reduced-motion by default
    }
  }, []);

  const start = (mode: 'keyboard' | 'pose' | 'head') => {
    // audio MUST init inside a user gesture (autoplay policy)
    audioManager.init();
    audioManager.setMuted(!sound);
    const parsed = Math.round(Number(age));
    const validAge = Number.isFinite(parsed) && parsed >= 5 && parsed <= 110 ? parsed : 35;
    const profile: RunnerProfile = { age: validAge, gender, lowImpact, bobScale };
    saveProfile(profile);
    onPlay(profile, mode);
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-glass border border-white/10 bg-surface p-7 shadow-glass">
        <h1 className="font-heading text-3xl font-bold text-slate-50">Kriya Runner</h1>
        <p className="mt-2 text-sm text-slate-300">
          Level 1 — first-person, one lane. Jump the striped hurdles, squat under
          the beams. The view rises and dips with your body.
        </p>

        <HowToPlay />

        {/* profile */}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <label className="text-sm text-slate-300">
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
          <label className="text-sm text-slate-300">
            Gender
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value as RunnerProfile['gender'])}
              className="mt-1 w-full rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-slate-50"
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </label>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={lowImpact}
            onChange={(e) => setLowImpact(e.target.checked)}
            className="h-4 w-4 accent-cyan-500"
          />
          Low-impact mode — heel-raise instead of jump
        </label>

        <label className="mt-3 flex items-center gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={sound}
            onChange={(e) => setSound(e.target.checked)}
            className="h-4 w-4 accent-cyan-500"
          />
          Sound — calm music + effects
        </label>

        <label className="mt-3 block text-sm text-slate-300">
          View movement (camera bob)
          <select
            value={String(bobScale)}
            onChange={(e) => setBobScale(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-slate-50"
          >
            <option value="1">Full — view dips and rises with you</option>
            <option value="0.4">Gentle — reduced motion</option>
            <option value="0">Off — steady camera</option>
          </select>
        </label>

        {/* CTAs */}
        <div className="mt-6 flex flex-col gap-3">
          <button
            onClick={() => start('pose')}
            className="rounded-xl bg-cyan-500 px-5 py-3 font-heading font-bold text-slate-950 transition hover:bg-cyan-400"
          >
            🎥 Body control (camera)
          </button>
          <button
            onClick={() => start('head')}
            className="rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-5 py-3 font-heading font-semibold text-cyan-100 transition hover:bg-cyan-500/20"
          >
            🙂 Head / neck control (camera, works seated)
          </button>
          <button
            onClick={() => start('keyboard')}
            className="rounded-xl border border-white/20 px-5 py-3 font-heading font-semibold text-slate-100 transition hover:bg-white/5"
          >
            ⌨️ Play with keyboard
          </button>
        </div>

        <p className="mt-3 text-xs text-slate-400">
          <span className="font-semibold text-slate-300">Head mode:</span> look up to
          jump, look down to duck. Move your head gently, only as far as is
          comfortable — never force your neck. Stop right away if you feel pain,
          dizziness, or tingling.
        </p>

        <div className="mt-4 text-xs text-slate-400">
          <span className="font-semibold">Keys:</span> ↑ / Space / W jump · ↓ / S (hold) squat
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Camera control needs camera permission and internet (first run) for the
          pose model.
        </p>

        <p className="mt-5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-200">
          ⚠️ Avoid if you have active pain. Consult a physician first.
        </p>
      </div>
    </main>
  );
}
