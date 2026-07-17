'use client';

/**
 * REPORT screen — "Runner Fitness" card (deliberately NOT the calibrated
 * Mobility musculage: the runner drives engagement + its own score card;
 * calibrated assessments stay the clinical source of truth — SPEC §9.6).
 *
 * Hero = musculage from the local KR1 scoring mirror. Conditioned can
 * legally exceed 1.0 (older cohorts get >1.0 age factors) — the % display
 * caps at 100.
 */
import { useEffect, useState } from 'react';
import type { RunnerRawData } from '@/types/raw-data';
import { computeKR1Score, type KR1ScoreResult } from '@/lib/scoring/kr1-local';
import { getDiagnosticsText } from '@/lib/debug/run-logger';
import { HEAD } from './runner-constants';

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
    <div className="rounded-xl border border-white/10 bg-slate-900/60 p-3 text-center">
      <div className="text-lg font-bold text-slate-50">{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      {sub && <div className="mt-0.5 text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}

export default function ReportScreen({
  raw,
  age,
  onRunAgain,
  onChangeSettings,
}: {
  raw: RunnerRawData;
  age: number;
  onRunAgain: () => void;
  onChangeSettings: () => void;
}) {
  const [score, setScore] = useState<KR1ScoreResult | null>(null);
  const [deltaMusculage, setDeltaMusculage] = useState<number | null>(null);
  const [personalBest, setPersonalBest] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(getDiagnosticsText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // clipboard blocked (http / permissions) — fall back to console
      // eslint-disable-next-line no-console
      console.log(getDiagnosticsText());
      alert('Clipboard unavailable — diagnostics printed to the console instead.');
    }
  };

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

  if (!score) return null;

  const finished = raw.obstaclesCleared + raw.obstaclesFailed >= raw.obstaclesTotal;
  const conditionedPct = Math.min(100, Math.round(score.conditioned * 100));
  // KR1N = head/neck-ROM run: present neck ranges, never squat/jump labels
  const isHeadRun = raw.testId === 'KR1N';
  const flexPct = Math.round((raw.avgNeckFlexion / HEAD.FLEX_CLEAN) * 100);
  const extPct = Math.round((raw.avgNeckExtension / HEAD.EXT_CLEAN) * 100);

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-glass border border-white/10 bg-surface p-7 shadow-glass">
        <div className="flex items-baseline justify-between">
          <h1 className="font-heading text-2xl font-bold text-slate-50">
            {finished ? 'Course complete!' : 'Run over'}
          </h1>
          <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-cyan-300">
            {isHeadRun ? 'Neck ROM Runner' : 'Runner Fitness'}
          </span>
        </div>

        {/* musculage hero */}
        {score.incomplete ? (
          <div className="mt-5 rounded-2xl border border-white/10 bg-slate-900/60 p-5 text-center">
            <div className="text-sm text-slate-300">
              No movement detected — play a course to earn a Runner Fitness score.
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-cyan-500/20 bg-gradient-to-b from-cyan-500/10 to-transparent p-5 text-center">
            <div className="text-[11px] uppercase tracking-widest text-slate-400">
              Runner muscle age
            </div>
            <div className="mt-1 font-heading text-6xl font-black text-slate-50">
              {score.musculage}
            </div>
            <div className="mt-1 text-sm text-slate-400">
              score {conditionedPct}/100 · you are {age}
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
          </div>
        )}

        <p className="mt-3 text-center text-sm text-slate-400">
          {raw.obstaclesCleared}/{raw.obstaclesTotal} obstacles · {Math.round(raw.distance)}m
        </p>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {isHeadRun ? (
            <>
              <Stat label="Look-downs" value={String(raw.squatReps)} sub={`range ${flexPct}% of target`} />
              <Stat label="Look-ups" value={String(raw.jumpReps)} sub={`range ${extPct}% of target`} />
            </>
          ) : (
            <>
              <Stat label="Squats" value={String(raw.squatReps)} sub={`avg depth ${(raw.avgSquatDepth * 100).toFixed(0)}%`} />
              <Stat
                label={raw.lowImpact ? 'Heel raises' : 'Jumps'}
                value={String(raw.jumpReps)}
                sub={`avg height ${(raw.avgJumpHeight * 100).toFixed(0)}%`}
              />
            </>
          )}
          <Stat label="Clean form" value={`${(raw.cleanFormRate * 100).toFixed(0)}%`} />
          <Stat
            label="Reaction"
            value={`${raw.avgReactionMs}ms`}
            sub={raw.controlScheme === 0 ? 'keyboard' : raw.controlScheme === 2 ? 'head' : 'body'}
          />
          <Stat label="Missed" value={String(raw.obstaclesFailed)} />
          <Stat label="Time" value={`${(raw.elapsed / 1000).toFixed(0)}s`} />
        </div>

        <p className="mt-4 text-center text-xs text-slate-500">
          {isHeadRun
            ? 'head/neck movement range (relative) → neck mobility · timing → reflex'
            : 'squat depth → mobility · jump power → strength · timing → reflex'}
        </p>

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
            onClick={onChangeSettings}
            className="rounded-xl border border-white/20 px-4 py-3 text-sm font-semibold text-slate-200"
          >
            Settings
          </button>
        </div>

        <button
          onClick={copyDiagnostics}
          className="mt-3 w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-slate-400 transition hover:text-slate-200"
        >
          {copied ? 'Copied ✓ — paste it to the developer' : '🔍 Copy diagnostics'}
        </button>

        <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-200">
          ⚠️ Avoid if you have active pain. Consult a physician first.
        </p>
      </div>
    </main>
  );
}
