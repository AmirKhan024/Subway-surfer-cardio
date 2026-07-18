'use client';

/**
 * Game-over beat between playing and the report — quick and encouraging.
 * Two states: Run Complete (cleared the whole course) vs Out of lives.
 * Punchy stats only; the breakdown lives on the report screen.
 * Diagnostics widgets render only under ?debug=1.
 */
import { HeartCrack, Hourglass, Trophy } from 'lucide-react';
import type { RunnerRawData } from '@/types/raw-data';
import { COURSE } from './runner-constants';
import { CopyDiagnosticsButton, LogsPanel } from './diagnostics-widgets';
import { gameOverCopy, type EndReason } from './gameover-copy';
import { BackButton, MuteButton } from './screen-chrome';

function BigStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-slate-900/60 px-2 py-3 text-center sm:px-4">
      {/* fluid type + tabular-nums: big values (454m, high coin counts) must
          never spill outside the tile on narrow phones */}
      <div
        className={`font-heading text-[clamp(1.1rem,6.5vw,1.875rem)] font-black tabular-nums ${accent ? 'text-amber-400' : 'text-slate-50'}`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wider text-slate-400">{label}</div>
    </div>
  );
}

export default function GameOverScreen({
  raw,
  reason,
  onSeeReport,
  onRunAgain,
  onHome,
  debug = false,
}: {
  raw: RunnerRawData;
  /** the engine's RUN_DONE reason — the ONLY source of the win/lose branch */
  reason: EndReason;
  onSeeReport: () => void;
  onRunAgain: () => void;
  onHome: () => void;
  debug?: boolean;
}) {
  const copy = gameOverCopy(reason);
  const livesLeft = Math.max(0, COURSE.LIVES - raw.obstaclesFailed);

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center p-4">
      <BackButton onClick={onHome} />
      <MuteButton />
      <div className="w-full max-w-md rounded-glass border border-white/10 bg-surface p-8 text-center shadow-glass">
        {copy.tone === 'win' ? (
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-500/10 shadow-[0_0_40px_rgba(6,182,212,0.35)]">
            {reason === 'time' ? (
              <Hourglass className="h-10 w-10 text-amber-400" />
            ) : (
              <Trophy className="h-10 w-10 text-amber-400" />
            )}
          </div>
        ) : (
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-rose-400/25 bg-slate-800/70 shadow-[0_0_28px_rgba(244,63,94,0.15)]">
            <HeartCrack className="h-10 w-10 text-rose-300" />
          </div>
        )}
        <h1 className="mt-4 font-heading text-4xl font-black text-slate-50">{copy.title}</h1>
        <p className="mt-2 text-sm text-slate-300">{copy.sub}</p>

        <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3">
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
