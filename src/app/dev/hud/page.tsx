'use client';

/**
 * DEV-ONLY HUD preview. Not linked from anywhere in the product.
 *
 * The HUD is pure paint over `HudState`, so the fastest way to review the
 * chip/pip/cue art at every state — and to prove legibility against the Act-3
 * gold sky — is to render it over flat backdrops with fabricated props.
 *
 * This proves the CHROME only. It says nothing about detection, scoring or how
 * the HUD sits over the live scene; those still need a real run.
 */
import RunnerHUD, { type HudState } from '@/components/games/runner/runner-hud';

const SESSION = 90_000;

/** progress p → the remaining-time value the HUD derives everything from */
const atProgress = (p: number) => Math.round(SESSION * (1 - p));

function base(p: number, over: Partial<HudState> = {}): HudState {
  return {
    distance: Math.round(420 * p),
    stumbles: 2,
    cleared: 17,
    cue: { type: 'beam', progress: 0.72, obstacleId: 1 },
    lowImpact: false,
    headMode: false,
    coins: 23,
    cleanStreak: 3,
    streakTarget: 5,
    sealedKoshas: 2,
    timerMs: atProgress(p),
    sessionMs: SESSION,
    ...over,
  };
}

/** the DAWN ramp's sky at that point, so contrast is judged against the real colour */
const PANELS: { label: string; sky: string; hud: HudState }[] = [
  { label: 'Act I · Kaho (p 0.15)', sky: '#10162E', hud: base(0.15, { cleared: 3, coins: 4, cleanStreak: 1, sealedKoshas: 0, stumbles: 0 }) },
  { label: 'Act II · Lohit Paar (p 0.50)', sky: '#4A5A66', hud: base(0.5) },
  { label: 'Act III · saffron (p 0.80)', sky: '#E8913A', hud: base(0.8, { cue: { type: 'beam', progress: 0.9, obstacleId: 2 } }) },
  { label: 'Act III · GOLD (p 0.97)', sky: '#FFCB5C', hud: base(0.97, { cleared: 41, coins: 58, cleanStreak: 5, sealedKoshas: 6, timerMs: 4_000 }) },
  { label: 'GOLD · jump cue, empty streak', sky: '#F5C542', hud: base(0.93, { cue: { type: 'hurdle', progress: 0.35, obstacleId: 3 }, cleanStreak: 0, headMode: true }) },
];

export default function HudPreview() {
  return (
    <main className="min-h-[100dvh] bg-neutral-900 p-4">
      <h1 className="mb-3 font-heading text-lg font-bold text-brass-pale">
        HUD preview — dev only
      </h1>
      <div className="flex flex-wrap gap-4">
        {PANELS.map((p) => (
          <figure key={p.label} className="m-0">
            <div
              data-hud-panel={p.label}
              className="relative h-[420px] w-[300px] overflow-hidden rounded-lg"
              style={{ background: p.sky }}
            >
              <RunnerHUD hud={p.hud} />
            </div>
            <figcaption className="mt-1 text-xs text-neutral-400">{p.label}</figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}
