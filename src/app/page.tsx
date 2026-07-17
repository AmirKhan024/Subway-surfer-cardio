'use client';

/**
 * Kriya Runner — Level 1: top-level screen machine.
 * START → CALIBRATION (body control) → PLAYING → REPORT
 *
 * M0 stub: renders a placeholder start card. The real screens land in
 * M1 (world + keyboard), M2 (calibration), M4 (report).
 */
import { useState } from 'react';

type Screen = 'start' | 'calibration' | 'playing' | 'report';

export default function Home() {
  const [screen] = useState<Screen>('start');

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      {screen === 'start' && (
        <div className="max-w-md rounded-glass border border-white/10 bg-surface p-8 text-center shadow-glass">
          <h1 className="font-heading text-3xl font-bold">Kriya Runner</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Level 1 — first-person, one lane. Jump the striped hurdles, squat
            under the beams. The view rises and dips with your body.
          </p>
          <p className="mt-6 text-xs text-accent-amber">
            ⚠️ Avoid if you have active pain. Consult a physician first.
          </p>
          <p className="mt-4 text-xs text-muted-foreground">M0 scaffold — game lands in M1.</p>
        </div>
      )}
    </main>
  );
}
