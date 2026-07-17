'use client';

/**
 * Kriya Runner — Level 1: top-level screen machine.
 * START → PLAYING (RunnerLayer owns calibration/countdown internally) → REPORT
 *
 * Seed policy: first run of the session uses the fixed assessment seed;
 * "Run again" rotates through the matched-difficulty pool so courses can't
 * be memorized (see runner-timeline.ts NOTE).
 */
import { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import StartScreen, { type RunnerProfile } from '@/components/games/runner/start-screen';
import ReportScreen from '@/components/games/runner/report-screen';
import { seedForAttempt } from '@/modules/game/engines/runner-timeline';
import type { RunnerRawData } from '@/types/raw-data';
import type { ControlMode } from '@/modules/game/engines/runner-engine';

// Three.js + camera stack is client-only
const RunnerLayer = dynamic(() => import('@/components/games/runner/runner-layer'), {
  ssr: false,
});

type Screen = 'start' | 'playing' | 'report';

export default function Home() {
  const [screen, setScreen] = useState<Screen>('start');
  const [profile, setProfile] = useState<RunnerProfile | null>(null);
  const [mode, setMode] = useState<ControlMode>('keyboard');
  const [attempt, setAttempt] = useState(0);
  const [lastRaw, setLastRaw] = useState<RunnerRawData | null>(null);
  const [debug] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug'),
  );

  const handlePlay = useCallback((p: RunnerProfile, m: ControlMode) => {
    setProfile(p);
    setMode(m);
    setScreen('playing');
  }, []);

  const handleComplete = useCallback((raw: RunnerRawData) => {
    setLastRaw(raw);
    setScreen('report');
  }, []);

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
        debug={debug}
        onComplete={handleComplete}
        onExit={() => setScreen('start')}
        onFallbackKeyboard={() => setMode('keyboard')}
      />
    );
  }

  if (screen === 'report' && lastRaw) {
    return (
      <ReportScreen
        raw={lastRaw}
        onRunAgain={handleRunAgain}
        onChangeSettings={() => setScreen('start')}
      />
    );
  }

  return <StartScreen onPlay={handlePlay} />;
}
