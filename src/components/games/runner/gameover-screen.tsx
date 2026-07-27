'use client';

/**
 * Arrival beat between playing and the report — quick and warm.
 * ONE state: every run reaches the plateau (a miss stumbles the runner, it
 * never ends the run). Punchy stats only; the breakdown is on the report.
 * Diagnostics widgets render only under ?debug=1.
 */
import { Sunrise } from 'lucide-react';
import type { RunnerRawData } from '@/types/raw-data';
import { CopyDiagnosticsButton, LogsPanel } from './diagnostics-widgets';
import { gameOverCopy, type EndReason } from './gameover-copy';
import { BackButton, MuteButton } from './screen-chrome';

function BigStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0 rounded-2xl border border-brass/15 bg-teak/60 px-2 py-3 text-center sm:px-4">
      {/* fluid type + tabular-nums: big values (454m, high coin counts) must
          never spill outside the tile on narrow phones */}
      <div
        className={`font-heading text-[clamp(1.1rem,6.5vw,1.875rem)] font-black tabular-nums ${accent ? 'text-brass-light' : 'text-brass-pale'}`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wider text-brass-pale/50">{label}</div>
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

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center p-4">
      <BackButton onClick={onHome} />
      <MuteButton />
      <div className="w-full max-w-md rounded-glass border border-brass/15 bg-teak-deep/90 p-8 text-center shadow-glass">
        {/* one outcome only: you reached the plateau. There is no fail
            state to badge any more. */}
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-brass/50 bg-brass/10 shadow-[0_0_40px_rgba(245,197,66,0.35)]">
          <Sunrise className="h-10 w-10 text-brass-light" />
        </div>
        <h1 className="mt-4 font-heading text-4xl font-black text-brass-pale">{copy.title}</h1>
        <p className="mt-2 text-sm text-brass-pale/70">{copy.sub}</p>

        <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3">
          <BigStat label="Distance" value={`${Math.round(raw.distance)}m`} />
          <BigStat label="Mohurs" value={`${raw.coinsCollected}`} accent />
          <BigStat label="Cleared" value={`${raw.obstaclesCleared}`} />
        </div>

        {/* stumbles as a plain fact of the trail, never as a verdict */}
        <p className="mt-4 text-sm text-brass-pale/50">
          {raw.obstaclesFailed === 0
            ? 'Not one stumble the whole way down.'
            : `${raw.obstaclesFailed} stumble${raw.obstaclesFailed === 1 ? '' : 's'} on the trail — you carried on each time.`}
        </p>

        <div className="mt-7 flex gap-3">
          <button
            onClick={onSeeReport}
            className="flex-1 rounded-xl bg-brass px-4 py-3 font-heading font-bold text-teak-deep transition hover:bg-brass-light"
          >
            See your report
          </button>
          <button
            onClick={onRunAgain}
            className="rounded-xl border border-brass/30 px-4 py-3 text-sm font-semibold text-brass-pale transition hover:bg-brass/10"
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
