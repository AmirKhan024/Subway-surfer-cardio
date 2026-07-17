'use client';

/**
 * Game-over beat between playing and the report — quick and encouraging.
 * Two states: Run Complete (cleared the whole course) vs Out of lives.
 * Punchy stats only; the breakdown lives on the report screen.
 * Diagnostics widgets render only under ?debug=1.
 */
import { HeartCrack, Trophy } from 'lucide-react';
import type { RunnerRawData } from '@/types/raw-data';
import { COURSE } from './runner-constants';
import { CopyDiagnosticsButton, LogsPanel } from './diagnostics-widgets';
import { BackButton, MuteButton } from './screen-chrome';

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
  onHome,
  debug = false,
}: {
  raw: RunnerRawData;
  onSeeReport: () => void;
  onRunAgain: () => void;
  onHome: () => void;
  debug?: boolean;
}) {
  const resolved = raw.obstaclesCleared + raw.obstaclesFailed;
  const completed = resolved >= raw.obstaclesTotal;
  const livesLeft = Math.max(0, COURSE.LIVES - raw.obstaclesFailed);

  return (
    <main className="relative flex min-h-screen items-center justify-center p-4">
      <BackButton onClick={onHome} />
      <MuteButton />
      <div className="w-full max-w-md rounded-glass border border-white/10 bg-surface p-8 text-center shadow-glass">
        {completed ? (
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-500/10 shadow-[0_0_40px_rgba(6,182,212,0.35)]">
            <Trophy className="h-10 w-10 text-amber-400" />
          </div>
        ) : (
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-rose-400/25 bg-slate-800/70 shadow-[0_0_28px_rgba(244,63,94,0.15)]">
            <HeartCrack className="h-10 w-10 text-rose-300" />
          </div>
        )}
        <h1 className="mt-4 font-heading text-4xl font-black text-slate-50">
          {completed ? 'Run Complete!' : 'Out of lives'}
        </h1>
        <p className="mt-2 text-sm text-slate-300">
          {completed
            ? 'You cleared the course — great moving!'
            : "Nice run — you'll get further next time."}
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

        {debug && (
          <div className="mt-4">
            <CopyDiagnosticsButton />
            <LogsPanel />
          </div>
        )}
      </div>
    </main>
  );
}
