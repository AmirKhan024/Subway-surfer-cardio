'use client';

/**
 * Game-over beat between playing and the report — quick and celebratory.
 * Two states: Run Complete (cleared the whole course) vs Game Over (lost
 * all 3 lives). Punchy stats only; the clinical breakdown lives on the
 * report screen. Button-only advance (no auto-skip — let them read it).
 */
import type { RunnerRawData } from '@/types/raw-data';
import { COURSE } from './runner-constants';
import { CopyDiagnosticsButton, LogsPanel } from './diagnostics-widgets';

function BigStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-center">
      <div className={`font-heading text-3xl font-black ${accent ? 'text-amber-400' : 'text-slate-50'}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wider text-slate-400">{label}</div>
    </div>
  );
}

export default function GameOverScreen({
  raw,
  onSeeReport,
  onRunAgain,
}: {
  raw: RunnerRawData;
  onSeeReport: () => void;
  onRunAgain: () => void;
}) {
  const resolved = raw.obstaclesCleared + raw.obstaclesFailed;
  const completed = resolved >= raw.obstaclesTotal;
  const livesLeft = Math.max(0, COURSE.LIVES - raw.obstaclesFailed);

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-glass border border-white/10 bg-surface p-8 text-center shadow-glass">
        <div className="text-5xl">{completed ? '🎉' : '💥'}</div>
        <h1 className="mt-3 font-heading text-4xl font-black text-slate-50">
          {completed ? 'Run Complete!' : 'Game Over'}
        </h1>
        <p className="mt-2 text-sm text-slate-300">
          {completed
            ? `You cleared the whole course${livesLeft === COURSE.LIVES ? ' without a scratch' : ''} — great moving!`
            : `You made it past ${raw.obstaclesCleared} obstacle${raw.obstaclesCleared === 1 ? '' : 's'} — every run counts.`}
        </p>

        <div className="mt-6 grid grid-cols-3 gap-3">
          <BigStat label="Distance" value={`${Math.round(raw.distance)}m`} />
          <BigStat label="Coins" value={`◉ ${raw.coinsCollected}`} accent />
          <BigStat label="Cleared" value={`${raw.obstaclesCleared}/${raw.obstaclesTotal}`} />
        </div>

        <div className="mt-4 text-lg">
          <span className="text-rose-400">{'♥'.repeat(livesLeft)}</span>
          <span className="text-slate-600">{'♥'.repeat(COURSE.LIVES - livesLeft)}</span>
        </div>

        <div className="mt-7 flex gap-3">
          <button
            onClick={onSeeReport}
            className="flex-1 rounded-xl bg-cyan-500 px-4 py-3 font-heading font-bold text-slate-950 transition hover:bg-cyan-400"
          >
            See your report
          </button>
          <button
            onClick={onRunAgain}
            className="rounded-xl border border-white/20 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/5"
          >
            Run again
          </button>
        </div>

        <div className="mt-4">
          <CopyDiagnosticsButton />
          <LogsPanel />
        </div>
      </div>
    </main>
  );
}
