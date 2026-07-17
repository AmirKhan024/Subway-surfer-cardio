'use client';

/**
 * Runner HUD — dark glass chips over the bright FPP world.
 * Top-left: Dist / Lives / Ctrl. Center-top: the action cue (icon + label +
 * timing bar — the bar filling = act NOW). Bottom: persistent disclaimer.
 */
import type { CueState } from '@/modules/game/engines/runner-engine';
import { COLORS } from './runner-constants';

export interface HudState {
  distance: number;
  lives: number;
  cleared: number;
  total: number;
  controlLabel: string;
  cue: CueState | null;
  lowImpact: boolean;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-1.5 text-sm font-semibold text-slate-50 backdrop-blur-md shadow-glass-sm">
      {children}
    </div>
  );
}

export function ActionCue({ cue, lowImpact }: { cue: CueState; lowImpact: boolean }) {
  const isJump = cue.type === 'hurdle';
  const color = isJump ? COLORS.jump : COLORS.squat;
  const label = isJump ? (lowImpact ? 'HEEL RAISE' : 'JUMP') : 'SQUAT';
  const icon = isJump ? '⬆' : '⬇';
  return (
    <div className="flex flex-col items-center gap-1.5 transition-opacity duration-150">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 bg-slate-950/65 text-3xl backdrop-blur-md"
        style={{ borderColor: color, color }}
      >
        {icon}
      </div>
      <div className="text-sm font-bold tracking-widest" style={{ color }}>
        {label}
      </div>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-950/60">
        <div
          className="h-full rounded-full transition-[width] duration-75"
          style={{ width: `${Math.round(cue.progress * 100)}%`, background: color }}
        />
      </div>
    </div>
  );
}

export default function RunnerHUD({ hud }: { hud: HudState }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* top-left chips */}
      <div className="absolute left-3 top-3 flex gap-2">
        <Chip>Dist {Math.floor(hud.distance)}m</Chip>
        <Chip>
          <span className="text-rose-400">{'♥'.repeat(Math.max(0, hud.lives))}</span>
          <span className="text-slate-500">{'♥'.repeat(Math.max(0, 3 - hud.lives))}</span>
        </Chip>
        <Chip>
          {hud.cleared}/{hud.total}
        </Chip>
        <Chip>Ctrl {hud.controlLabel}</Chip>
      </div>

      {/* center-top action cue */}
      {hud.cue && (
        <div className="absolute left-1/2 top-16 -translate-x-1/2">
          <ActionCue cue={hud.cue} lowImpact={hud.lowImpact} />
        </div>
      )}

      {/* persistent disclaimer */}
      <div className="absolute bottom-2 left-1/2 w-max max-w-[92vw] -translate-x-1/2 rounded-lg border border-amber-500/30 bg-slate-950/70 px-3 py-1 text-center text-[11px] text-amber-200/90 backdrop-blur-md">
        ⚠️ Avoid if you have active pain. Consult a physician first.
      </div>
    </div>
  );
}
