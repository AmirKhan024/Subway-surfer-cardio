'use client';

/**
 * Kriya Runner — Level 1: top-level screen machine.
 * START → PLAYING (RunnerLayer owns calibration/countdown internally) → REPORT
 *
 * Seed policy: first run of the session uses the fixed assessment seed;
 * "Run again" rotates through the matched-difficulty pool so courses can't
 * be memorized (see runner-timeline.ts NOTE).
 */
import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import StartScreen, { type RunnerProfile } from '@/components/games/runner/start-screen';
import ReportScreen from '@/components/games/runner/report-screen';
import GameOverScreen from '@/components/games/runner/gameover-screen';
import { seedForAttempt } from '@/modules/game/engines/runner-timeline';
import type { RunnerRawData } from '@/types/raw-data';
import type { ControlMode } from '@/modules/game/engines/runner-engine';
import { computeKR1Score } from '@/lib/scoring/kr1-local';
import { getAgeCohortIdx, getPreCondBandIdx } from '@/lib/scoring/kr1-matrices';
import {
  APP_VERSION,
  getLogEntries,
  installErrorCapture,
  klog,
  setRunReport,
} from '@/lib/debug/run-logger';

// Three.js + camera stack is client-only
const RunnerLayer = dynamic(() => import('@/components/games/runner/runner-layer'), {
  ssr: false,
});

type Screen = 'start' | 'playing' | 'gameover' | 'report';

/**
 * The end-of-run diagnostics artifact: one console group + the same object
 * stored for the report screen's "Copy diagnostics" button. Contains config,
 * the full raw data, EVERY scoring intermediate, the per-obstacle gate
 * values, and run-health warnings — enough to diagnose a bug from one paste.
 */
function emitRunReport(
  raw: RunnerRawData,
  profile: RunnerProfile,
  mode: ControlMode,
  attempt: number,
  debug: boolean,
): void {
  const score = computeKR1Score(raw, profile.age);
  // per-obstacle + health data come from the event buffer, scoped to this
  // run (everything after the last RUN_RESET)
  const entries = getLogEntries();
  let runStart = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].tag === 'RUN_RESET') {
      runStart = i;
      break;
    }
  }
  const runEntries = entries.slice(runStart);
  const byTag = (tag: string) => runEntries.filter((e) => e.tag === tag);
  const obstacles = byTag('OBSTACLE').map((e) => e.data as Record<string, unknown>);
  const reps = byTag('REP').map((e) => e.data as Record<string, unknown>);
  const errors = entries
    .filter((e) => ['ERROR', 'UNHANDLED_REJECTION', 'CONSOLE_ERROR'].includes(e.tag))
    .map((e) => e.data);

  const report: Record<string, unknown> = {
    config: {
      controlScheme: mode,
      lowImpact: raw.lowImpact === 1,
      seed: raw.seed,
      attempt,
      bobScale: profile.bobScale,
      age: profile.age,
      gender: profile.gender,
      debugMode: debug,
      version: APP_VERSION,
      timestamp: new Date().toISOString(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a',
      viewport:
        typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : 'n/a',
    },
    rawData: raw,
    scoring: {
      xBandIdx: score.xBandIdx,
      yBandIdx: score.yBandIdx,
      preCond: score.preCond,
      ageCohortIdx: getAgeCohortIdx(profile.age),
      preCondBandIdx: score.incomplete ? null : getPreCondBandIdx(score.preCond),
      ageFactor: score.ageFactor,
      conditioned: score.conditioned,
      musculage: score.musculage,
      incomplete: score.incomplete,
      assessmentValid: raw.assessmentValid === 1,
    },
    obstacles,
    reps,
    health: {
      trackingLostCount: byTag('TRACKING_LOST').length,
      driftEvents: byTag('DRIFT_ON').length,
      calibWobbleResets: byTag('CALIB_WOBBLE_RESET').length,
      calibRetries: byTag('CALIB_RETRY').length,
      capturedErrors: errors,
    },
  };

  setRunReport(report);
  klog('RUN_REPORT_EMITTED', { musculage: score.musculage });
  /* eslint-disable no-console */
  console.groupCollapsed('===== KRIYA RUN REPORT =====');
  console.log('config', report.config);
  console.log('rawData', report.rawData);
  console.log('scoring', report.scoring);
  if (obstacles.length > 0) console.table(obstacles);
  console.log('reps', reps);
  console.log('health', report.health);
  console.groupEnd();
  /* eslint-enable no-console */
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>('start');
  const [profile, setProfile] = useState<RunnerProfile | null>(null);
  const [mode, setMode] = useState<ControlMode>('keyboard');
  const [attempt, setAttempt] = useState(0);
  const [lastRaw, setLastRaw] = useState<RunnerRawData | null>(null);
  const [debug] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug'),
  );

  useEffect(() => {
    installErrorCapture();
    klog('BOOT', { version: APP_VERSION });
  }, []);

  const handlePlay = useCallback((p: RunnerProfile, m: ControlMode) => {
    setProfile(p);
    setMode(m);
    setScreen('playing');
  }, []);

  const handleComplete = useCallback(
    (raw: RunnerRawData) => {
      if (profile) emitRunReport(raw, profile, mode, attempt, debug);
      setLastRaw(raw);
      setScreen('gameover'); // celebratory beat first; report follows
    },
    [profile, mode, attempt, debug],
  );

  const handleRunAgain = useCallback(() => {
    setAttempt((a) => a + 1);
    setScreen('playing');
  }, []);

  if (screen === 'playing' && profile) {
    return (
      <RunnerLayer
        controlMode={mode}
        lowImpact={profile.lowImpact}
        seed={seedForAttempt(attempt)}
        bobScale={profile.bobScale}
        debug={debug}
        onComplete={handleComplete}
        onExit={() => setScreen('start')}
        onFallbackKeyboard={() => setMode('keyboard')}
      />
    );
  }

  if (screen === 'gameover' && lastRaw) {
    return (
      <GameOverScreen
        raw={lastRaw}
        onSeeReport={() => setScreen('report')}
        onRunAgain={handleRunAgain}
      />
    );
  }

  if (screen === 'report' && lastRaw && profile) {
    return (
      <ReportScreen
        raw={lastRaw}
        age={profile.age}
        onRunAgain={handleRunAgain}
        onChangeSettings={() => setScreen('start')}
      />
    );
  }

  return <StartScreen onPlay={handlePlay} />;
}
