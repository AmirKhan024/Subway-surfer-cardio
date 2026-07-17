'use client';

/**
 * Eased 0→1 progress driven by requestAnimationFrame — one value animates
 * both the report ring sweep and the muscle-age count-up so they stay in
 * lockstep. `disabled` (prefers-reduced-motion) returns 1 immediately.
 */
import { useEffect, useState } from 'react';

export function useAnimatedProgress(duration = 1200, disabled = false): number {
  const [t, setT] = useState(disabled ? 1 : 0);

  useEffect(() => {
    if (disabled) {
      setT(1);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setT(1 - Math.pow(1 - p, 3)); // ease-out cubic
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration, disabled]);

  return t;
}
