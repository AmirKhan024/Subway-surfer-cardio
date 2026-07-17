'use client';

/**
 * REPORT screen — M1 interim: raw run breakdown + Run again.
 * M4 adds the musculage hero (local KR1 scoring mirror) and run-history delta.
 */
import type { RunnerRawData } from '@/types/raw-data';

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
  onRunAgain,
  onChangeSettings,
}: {
  raw: RunnerRawData;
  onRunAgain: () => void;
  onChangeSettings: () => void;
}) {
  const finished = raw.obstaclesCleared + raw.obstaclesFailed >= raw.obstaclesTotal;
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-glass border border-white/10 bg-surface p-7 shadow-glass">
        <h1 className="font-heading text-2xl font-bold text-slate-50">
          {finished ? 'Course complete!' : 'Run over'}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          {raw.obstaclesCleared}/{raw.obstaclesTotal} obstacles cleared ·{' '}
          {Math.round(raw.distance)}m
        </p>

        <div className="mt-5 grid grid-cols-3 gap-2">
          <Stat label="Squats" value={String(raw.squatReps)} sub={`avg depth ${(raw.avgSquatDepth * 100).toFixed(0)}%`} />
          <Stat
            label={raw.lowImpact ? 'Heel raises' : 'Jumps'}
            value={String(raw.jumpReps)}
            sub={`avg height ${(raw.avgJumpHeight * 100).toFixed(0)}%`}
          />
          <Stat label="Clean form" value={`${(raw.cleanFormRate * 100).toFixed(0)}%`} />
          <Stat label="Reaction" value={`${raw.avgReactionMs}ms`} sub={raw.controlModeKeyboard ? 'keyboard' : 'body'} />
          <Stat label="Missed" value={String(raw.obstaclesFailed)} />
          <Stat label="Time" value={`${(raw.elapsed / 1000).toFixed(0)}s`} />
        </div>

        <p className="mt-4 text-center text-xs text-slate-500">
          squat depth → mobility · jump power → strength · timing → reflex
        </p>

        {raw.assessmentValid === 0 && (
          <p className="mt-3 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-center text-xs text-slate-400">
            Short run — stats are indicative, not assessment-grade.
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
      </div>
    </main>
  );
}
