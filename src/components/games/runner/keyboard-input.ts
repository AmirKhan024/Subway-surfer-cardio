/**
 * Keyboard control: ↑ / Space / W = jump (edge), ↓ / S (hold) = squat.
 * Feeds the same ControlInput the pose path resolves to — one code path.
 */
import type { ControlInput } from '@/modules/game/engines/runner-engine';

const JUMP_CODES = new Set(['ArrowUp', 'Space', 'KeyW']);
const SQUAT_CODES = new Set(['ArrowDown', 'KeyS']);

export function attachKeyboard(
  target: Window,
  onInput: (input: Partial<ControlInput>) => void,
): () => void {
  const down = (e: KeyboardEvent) => {
    if (JUMP_CODES.has(e.code)) {
      e.preventDefault();
      if (!e.repeat) onInput({ jumpPressed: true });
    } else if (SQUAT_CODES.has(e.code)) {
      e.preventDefault();
      onInput({ crouchHeld: true });
    }
  };
  const up = (e: KeyboardEvent) => {
    if (SQUAT_CODES.has(e.code)) onInput({ crouchHeld: false });
  };
  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  return () => {
    target.removeEventListener('keydown', down);
    target.removeEventListener('keyup', up);
  };
}
