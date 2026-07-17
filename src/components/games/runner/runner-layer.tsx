'use client';

/**
 * RunnerLayer — bespoke playing layer (precedent: prod's balance/reflex
 * bespoke layers). The FPP world inverts the usual Kriya layout: the game
 * world is the main view and the camera becomes a small PiP (M2).
 *
 * Loop architecture (SPEC §4.2 decoupling):
 *  - pose detection runs its own rAF via usePoseDetector; its callback ONLY
 *    writes latestLandmarksRef — it never ticks the engine.
 *  - ONE game rAF loop ticks engine.processFrame + scene.update at 60fps,
 *    sampling the latest landmarks. React HUD state updates at ~10Hz.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { RunnerEngine, type ControlMode } from '@/modules/game/engines/runner-engine';
import type { RunnerRawData } from '@/types/raw-data';
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationStatus } from '@/modules/game/engines/types';
import { RunnerScene } from './runner-scene';
import { attachKeyboard } from './keyboard-input';
import RunnerHUD, { type HudState } from './runner-hud';
import { useCamera } from '@/lib/mediapipe/use-camera';
import { usePoseDetector } from '@/lib/mediapipe/use-pose';
import TrackingPip from './tracking-pip';

type UiPhase = 'booting' | 'calibrating' | 'countdown' | 'playing' | 'done';

export interface RunnerLayerProps {
  controlMode: ControlMode;
  lowImpact: boolean;
  seed: number;
  /** camera-bob amplitude 0..1 (comfort setting) */
  bobScale?: number;
  debug?: boolean;
  onComplete: (raw: RunnerRawData) => void;
  onExit: () => void;
  onFallbackKeyboard?: () => void;
}

export default function RunnerLayer({
  controlMode,
  lowImpact,
  seed,
  bobScale = 1,
  debug = false,
  onComplete,
  onExit,
  onFallbackKeyboard,
}: RunnerLayerProps) {
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const engineRef = useRef<RunnerEngine | null>(null);
  const sceneRef = useRef<RunnerScene | null>(null);
  const latestLandmarksRef = useRef<PoseLandmarks | null>(null);
  const lastSeenAtRef = useRef(0);
  const phaseRef = useRef<UiPhase>('booting');
  const countdownEndRef = useRef(0);
  const lastHudAtRef = useRef(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const [uiPhase, setUiPhase] = useState<UiPhase>('booting');
  const [countdown, setCountdown] = useState(3);
  const [calStatus, setCalStatus] = useState<CalibrationStatus | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [tracking, setTracking] = useState(true);
  const [drifting, setDrifting] = useState(false);
  const [poseError, setPoseError] = useState<string | null>(null);

  const camera = useCamera();
  const pose = usePoseDetector();

  const setPhase = useCallback((p: UiPhase) => {
    phaseRef.current = p;
    setUiPhase(p);
  }, []);

  // ── pose boot (body-control mode only) ─────────────────────────────────
  useEffect(() => {
    if (controlMode !== 'pose') return;
    let cancelled = false;
    (async () => {
      try {
        if (!videoRef.current) return;
        await camera.start(videoRef.current);
        await pose.init();
        if (cancelled) return;
        pose.startDetection(videoRef.current, (landmarks) => {
          latestLandmarksRef.current = landmarks;
          if (landmarks) lastSeenAtRef.current = performance.now();
        });
      } catch (err) {
        if (!cancelled) {
          setPoseError(
            err instanceof Error
              ? err.message
              : 'Camera or pose model failed to load (internet needed on first run).',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      pose.stopDetection();
      camera.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlMode]);

  // surface pose hook init errors too
  useEffect(() => {
    if (pose.error) setPoseError(pose.error);
  }, [pose.error]);

  // ── engine + scene + game loop ─────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Create a FRESH canvas per mount: StrictMode double-mounts the effect,
    // and after cleanup's forceContextLoss() the old canvas can never hand
    // out a new WebGL context ("reading 'precision'" crash).
    const canvas = document.createElement('canvas');
    canvas.className = 'absolute inset-0 h-full w-full';
    container.insertBefore(canvas, container.firstChild);
    const engine = new RunnerEngine({ seed, controlMode, lowImpact });
    engine.setDebug(debug);
    engine.setBobScale(bobScale);
    engineRef.current = engine;
    let scene: RunnerScene;
    try {
      scene = new RunnerScene(canvas);
    } catch (err) {
      canvas.remove();
      setPoseError(
        'WebGL is unavailable in this browser — the 3D world cannot start. Try a different browser or enable hardware acceleration.',
      );
      console.error('[RunnerLayer] WebGL init failed:', err);
      return;
    }
    sceneRef.current = scene;

    const detachKb =
      controlMode === 'keyboard'
        ? attachKeyboard(window, (i) => engine.setControlInput(i))
        : () => {};

    setPhase(controlMode === 'keyboard' ? 'countdown' : 'calibrating');
    if (controlMode === 'keyboard') countdownEndRef.current = performance.now() + 3000;

    let raf = 0;
    const loop = () => {
      const now = performance.now();
      const lms = latestLandmarksRef.current ?? [];

      switch (phaseRef.current) {
        case 'calibrating': {
          const st = engine.processCalibrationAt(lms, now);
          if (now - lastHudAtRef.current > 100) setCalStatus({ ...st });
          if (st.isReady) {
            countdownEndRef.current = now + 3000;
            setPhase('countdown');
          }
          break;
        }
        case 'countdown': {
          engine.processFrame(lms, now);
          const remaining = Math.max(0, countdownEndRef.current - now);
          setCountdown(Math.ceil(remaining / 1000));
          if (remaining <= 0) {
            engine.startPlaying();
            setPhase('playing');
          }
          break;
        }
        case 'playing': {
          engine.processFrame(lms, now);
          if (engine.isComplete()) {
            setPhase('done');
            onCompleteRef.current(engine.getRawData());
          }
          break;
        }
        default:
          break;
      }

      scene.update(engine.getSceneState(), now);

      // 2D debug overlay
      const dbg = debugCanvasRef.current;
      if (dbg) {
        const ctx = dbg.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, dbg.width, dbg.height);
          engine.render(ctx, dbg.width, dbg.height);
        }
      }

      // HUD at ~10Hz (React stays out of the 60fps path)
      if (now - lastHudAtRef.current > 100 && phaseRef.current === 'playing') {
        lastHudAtRef.current = now;
        const s = engine.getSceneState();
        const m = engine.getHudMetrics();
        setHud({
          distance: s.distance,
          lives: s.lives,
          cleared: (m.cleared as number) ?? 0,
          total: (m.total as number) ?? 0,
          controlLabel: controlMode === 'keyboard' ? 'Keys' : 'Body',
          cue: s.cue,
          lowImpact: s.lowImpact,
        });
        setTracking(
          engine.isTracking() && (controlMode === 'keyboard' || now - lastSeenAtRef.current < 700),
        );
        setDrifting(engine.getDriftState().drifting);
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const resize = () => {
      const el = containerRef.current;
      if (!el) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      canvas.width = w;
      canvas.height = h;
      scene.resize(w, h);
      if (debugCanvasRef.current) {
        debugCanvasRef.current.width = w;
        debugCanvasRef.current.height = h;
      }
    };
    resize();
    window.addEventListener('resize', resize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      detachKb();
      scene.dispose();
      sceneRef.current = null;
      canvas.remove();
      engine.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlMode, lowImpact, seed, debug, bobScale]);

  const retryCalibration = useCallback(() => {
    engineRef.current?.resetCalibration();
  }, []);

  // ── render ─────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="fixed inset-0 overflow-hidden bg-slate-950">
      {/* WebGL canvas is created imperatively in the effect (fresh per mount) */}
      <canvas ref={debugCanvasRef} className="pointer-events-none absolute inset-0 z-20 h-full w-full" />
      {/* hidden camera feed (pose mode) — PiP draws from it */}
      <video ref={videoRef} playsInline muted className="hidden" />

      {hud && uiPhase === 'playing' && <RunnerHUD hud={hud} />}

      {controlMode === 'pose' && (uiPhase === 'playing' || uiPhase === 'countdown') && (
        <TrackingPip
          videoRef={videoRef}
          landmarksRef={latestLandmarksRef}
          tracking={tracking}
          drifting={drifting}
        />
      )}

      {/* calibration overlay */}
      {uiPhase === 'calibrating' && !poseError && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950/70 p-6 text-center backdrop-blur-sm">
          <h2 className="font-heading text-2xl font-bold text-slate-50">Stand back</h2>
          <p className="mt-1 max-w-sm text-sm text-slate-300">
            Get your full body in frame — head to feet. Hold still.
          </p>
          <div className="relative mt-6 h-28 w-28">
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
              <circle cx="50" cy="50" r="44" fill="none" stroke="#1e293b" strokeWidth="8" />
              <circle
                cx="50"
                cy="50"
                r="44"
                fill="none"
                stroke="#06b6d4"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${(calStatus?.progress ?? 0) * 276} 276`}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center text-lg font-bold text-cyan-300">
              {Math.round((calStatus?.progress ?? 0) * 100)}%
            </div>
          </div>
          <p className="mt-4 text-sm text-cyan-200">{calStatus?.message ?? 'Starting camera…'}</p>
          {calStatus?.isTimedOut && (
            <button
              onClick={retryCalibration}
              className="mt-4 rounded-xl bg-cyan-500 px-5 py-2 font-semibold text-slate-950"
            >
              Tap to retry
            </button>
          )}
          <button onClick={onExit} className="mt-6 text-sm text-slate-400 underline">
            Back
          </button>
        </div>
      )}

      {/* countdown */}
      {uiPhase === 'countdown' && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          <div className="font-heading text-8xl font-black text-slate-50 drop-shadow-lg">
            {countdown > 0 ? countdown : 'GO'}
          </div>
        </div>
      )}

      {/* pose failure → keyboard fallback */}
      {poseError && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/85 p-6">
          <div className="max-w-sm rounded-glass border border-white/10 bg-surface p-6 text-center">
            <h3 className="font-heading text-xl font-bold text-slate-50">Camera unavailable</h3>
            <p className="mt-2 text-sm text-slate-300">{poseError}</p>
            <p className="mt-2 text-xs text-slate-400">
              Body control needs camera permission and internet (first run) for the pose model.
            </p>
            <div className="mt-5 flex justify-center gap-3">
              {onFallbackKeyboard && (
                <button
                  onClick={onFallbackKeyboard}
                  className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950"
                >
                  Play with keyboard
                </button>
              )}
              <button
                onClick={onExit}
                className="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-slate-200"
              >
                Back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
