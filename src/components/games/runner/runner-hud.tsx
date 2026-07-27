'use client';

/**
 * "The Final Run" HUD — brass & teak over the dark valley.
 * Top: a line of prayer flags for session progress. Top-left: the milestone
 * stone (distance), lives, cleared, and the Kosha (mohurs). Center-top: the
 * action cue (icon + label + timing bar — the bar filling = act NOW).
 * Bottom: persistent disclaimer.
 *
 * Values and logic are untouched from the original chrome HUD; this is paint.
 */
import type { CueState } from '@/modules/game/engines/runner-engine';
import { getReadyCueImage } from '@/lib/media/cue-preloader';
import { cueLabel } from '@/lib/media/mode-media';
import { COLORS } from './runner-constants';

export interface HudState {
  distance: number;
  lives: number;
  /** obstacles cleared — raw count, no denominator (endless mode) */
  cleared: number;
  cue: CueState | null;
  lowImpact: boolean;
  /** head/neck control: cues read LOOK UP / LOOK DOWN */
  headMode?: boolean;
  /** engagement only — never scored */
  coins: number;
  /** session time remaining in ms (game-clock time), null = no timer */
  timerMs: number | null;
  /** chosen session length in ms — drives the top progress bar */
  sessionMs: number | null;
}

function fmtTimer(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-brass/30 bg-teak-deep/75 px-2 py-1 text-xs font-semibold text-brass-pale backdrop-blur-md shadow-glass-sm sm:px-3 sm:py-1.5 sm:text-sm">
      {children}
    </div>
  );
}

/** lung ta — the five elements, in the traditional order */
const LUNG_TA = ['#2b6cb0', '#f7f7f2', '#c53030', '#2f855a', '#e8b339'];

/**
 * Session progress as a line of prayer flags — one per 10%, colouring in as
 * the run goes. Same value the old bar used; only opacity/saturate animate,
 * so this stays as cheap as the scaleX bar it replaces at 10Hz HUD updates.
 */
function PrayerFlagBar({ progress }: { progress: number }) {
  return (
    <div
      className="absolute inset-x-0 top-0"
      style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="h-px w-full bg-brass/40" />
      <div className="flex h-2 items-start gap-[5px] px-1.5">
        {Array.from({ length: 10 }, (_, i) => {
          const lit = progress * 10 > i;
          return (
            <div
              key={i}
              className="h-full flex-1 transition-[opacity,filter] duration-300 ease-linear [will-change:opacity]"
              style={{
                background: LUNG_TA[i % 5],
                clipPath: 'polygon(0 0, 100% 0, 50% 100%)',
                opacity: lit ? 0.95 : 0.16,
                filter: lit ? 'saturate(1)' : 'saturate(0.1)',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Distance as a roadside kilometre stone — same value, hand-painted. */
function MilestoneStone({ metres }: { metres: number }) {
  return (
    <div className="overflow-hidden rounded-md border border-black/50 shadow-glass-sm">
      <div className="h-1.5 bg-brass" />
      <div className="bg-[#E8E4DA] px-2 py-0.5 text-center">
        <span className="font-heading text-xs font-black tabular-nums text-teak sm:text-sm">
          {metres}
        </span>
        <span className="ml-0.5 text-[9px] font-bold text-teak/70">m</span>
      </div>
    </div>
  );
}

/** The Kosha — the brass-bound pay-casket the mohurs go into. */
function KoshaIcon() {
  return (
    <svg viewBox="0 0 16 14" aria-hidden className="h-3.5 w-4">
      <path d="M1 5h14v8H1z" fill="#7A5C2E" stroke="#E8C46A" strokeWidth="1" />
      <path d="M1 5C1 2.5 3 1 8 1s7 1.5 7 4" fill="#8A6F1E" stroke="#E8C46A" strokeWidth="1" />
      <path d="M1 8h14" stroke="#E8C46A" strokeWidth="1" />
      <rect x="6.75" y="6.5" width="2.5" height="3.5" rx="0.6" fill="#F2DFA6" />
    </svg>
  );
}

export function ActionCue({
  cue,
  lowImpact,
  headMode = false,
}: {
  cue: CueState;
  lowImpact: boolean;
  headMode?: boolean;
}) {
  const isJump = cue.type === 'hurdle';
  const color = isJump ? COLORS.jump : COLORS.squat;
  // pose/keyboard share the Body asset+label set, so headMode alone picks the mode
  const mode = headMode ? 'head' : 'pose';
  const label = cueLabel(mode, cue.type, lowImpact);
  const icon = isJump ? '⬆' : '⬇';
  // preloaded+decoded ahead of gameplay; null → arrow fallback, never a broken image
  const iconSrc = getReadyCueImage(mode, isJump ? 'up' : 'down');
  return (
    <div className="flex flex-col items-center gap-1.5 transition-opacity duration-150">
      {iconSrc ? (
        <img
          src={iconSrc}
          alt=""
          draggable={false}
          className="h-20 w-20 rounded-full border-2 bg-teak-deep/80 object-cover backdrop-blur-md"
          style={{ borderColor: color }}
        />
      ) : (
        <div
          className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 bg-teak-deep/80 text-3xl backdrop-blur-md"
          style={{ borderColor: color, color }}
        >
          {icon}
        </div>
      )}
      <div className="text-sm font-bold tracking-widest" style={{ color }}>
        {label}
      </div>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-teak-deep/80">
        <div
          className="h-full rounded-full transition-[width] duration-75"
          style={{ width: `${Math.round(cue.progress * 100)}%`, background: color }}
        />
      </div>
    </div>
  );
}

export default function RunnerHUD({ hud }: { hud: HudState }) {
  const timerLow = hud.timerMs !== null && hud.timerMs <= 10_000;
  const progress =
    hud.timerMs !== null && hud.sessionMs !== null && hud.sessionMs > 0
      ? Math.min(1, Math.max(0, 1 - hud.timerMs / hud.sessionMs))
      : null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* session progress — a line of prayer flags, one per 10% */}
      {progress !== null && <PrayerFlagBar progress={progress} />}
      {/* session timer — active-movement time only (pauses/rests don't tick) */}
      {hud.timerMs !== null && (
        <div
          className={`absolute left-1/2 -translate-x-1/2 rounded-xl border bg-teak-deep/75 px-4 py-1.5 font-heading text-lg font-bold tabular-nums backdrop-blur-md sm:text-xl ${
            timerLow
              ? 'border-saffron/60 text-saffron motion-safe:animate-pulse'
              : 'border-brass/30 text-brass-pale'
          }`}
          style={{ top: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}
        >
          {fmtTimer(hud.timerMs)}
        </div>
      )}
      {/* top-left chips — wrap into a narrow stack on phones so they never
          collide with the centered timer or the pause chip */}
      <div
        className="absolute left-3 flex max-w-[38vw] flex-wrap gap-1.5 sm:max-w-none sm:gap-2"
        style={{ top: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}
      >
        <MilestoneStone metres={Math.floor(hud.distance)} />
        <Chip>
          <span className="text-[#E2664A]">{'♥'.repeat(Math.max(0, hud.lives))}</span>
          <span className="text-teak-light">{'♥'.repeat(Math.max(0, 3 - hud.lives))}</span>
        </Chip>
        <Chip>✓ {hud.cleared}</Chip>
        <Chip>
          <span className="flex items-center gap-1 text-brass-light">
            <KoshaIcon />
            {hud.coins}
          </span>
        </Chip>
      </div>

      {/* center-top action cue — keyed per obstacle so every NEW cue pops
          (scale-in, transform-only, motion-safe) — works in all modes */}
      {hud.cue && (
        <div
          key={hud.cue.obstacleId}
          className="absolute left-1/2 top-16 -translate-x-1/2 motion-safe:animate-cue-pop [will-change:transform]"
        >
          <ActionCue cue={hud.cue} lowImpact={hud.lowImpact} headMode={hud.headMode} />
        </div>
      )}

      {/* persistent disclaimer (safe-area aware) */}
      <div
        className="absolute left-1/2 w-max max-w-[92vw] -translate-x-1/2 rounded-lg border border-saffron/30 bg-teak-deep/80 px-3 py-1 text-center text-[11px] text-brass-pale/90 backdrop-blur-md"
        style={{ bottom: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        ⚠️ Avoid if you have active pain. Consult a physician first.
      </div>
    </div>
  );
}
