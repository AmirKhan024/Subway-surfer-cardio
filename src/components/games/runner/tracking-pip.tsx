'use client';

/**
 * Tracking PiP — small mirrored camera thumbnail with a cyan skeleton and a
 * TRACKING / STEP BACK / RECENTER status strip. The only self-view in the
 * game; it exists so lost tracking never looks like a broken game.
 *
 * Mirroring happens HERE at draw time (prod rule: engines get raw coords;
 * mirror at the render layer only).
 */
import { useEffect, useRef, type RefObject, type MutableRefObject } from 'react';
import type { PoseLandmarks } from '@/modules/pose/types';
import { POSE_CONNECTIONS } from '@/modules/pose/landmarks';

const W = 96;
const H = 128;
const MIN_VIS = 0.3;
const DRAW_INTERVAL_MS = 66; // ~15fps is plenty for a thumbnail

export default function TrackingPip({
  videoRef,
  landmarksRef,
  tracking,
  drifting,
}: {
  videoRef: RefObject<HTMLVideoElement>;
  landmarksRef: MutableRefObject<PoseLandmarks | null>;
  tracking: boolean;
  drifting: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    let lastDraw = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const now = performance.now();
      if (now - lastDraw < DRAW_INTERVAL_MS) return;
      lastDraw = now;
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video || video.readyState < 2) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // mirrored video
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, W, H);
      ctx.restore();

      // mirrored skeleton
      const lms = landmarksRef.current;
      if (lms && lms.length >= 33) {
        ctx.strokeStyle = 'rgba(6,182,212,0.9)';
        ctx.fillStyle = 'rgba(6,182,212,0.9)';
        ctx.lineWidth = 1.5;
        for (const [a, b] of POSE_CONNECTIONS) {
          const la = lms[a];
          const lb = lms[b];
          if (!la || !lb || la.visibility < MIN_VIS || lb.visibility < MIN_VIS) continue;
          ctx.beginPath();
          ctx.moveTo((1 - la.x) * W, la.y * H);
          ctx.lineTo((1 - lb.x) * W, lb.y * H);
          ctx.stroke();
        }
        for (const lm of lms) {
          if (lm.visibility < MIN_VIS) continue;
          ctx.beginPath();
          ctx.arc((1 - lm.x) * W, lm.y * H, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [videoRef, landmarksRef]);

  const status = !tracking ? 'STEP BACK' : drifting ? 'RECENTER' : 'TRACKING';
  const statusColor = !tracking
    ? 'bg-red-500/90 text-white'
    : drifting
      ? 'bg-amber-500/90 text-slate-950'
      : 'bg-cyan-500/85 text-slate-950';

  return (
    <div className="absolute right-3 top-3 z-20 overflow-hidden rounded-xl border border-white/20 shadow-glass-sm">
      <canvas ref={canvasRef} width={W} height={H} className="block bg-slate-900" />
      <div className={`px-1 py-0.5 text-center text-[10px] font-bold tracking-wider ${statusColor}`}>
        {status}
      </div>
    </div>
  );
}
