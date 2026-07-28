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
import { actForProgress, actMeta, type ActId } from './runner-acts';

export interface HudState {
  distance: number;
  /** obstacles missed. A tally, NOT a life bar — nothing depletes toward a
   *  fail state, because there isn't one: the run always plays to the timer. */
  stumbles: number;
  /** obstacles cleared — raw count, no denominator (endless mode) */
  cleared: number;
  cue: CueState | null;
  lowImpact: boolean;
  /** head/neck control: cues read LOOK UP / LOOK DOWN */
  headMode?: boolean;
  /** engagement only — never scored */
  coins: number;
  /** consecutive clean clears, 0..streakTarget-1 — the pip row. Engagement
   *  only: this is a reason to keep clearing cleanly, not a measurement. */
  cleanStreak: number;
  /** clean clears that seal a Kosha (KOSHA.STREAK_TARGET) — the pip count */
  streakTarget: number;
  /** Koshas sealed this run — the pip row pops when this increments */
  sealedKoshas: number;
  /** session time remaining in ms (game-clock time), null = no timer */
  timerMs: number | null;
  /** chosen session length in ms — drives the top progress bar */
  sessionMs: number | null;
}

function fmtTimer(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The one chip surface — brass on teak, not a black rectangle.
 *
 * Every chip in the cluster shares this so they read as ONE crafted set: a
 * fixed height (the old py-1 / py-0.5 mix made the wrap look accidental), a
 * hairline brass border, and a bevel made of two inset shadows — a brass
 * top-highlight and a black bottom shade. Composed as an arbitrary shadow
 * rather than a new Tailwind token so the config stays untouched; the outer
 * drop is the old `glass-sm` value, kept.
 */
const CHIP_SHELL =
  'inline-flex items-center justify-center rounded-[10px] border border-brass/40 ' +
  'bg-gradient-to-b from-teak-light/75 to-teak-deep/85 backdrop-blur-md ' +
  'shadow-[inset_0_1px_0_rgba(242,223,166,0.20),inset_0_-1px_0_rgba(0,0,0,0.35),0_4px_16px_0_rgba(15,23,42,0.25)]';

/** the one chip height. Kept OUT of CHIP_SHELL so a consumer can override it
 *  without two competing h-* utilities landing in the same class string. */
const CHIP_H = 'h-6 sm:h-7';

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${CHIP_SHELL} ${CHIP_H} px-2 text-xs font-semibold text-brass-pale sm:px-3 sm:text-sm`}
    >
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
    // deliberately NOT a chip — it is a painted roadside stone, and the one
    // light-on-dark element in the cluster. Only its HEIGHT joins the system,
    // so the two columns line up however the cluster wraps.
    <div className="flex h-6 flex-col overflow-hidden rounded-md border border-black/50 shadow-glass-sm sm:h-7">
      <div className="h-1.5 shrink-0 bg-gradient-to-b from-brass-light to-brass" />
      <div className="flex flex-1 items-center justify-center bg-gradient-to-b from-[#F0EDE4] to-[#DCD7CB] px-2 text-center">
        <span className="font-heading text-xs font-black tabular-nums text-teak sm:text-sm">
          {metres}
        </span>
        <span className="ml-0.5 text-[9px] font-bold text-teak/70">m</span>
      </div>
    </div>
  );
}

/**
 * Stumble tally — a boot skidding on loose stone.
 *
 * Deliberately NOT hearts and deliberately not depleting: there is no death
 * state any more, so a HUD element that drains toward one would be a lie.
 * Muted so it informs without alarming mid-run.
 */
function StumbleIcon() {
  return (
    <svg viewBox="0 0 16 14" aria-hidden className="h-3.5 w-4">
      <path
        d="M2.5 11.5c2-1.2 3.4-2.6 4.2-4.2M6.7 7.3 5 4.6M6.7 7.3l3 .6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M10 9.6c1.6.3 2.8.9 3.6 1.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <circle cx="10.6" cy="3.4" r="1.5" fill="currentColor" />
    </svg>
  );
}

/**
 * Cleared tally — a torana, the timber trail gateway.
 *
 * A gate is literally what the count measures: every hurdle and beam is a
 * gate you pass through. Deliberately NOT a milepost (the milestone stone two
 * chips to its left already IS one) and NOT cairn notches (the cairn is the
 * Walong memorial — it must never read as a score). Same 16×14 box, same
 * brass line-weight and the same finial-dot idiom as StumbleIcon, so the two
 * glyphs are visibly siblings.
 */
function ClearedIcon() {
  return (
    <svg viewBox="0 0 16 14" aria-hidden className="h-3.5 w-4">
      {/* lintel */}
      <path d="M1.6 4.4h12.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      {/* uprights */}
      <path d="M3.7 13V4.4M12.3 13V4.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      {/* the opening you pass under */}
      <path
        d="M5.5 13V9.2a2.5 2.5 0 0 1 5 0V13"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        fill="none"
      />
      {/* finial */}
      <path d="M8 4.4V2.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
      <circle cx="8" cy="1.8" r="1.2" fill="currentColor" />
    </svg>
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

/**
 * Clean-streak pips — the studs on the Kosha's lid band. They fill as the
 * streak builds, empty the instant a stumble takes it, and the whole row pops
 * when the fifth seals a Kosha. This visible goal IS the retention loop: the
 * player should always be able to see how close the next chest is.
 *
 * The pop is a remount keyed on `sealed` (the same trick the action cue uses
 * below), so it costs one keyed element and no animation clock — and it is
 * `motion-safe:` gated, so reduced-motion users still get the fill/empty
 * state change with no movement at all.
 */
function StreakPips({
  streak,
  target,
  sealed,
}: {
  streak: number;
  target: number;
  sealed: number;
}) {
  return (
    <div
      key={sealed}
      // its own surface rather than CHIP_SHELL: the studs need a DARK socket
      // plate behind them (a teak gradient would wash the unlit rims out), and
      // that means no gradient — same border and bevel language, flat backing.
      className="inline-flex h-[18px] items-center justify-center gap-[3px] rounded-[10px]
                 border border-brass/40 bg-black/45 px-2 backdrop-blur-md
                 shadow-[inset_0_1px_2px_rgba(0,0,0,0.55),0_4px_16px_0_rgba(15,23,42,0.25)]
                 motion-safe:animate-cue-pop"
      title={`Clean streak — ${target} in a row seals a Kosha`}
      aria-label={`Clean streak ${streak} of ${target}`}
    >
      {Array.from({ length: target }, (_, i) => {
        const lit = i < streak;
        return (
          <span
            key={i}
            className="h-[7px] w-[7px] rounded-full transition-[background,box-shadow] duration-200"
            style={{
              // brass tokens as literals — Tailwind can't compose a
              // runtime-conditional arbitrary gradient or box-shadow.
              // LIT: an off-centre highlight domes the disc into a brass stud.
              // UNLIT: an inset top shadow sinks it, and the 0-blur spread ring
              // is the visible empty rim — so "not filled yet" reads at a
              // glance instead of vanishing into the chip.
              background: lit
                ? 'radial-gradient(circle at 34% 28%, #F7EBC4 0%, #E8C46A 52%, #A8842A 100%)'
                : 'rgba(0,0,0,0.42)',
              boxShadow: lit
                ? '0 0 6px rgba(232,196,106,0.85), inset 0 -1px 1px rgba(0,0,0,0.40)'
                : 'inset 0 1px 2px rgba(0,0,0,0.70), 0 0 0 1px rgba(201,162,39,0.50)',
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * Act title card — "Kaho", "Lohit Paar", "Dong" with a one-line beat.
 *
 * NON-BLOCKING by construction: pointer-events-none, no state read by the
 * game loop, and it unmounts itself on animationend. The run never pauses.
 *
 * LOWER THIRD on purpose. Obstacles are read in the centre and upper-centre
 * of the frame — by the time one reaches this band the decision window has
 * long closed. Placing the card here is what keeps obstacle TIMING untouched:
 * nothing is delayed or moved to make room for it.
 *
 * Reduced motion swaps to an opacity-only keyframe of the SAME duration
 * rather than removing the animation — a card whose animation never runs
 * would never fire animationend, and would sit on screen for the whole run.
 */
export function ActTitleCard({
  act,
  reduced,
  onDone,
}: {
  act: ActId;
  reduced: boolean;
  onDone: () => void;
}) {
  const m = actMeta(act);
  return (
    <div
      role="status"
      aria-live="polite"
      onAnimationEnd={onDone}
      className={`pointer-events-none absolute left-1/2 z-30 w-max max-w-[62vw] rounded-xl
                  border border-brass/30 bg-teak-deep/75 px-4 py-2 text-center backdrop-blur-md
                  shadow-glass-sm sm:max-w-sm [will-change:opacity,transform]
                  ${reduced ? 'animate-act-card-flat' : 'animate-act-card'}`}
      // clears the disclaimer (bottom 0.5rem, ~1.75rem tall) and sits inboard
      // of the mute chip at bottom-10 right-3
      style={{ bottom: 'calc(2.75rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <div
        className="text-[10px] font-bold tracking-[0.28em]"
        style={{ color: m.accent }}
      >
        ACT {m.numeral}
      </div>
      <div className="font-heading text-lg font-bold text-brass-pale">{m.name}</div>
      <div className="text-[11px] text-brass-pale/70">{m.beat}</div>
    </div>
  );
}

/**
 * The two finale beats: the Walong memorial, then the Lohit Gold Rush.
 *
 * Same shell as ActTitleCard — non-blocking, lower third, clear of the lane,
 * unmounts on animationend — because the constraint is identical: the run
 * must not pause and the obstacle must not be covered. Nothing is delayed or
 * moved to make room for either card.
 *
 * The Walong copy is deliberately plain. It is a real 1962 battle site; the
 * card names it and gets out of the way.
 */
export function FinaleCard({
  kind,
  reduced,
  onDone,
}: {
  kind: 'beat' | 'gold';
  reduced: boolean;
  onDone: () => void;
}) {
  const beat = kind === 'beat';
  const accent = beat ? '#A9C9D4' : '#E8C46A';
  return (
    <div
      role="status"
      aria-live="polite"
      onAnimationEnd={onDone}
      className={`pointer-events-none absolute left-1/2 z-30 w-max max-w-[62vw] rounded-xl
                  border bg-teak-deep/75 px-4 py-2 text-center backdrop-blur-md
                  shadow-glass-sm sm:max-w-sm [will-change:opacity,transform]
                  ${beat ? 'border-frost/25' : 'border-brass/40'}
                  ${reduced ? 'animate-act-card-flat' : 'animate-act-card'}`}
      style={{ bottom: 'calc(2.75rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="text-[10px] font-bold tracking-[0.28em]" style={{ color: accent }}>
        {beat ? 'WALONG' : 'LOHIT GOLD'}
      </div>
      <div className="font-heading text-lg font-bold text-brass-pale">
        {beat ? 'The memorial' : 'The valley turns'}
      </div>
      <div className="text-[11px] text-brass-pale/70">
        {beat ? 'Breathe. They held this ground.' : 'Take everything. The light is yours.'}
      </div>
    </div>
  );
}

/** Where you are, under the milestone stone. Brass and teak, one line. */
function ActChip({ act }: { act: ActId }) {
  const m = actMeta(act);
  return (
    <div
      // a sub-line under the stone, so it is the one chip that runs shorter
      className={`${CHIP_SHELL} h-[18px] px-1.5 text-center text-[9px] font-bold uppercase tracking-[0.16em]`}
      style={{ color: m.accent }}
      title={m.beat}
    >
      {m.numeral} · {m.name}
    </div>
  );
}

/** cast brass, lit from the upper-left — the cue's bezel and nothing else */
const BEZEL: React.CSSProperties = {
  background: 'linear-gradient(150deg, #F2DFA6 0%, #C9A227 45%, #8A6F1E 100%)',
  boxShadow:
    '0 0 0 1px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.35), 0 4px 16px rgba(15,23,42,0.35)',
};

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
      {/* brass bezel — a struck ring the cue sits in. The cue-COLOUR border
          stays inside it: saffron/frost is how the action is read, and that
          coding is not decoration. Skin only; nothing here is timing. */}
      {iconSrc ? (
        <div className="rounded-full p-[3px]" style={BEZEL}>
          <img
            src={iconSrc}
            alt=""
            draggable={false}
            className="h-20 w-20 rounded-full border-2 bg-teak-deep/80 object-cover backdrop-blur-md"
            style={{ borderColor: color }}
          />
        </div>
      ) : (
        <div className="rounded-[1.1rem] p-[3px]" style={BEZEL}>
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 bg-teak-deep/80 text-3xl backdrop-blur-md"
            style={{ borderColor: color, color }}
          >
            {icon}
          </div>
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
  // where you are on the journey — derived from the SAME progress value the
  // prayer flags and the dawn ramp read, so nothing new is plumbed through
  // HudState and there is one source of truth for the acts
  const act = progress === null ? null : actForProgress(progress);
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
        className="absolute left-3 flex max-w-[38vw] flex-wrap items-start gap-1 sm:max-w-none sm:gap-1.5"
        style={{ top: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}
      >
        {/* the milestone stone and the place you are passing through, as a
            column — so naming the act costs no extra width in the cluster */}
        <div className="flex flex-col items-stretch gap-[3px]">
          <MilestoneStone metres={Math.floor(hud.distance)} />
          {act !== null && <ActChip act={act} />}
        </div>
        <Chip>
          <span
            className="flex items-center gap-1 text-brass-pale/60"
            title="Stumbles — the trail slows you, it never stops you"
          >
            <StumbleIcon />
            {hud.stumbles}
          </span>
        </Chip>
        {/* full-strength brass: cleared is the positive tally, stumbles above
            stay muted on purpose */}
        <Chip>
          <span className="flex items-center gap-1 text-brass-pale" title="Gates cleared">
            <ClearedIcon />
            {hud.cleared}
          </span>
        </Chip>
        {/* the Kosha chip and its streak pips travel together: a column, so
            the pips always sit directly UNDER the reward they feed, however
            the cluster wraps on a narrow phone */}
        <div className="flex flex-col items-stretch gap-[3px]">
          <Chip>
            <span className="flex items-center gap-1 text-brass-light">
              <KoshaIcon />
              {hud.coins}
              {hud.sealedKoshas > 0 && (
                <span className="text-brass-pale/70">·{hud.sealedKoshas}</span>
              )}
            </span>
          </Chip>
          <StreakPips
            streak={hud.cleanStreak}
            target={hud.streakTarget}
            sealed={hud.sealedKoshas}
          />
        </div>
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
