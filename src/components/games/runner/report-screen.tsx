'use client';

/**
 * REPORT screen — "Runner Fitness" card (deliberately NOT the calibrated
 * Mobility musculage: the runner drives engagement + its own score card;
 * calibrated assessments stay the clinical source of truth — SPEC §9.6).
 *
 * Retention-first layout: animated Muscle-Age ring hero, one age-comparison
 * bar, a small friendly stat row. The ring fill is min(1, age/musculage) —
 * NOT the raw score — so a younger-than-age result reads as a full emerald
 * ring and an older one as a visibly emptier amber ring. Conditioned can
 * legally exceed 1.0 (older cohorts get >1.0 age factors) — the score
 * display caps at 100. Diagnostics widgets render only under ?debug=1.
 */
import { useEffect, useState } from 'react';
import type { RunnerRawData } from '@/types/raw-data';
import { computeKR1Score, type KR1ScoreResult } from '@/lib/scoring/kr1-local';
import { CopyDiagnosticsButton, LogsPanel } from './diagnostics-widgets';
import { reportHeading, type EndReason } from './gameover-copy';
import ProgressRing from './progress-ring';
import { BackButton, MuteButton } from './screen-chrome';
import { useAnimatedProgress } from './use-animated-progress';

interface RunRecord {
  musculage: number;
  conditioned: number;
  cleared: number;
  seed: number;
  at: number;
}

const HISTORY_KEY = 'kr1-history';

function loadHistory(): RunRecord[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as RunRecord[];
  } catch {
    return [];
  }
}

function pushHistory(rec: RunRecord): RunRecord[] {
  const prev = loadHistory();
  const next = [...prev, rec].slice(-20);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  return prev;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-slate-900/60 p-2 text-center sm:p-3">
      <div className="text-[clamp(0.95rem,4.5vw,1.125rem)] font-bold tabular-nums text-slate-50">
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      {sub && <div className="mt-0.5 text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}

/**
 * One horizontal track with both ages as labeled markers. Minimum span of
 * 12 years so near-equal values still read as two distinct markers; the
 * markers themselves sit at their true positions.
 */
function AgeBar({ age, musculage, better }: { age: number; musculage: number; better: boolean }) {
  const span = Math.max(12, Math.abs(age - musculage) + 16);
  const mid = (age + musculage) / 2;
  let lo = mid - span / 2;
  let hi = mid + span / 2;
  // shift (not shrink) when the window runs past the valid age range
  if (lo < 5) {
    hi += 5 - lo;
    lo = 5;
  }
  if (hi > 110) {
    lo = Math.max(5, lo - (hi - 110));
    hi = 110;
  }
  const pos = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  const accent = better ? 'bg-emerald-400 ring-emerald-400/30' : 'bg-amber-400 ring-amber-400/30';

  const diff = age - musculage;
  const caption =
    diff > 0
      ? `Your muscles move like someone ${diff} years younger 💪`
      : diff === 0
        ? 'Your muscles match your age.'
        : `Your muscles move like a ${musculage}-year-old.`;

  return (
    <div className="mt-6">
      <div className="relative mx-2 mb-8 mt-8 h-2 rounded-full bg-slate-800">
        <div className="absolute -translate-x-1/2" style={{ left: pos(age) }}>
          <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] text-slate-400">
            You · {age}
          </div>
          <div className="mt-[-2px] h-3 w-3 rounded-full bg-slate-400" />
        </div>
        <div className="absolute -translate-x-1/2" style={{ left: pos(musculage) }}>
          <div className={`mt-[-4px] h-4 w-4 rounded-full ring-4 ${accent}`} />
          <div className="absolute left-1/2 top-4 -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold text-slate-200">
            Muscle · {musculage}
          </div>
        </div>
      </div>
      <p className="text-center text-sm text-slate-300">{caption}</p>
    </div>
  );
}

export default function ReportScreen({
  raw,
  reason,
  age,
  onRunAgain,
  onHome,
  debug = false,
}: {
  raw: RunnerRawData;
  /** the engine's RUN_DONE reason — drives the heading, never lives/resolved */
  reason: EndReason;
  age: number;
  onRunAgain: () => void;
  onHome: () => void;
  debug?: boolean;
}) {
  const [score, setScore] = useState<KR1ScoreResult | null>(null);
  const [deltaMusculage, setDeltaMusculage] = useState<number | null>(null);
  const [personalBest, setPersonalBest] = useState(false);
  const [reducedMotion] = useState(
    () =>
      typeof window !== 'undefined' &&
      !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const s = computeKR1Score(raw, age);
    setScore(s);
    const prevRuns = pushHistory({
      musculage: s.musculage,
      conditioned: s.conditioned,
      cleared: raw.obstaclesCleared,
      seed: raw.seed,
      at: Date.now(),
    });
    if (prevRuns.length > 0) {
      const last = prevRuns[prevRuns.length - 1];
      setDeltaMusculage(s.musculage - last.musculage);
      setPersonalBest(s.musculage < Math.min(...prevRuns.map((r) => r.musculage)));
    } else {
      setPersonalBest(!s.incomplete);
    }
    // score once per mount — raw/age are stable for a given report
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const t = useAnimatedProgress(1200, reducedMotion || !score || score.incomplete);

  if (!score) return null;

  const conditionedPct = Math.min(100, Math.round(score.conditioned * 100));
  // KR1N = head/neck-ROM run: present neck labels, never squat/jump labels
  const isHeadRun = raw.testId === 'KR1N';
  const better = score.musculage <= age;
  const heroColor = better ? '#34d399' : '#f59e0b';
  // younger/equal → full ring; older → progressively emptier (NOT the score:
  // a 90/100 score can still mean "older than you" and must not look full)
  const ringFraction = Math.min(1, age / score.musculage);

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center p-4">
      <BackButton onClick={onHome} />
      <MuteButton />
      <div className="w-full max-w-md rounded-glass border border-white/10 bg-surface p-7 shadow-glass">
        <div className="flex items-baseline justify-between">
          <h1 className="font-heading text-2xl font-bold text-slate-50">
            {reportHeading(reason)}
          </h1>
          <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-cyan-300">
            {isHeadRun ? 'Neck ROM Runner' : 'Runner Fitness'}
          </span>
        </div>

        {/* muscle-age hero */}
        {score.incomplete ? (
          <div className="mt-5 rounded-2xl border border-white/10 bg-slate-900/60 p-5 text-center">
            <div className="text-sm text-slate-300">
              No movement detected — play a course to earn a Runner Fitness score.
            </div>
          </div>
        ) : (
          <div className="mt-6">
            <ProgressRing fraction={t * ringFraction} color={heroColor}>
              <div className="text-[11px] uppercase tracking-widest text-slate-400">Muscle age</div>
              <div className="font-heading text-6xl font-black text-slate-50">
                {Math.round(t * score.musculage)}
              </div>
            </ProgressRing>
            <div className="mt-2 text-center text-sm text-slate-400">
              Score {conditionedPct} · You are {age}
            </div>
            <div className="mt-2 flex items-center justify-center gap-2 text-xs">
              {personalBest && (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-300">
                  ★ Personal best
                </span>
              )}
              {deltaMusculage !== null && deltaMusculage !== 0 && (
                <span
                  className={`rounded-full px-2 py-0.5 font-semibold ${
                    deltaMusculage < 0
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-rose-500/15 text-rose-300'
                  }`}
                >
                  {deltaMusculage < 0 ? '▼' : '▲'} {Math.abs(deltaMusculage)} vs last run
                </span>
              )}
            </div>
            <AgeBar age={age} musculage={score.musculage} better={better} />
          </div>
        )}

        <p className="mt-4 text-center text-sm text-slate-400">
          {raw.obstaclesCleared}/{raw.obstaclesTotal} obstacles · {Math.round(raw.distance)}m
        </p>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {isHeadRun ? (
            <>
              <Stat label="Look-downs" value={String(raw.squatReps)} />
              <Stat label="Look-ups" value={String(raw.jumpReps)} />
            </>
          ) : (
            <>
              <Stat label="Squats" value={String(raw.squatReps)} />
              <Stat label="Jumps" value={String(raw.jumpReps)} />
            </>
          )}
          <Stat label="Clean form" value={`${(raw.cleanFormRate * 100).toFixed(0)}%`} />
          <Stat
            label="Reaction"
            value={`${raw.avgReactionMs}ms`}
            sub="How fast you moved after the cue."
          />
          <Stat label="Time" value={`${(raw.elapsed / 1000).toFixed(0)}s`} />
          <Stat label="Coins" value={`◉ ${raw.coinsCollected}`} sub="fun only" />
        </div>

        {raw.assessmentValid === 0 && !score.incomplete && (
          <p className="mt-3 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-center text-xs text-slate-400">
            Short run — score is indicative, not assessment-grade.
          </p>
        )}

        <div className="mt-6 flex gap-3">
          <button
            onClick={onRunAgain}
            className="flex-1 rounded-xl bg-cyan-500 px-4 py-3 font-heading font-bold text-slate-950 transition hover:bg-cyan-400"
          >
            Run again
          </button>
          <button
            onClick={onHome}
            className="rounded-xl border border-white/20 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/5"
          >
            Home
          </button>
        </div>

        {debug && (
          <div className="mt-3">
            <CopyDiagnosticsButton />
            <LogsPanel />
          </div>
        )}

        <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-200">
          ⚠️ Avoid if you have active pain. Consult a physician first.
        </p>
      </div>
    </main>
  );
}
