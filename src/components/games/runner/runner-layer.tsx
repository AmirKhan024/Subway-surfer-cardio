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
import { Pause, Volume2, VolumeX } from 'lucide-react';
import { RunnerScene } from './runner-scene';
import RunnerHUD, { type HudState } from './runner-hud';
import { useCamera } from '@/lib/mediapipe/use-camera';
import { usePoseDetector } from '@/lib/mediapipe/use-pose';
import { klog } from '@/lib/debug/run-logger';
import { audioManager, type SfxName } from '@/lib/audio/audio-manager';
import type { EngineEvent } from '@/modules/game/engines/runner-engine';

/** Engine event → sound, at the layer edge (the engine never touches audio). */
function sfxForEvent(e: EngineEvent): SfxName | null {
  switch (e.tag) {
    case 'COIN':
      return 'coin';
    case 'JUMP_TRIGGER':
      return 'jump';
    case 'SQUAT_START':
      return 'squat';
    case 'OBSTACLE':
      return e.data.cleared === false ? 'life' : null;
    case 'RUN_DONE':
      return 'gameover';
    default:
      return null;
  }
}

type UiPhase = 'booting' | 'calibrating' | 'countdown' | 'playing' | 'done';

/** fixed dust-burst particle offsets (deterministic — no per-render random) */
const DUST_PARTICLES = [
  { dx: -70, dy: -34, size: 8 },
  { dx: -42, dy: -58, size: 6 },
  { dx: -16, dy: -40, size: 9 },
  { dx: 12, dy: -62, size: 7 },
  { dx: 38, dy: -44, size: 6 },
  { dx: 66, dy: -30, size: 9 },
  { dx: 0, dy: -26, size: 5 },
] as const;

export interface RunnerLayerProps {
  controlMode: ControlMode;
  lowImpact: boolean;
  seed: number;
  /** camera-bob amplitude 0..1 (comfort setting) */
  bobScale?: number;
  /** active-workout session length in seconds (game-clock time) */
  sessionSec?: number;
  debug?: boolean;
  onComplete: (raw: RunnerRawData, reason: 'time' | 'lives' | null) => void;
  onExit: () => void;
  /** pause-menu Restart → fresh run, same settings, rotated seed */
  onRestart: () => void;
  /** pause-menu Quit → Home */
  onQuit: () => void;
}

export default function RunnerLayer({
  controlMode,
  lowImpact,
  seed,
  bobScale = 1,
  sessionSec = 60,
  debug = false,
  onComplete,
  onExit,
  onRestart,
  onQuit,
}: RunnerLayerProps) {
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  /** visible calibration self-view — same MediaStream as videoRef */
  const calVideoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const engineRef = useRef<RunnerEngine | null>(null);
  const sceneRef = useRef<RunnerScene | null>(null);
  const latestLandmarksRef = useRef<PoseLandmarks | null>(null);
  const lastSeenAtRef = useRef(0);
  const phaseRef = useRef<UiPhase>('booting');
  const countdownEndRef = useRef(0);
  const lastHudAtRef = useRef(0);
  const lastTrackingRef = useRef(true);
  const lastCountdownRef = useRef(-1);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const [uiPhase, setUiPhase] = useState<UiPhase>('booting');
  const [countdown, setCountdown] = useState(3);
  const [calStatus, setCalStatus] = useState<CalibrationStatus | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [tracking, setTracking] = useState(true);
  const [drifting, setDrifting] = useState(false);
  const [poseError, setPoseError] = useState<string | null>(null);
  /** bump to re-run the camera/pose boot effect after a failure */
  const [retryNonce, setRetryNonce] = useState(0);
  const [muted, setMuted] = useState(() => audioManager.isMuted());
  const [pauseMenu, setPauseMenu] = useState(false);
  /** mirrors pauseMenu for the rAF loop (countdown hold) */
  const pausedRef = useRef(false);
  /** frozen countdown remaining while paused during the 3-2-1 */
  const pausedCountdownRemainingRef = useRef(0);
  /** locomotion snapshot (pose gating): drives hints + idle auto-pause */
  const [loco, setLoco] = useState<{
    gated: boolean;
    started: boolean;
    active: boolean;
    msSinceStep: number;
  } | null>(null);
  /** the user has marched at least once this run (onboarding vs stopped hint) */
  const everStartedRef = useRef(false);
  /** screen-space juice timestamps (keyed CSS animations; 0 = never fired) */
  const [fxLines, setFxLines] = useState(0);
  const [fxDust, setFxDust] = useState(0);
  const [fxStreak, setFxStreak] = useState(0);
  const [reducedFx] = useState(
    () =>
      typeof window !== 'undefined' &&
      !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );

  const toggleMute = useCallback(() => {
    const next = !audioManager.isMuted();
    audioManager.setMuted(next);
    setMuted(next);
  }, []);

  const openPause = useCallback(() => {
    pausedRef.current = true;
    pausedCountdownRemainingRef.current = Math.max(0, countdownEndRef.current - performance.now());
    engineRef.current?.setPaused(true);
    setPauseMenu(true);
  }, []);

  const resumeFromPause = useCallback(() => {
    pausedRef.current = false;
    engineRef.current?.setPaused(false);
    setPauseMenu(false);
  }, []);

  const camera = useCamera();
  const pose = usePoseDetector();
  // head mode is a camera mode too — only keyboard skips the camera stack
  const isCameraMode = controlMode !== 'keyboard';
  const isHead = controlMode === 'head';

  const setPhase = useCallback((p: UiPhase) => {
    phaseRef.current = p;
    setUiPhase(p);
    klog('PHASE', { phase: p });
  }, []);

  // ── pose boot (any camera mode: body or head) ──────────────────────────
  useEffect(() => {
    if (controlMode === 'keyboard') return;
    let cancelled = false;
    (async () => {
      try {
        if (!videoRef.current) return;
        klog('CAMERA_START', {});
        await camera.start(videoRef.current);
        await pose.init();
        if (cancelled) return;
        klog('POSE_INIT', {});
        pose.startDetection(videoRef.current, (landmarks) => {
          latestLandmarksRef.current = landmarks;
          if (landmarks) lastSeenAtRef.current = performance.now();
        });
      } catch (err) {
        if (!cancelled) {
          klog('POSE_FAIL', { error: err instanceof Error ? err.message : String(err) });
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
  }, [controlMode, retryNonce]);

  // surface pose hook init errors too
  useEffect(() => {
    if (pose.error) setPoseError(pose.error);
  }, [pose.error]);

  // mirror the camera stream into the calibration self-view (one MediaStream
  // can feed multiple <video> elements). Video never leaves the device.
  useEffect(() => {
    if (uiPhase !== 'calibrating') return;
    const id = setInterval(() => {
      const src = videoRef.current?.srcObject;
      const cal = calVideoRef.current;
      if (src && cal && cal.srcObject !== src) {
        cal.srcObject = src;
        void cal.play().catch(() => {});
      }
    }, 300);
    return () => clearInterval(id);
  }, [uiPhase]);

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
    engine.setSessionMs(sessionSec * 1000);
    // march/jog-to-move applies to body control only; head mode (seated) and
    // the keyboard test path keep auto-advance
    engine.setLocomotionGating(controlMode === 'pose');
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
          // real pause during the 3-2-1: hold the countdown where it stopped
          if (pausedRef.current) {
            countdownEndRef.current = now + pausedCountdownRemainingRef.current;
          }
          const remaining = Math.max(0, countdownEndRef.current - now);
          const n = Math.ceil(remaining / 1000);
          if (n !== lastCountdownRef.current) {
            lastCountdownRef.current = n;
            audioManager.sfx(n > 0 ? 'countdown' : 'go');
          }
          setCountdown(n);
          if (remaining <= 0) {
            engine.startPlaying();
            setPhase('playing');
            audioManager.playMusic();
          }
          break;
        }
        case 'playing': {
          engine.processFrame(lms, now);
          if (engine.isComplete()) {
            setPhase('done');
            onCompleteRef.current(engine.getRawData(), engine.getEndReason());
          }
          break;
        }
        default:
          break;
      }

      // forward engine diagnostic events to the logger + audio (usually empty)
      for (const e of engine.drainEvents()) {
        klog(e.tag, e.data);
        const sound = sfxForEvent(e);
        if (sound) audioManager.sfx(sound);
        if (e.tag === 'RUN_DONE') audioManager.duckMusic(2);
        // screen-space juice — BODY mode only (neck ROM look-ups fire the
        // same jump arc; mounting fullscreen fx per look-up caused the
        // head-mode lag) and skipped under prefers-reduced-motion
        if (!reducedFx && controlMode === 'pose') {
          if (e.tag === 'JUMP_TRIGGER') setFxLines(now);
          if (e.tag === 'LAND') setFxDust(now);
          if (e.tag === 'OBSTACLE' && e.data.type === 'beam' && e.data.cleared === true) {
            setFxStreak(now);
            audioManager.sfx('whoosh'); // beam whips overhead
          }
        }
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
          cue: s.cue,
          lowImpact: s.lowImpact,
          headMode: controlMode === 'head',
          coins: s.coinsCollected,
          timerMs: engine.getTimerRemainingMs(),
        });
        const trackingNow =
          engine.isTracking() && (controlMode === 'keyboard' || now - lastSeenAtRef.current < 700);
        if (trackingNow !== lastTrackingRef.current) {
          lastTrackingRef.current = trackingNow;
          klog(trackingNow ? 'TRACKING_OK' : 'TRACKING_LOST', {});
        }
        setTracking(trackingNow);
        setDrifting(engine.getDriftState().drifting);
        const ls = engine.getLocomotionState();
        if (ls.started) everStartedRef.current = true;
        setLoco(ls);
        // long idle: never leave the game sitting dead — open the pause menu
        if (
          ls.gated &&
          everStartedRef.current &&
          !ls.active &&
          ls.msSinceStep > 15_000 &&
          !pausedRef.current
        ) {
          openPause();
        }
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
      audioManager.stopMusic();
      scene.dispose();
      sceneRef.current = null;
      canvas.remove();
      engine.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlMode, lowImpact, seed, debug, bobScale, sessionSec]);

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

      {/* screen-space juice — keyed so each event restarts its animation;
          UNMOUNTED on animation end (no lingering compositor layers — the
          finished fullscreen-gradient layer was part of the head-mode lag);
          transform/opacity only + will-change for GPU compositing */}
      {fxLines > 0 && (
        <div
          key={`l${fxLines}`}
          onAnimationEnd={() => setFxLines(0)}
          className="pointer-events-none absolute inset-0 z-20 animate-fx-lines [will-change:opacity,transform]"
          style={{
            background:
              'repeating-conic-gradient(rgba(255,255,255,0.10) 0deg 1.2deg, transparent 1.2deg 9deg)',
            maskImage: 'radial-gradient(circle at 50% 55%, transparent 38%, black 80%)',
            WebkitMaskImage: 'radial-gradient(circle at 50% 55%, transparent 38%, black 80%)',
          }}
        />
      )}
      {fxDust > 0 && (
        <div
          key={`d${fxDust}`}
          onAnimationEnd={() => setFxDust(0)}
          className="pointer-events-none absolute inset-x-0 bottom-16 z-20 flex justify-center"
        >
          <div className="relative">
            {DUST_PARTICLES.map((p, i) => (
              <span
                key={i}
                className="absolute rounded-full bg-amber-100/60 animate-fx-dust [will-change:opacity,transform]"
                style={{
                  width: p.size,
                  height: p.size,
                  ['--dx' as string]: `${p.dx}px`,
                  ['--dy' as string]: `${p.dy}px`,
                }}
              />
            ))}
          </div>
        </div>
      )}
      {fxStreak > 0 && (
        <div
          key={`s${fxStreak}`}
          onAnimationEnd={() => setFxStreak(0)}
          className="pointer-events-none absolute inset-x-0 top-0 z-20 h-24 animate-fx-streak bg-gradient-to-b from-white/25 to-transparent [will-change:opacity,transform]"
        />
      )}

      {/* pause chip — top-right, safe-area aware, ≥44px tap target */}
      {(uiPhase === 'playing' || uiPhase === 'countdown') && !pauseMenu && (
        <button
          onClick={openPause}
          className="absolute right-3 z-30 flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-slate-950/60 text-slate-50 backdrop-blur-md"
          style={{ top: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}
          aria-label="Pause"
        >
          <Pause className="h-5 w-5" />
        </button>
      )}

      {/* mute chip — usable mid-run */}
      {(uiPhase === 'playing' || uiPhase === 'countdown') && (
        <button
          onClick={toggleMute}
          className="absolute bottom-10 right-3 z-30 flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-slate-950/60 text-slate-50 backdrop-blur-md"
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>
      )}

      {/* REAL pause menu — the engine's game clock is halted (world + timer
          frozen via the runActive gate), not a fake overlay */}
      {pauseMenu && uiPhase !== 'done' && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-6 backdrop-blur-sm">
          <div className="w-full max-w-xs rounded-glass border border-white/10 bg-surface p-6 text-center">
            <h3 className="font-heading text-xl font-bold text-slate-50">Paused</h3>
            <p className="mt-1 text-sm text-slate-400">The run and timer are on hold.</p>
            <div className="mt-5 flex flex-col gap-2.5">
              <button
                onClick={resumeFromPause}
                className="rounded-xl bg-cyan-500 px-4 py-2.5 font-heading font-bold text-slate-950 transition hover:bg-cyan-400"
              >
                Resume
              </button>
              <button
                onClick={onRestart}
                className="rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-2.5 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/20"
              >
                Restart
              </button>
              <button
                onClick={onQuit}
                className="rounded-xl border border-white/20 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/5"
              >
                Quit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* locomotion hints (pose gating): onboarding for the new mechanic,
          then a soft pulsing nudge when the user rests */}
      {loco?.gated && uiPhase === 'playing' && !pauseMenu && !everStartedRef.current && (
        <div className="pointer-events-none absolute inset-x-4 top-1/3 z-30 flex justify-center">
          <div className="rounded-2xl border border-cyan-400/40 bg-slate-950/80 px-6 py-4 text-center backdrop-blur-md motion-safe:animate-pulse">
            <div className="font-heading text-xl font-bold text-cyan-200">
              🏃 Jog or march in place to start running!
            </div>
            <div className="mt-1 text-sm text-slate-300">The world moves when you do.</div>
          </div>
        </div>
      )}
      {loco?.gated &&
        uiPhase === 'playing' &&
        !pauseMenu &&
        everStartedRef.current &&
        !loco.active &&
        loco.msSinceStep > 4500 && (
          <div className="pointer-events-none absolute inset-x-4 top-1/3 z-30 flex justify-center">
            <div className="rounded-xl border border-white/15 bg-slate-950/80 px-5 py-2.5 text-center text-sm font-semibold text-slate-200 backdrop-blur-md motion-safe:animate-pulse">
              March in place to move
            </div>
          </div>
        )}

      {/* NOTE: the in-play camera PiP was removed (mobile UX) — the tracking
          safeguard survives as this text-only toast */}
      {isCameraMode && uiPhase === 'playing' && (!tracking || drifting) && (
        <div className="pointer-events-none absolute left-1/2 top-36 z-30 -translate-x-1/2 rounded-xl border border-red-400/40 bg-slate-950/80 px-4 py-2 text-sm font-semibold text-red-300 backdrop-blur-md">
          {!tracking ? '📷 Step back into frame' : '📷 Recenter — move back to your start spot'}
        </div>
      )}

      {/* calibration overlay */}
      {uiPhase === 'calibrating' && !poseError && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950/70 p-6 text-center backdrop-blur-sm">
          <h2 className="font-heading text-2xl font-bold text-slate-50">
            {isHead ? 'Get comfortable' : 'Stand back'}
          </h2>
          <p className="mt-1 max-w-sm text-sm text-slate-300">
            {isHead
              ? 'Sit tall, chin level, look straight at the screen. Hold still.'
              : 'Get your full body in frame — head to feet. Hold still.'}
          </p>
          {/* live mirrored self-view INSIDE the progress ring (Kriya-style) */}
          <div className="relative mt-6 h-44 w-44">
            <video
              ref={calVideoRef}
              playsInline
              muted
              className="absolute inset-2 h-40 w-40 rounded-full bg-slate-900 object-cover"
              style={{ transform: 'scaleX(-1)' }}
            />
            <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90">
              <circle cx="50" cy="50" r="47" fill="none" stroke="#1e293b" strokeWidth="5" />
              <circle
                cx="50"
                cy="50"
                r="47"
                fill="none"
                stroke="#06b6d4"
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={`${(calStatus?.progress ?? 0) * 295} 295`}
              />
            </svg>
          </div>
          <div className="mt-3 text-lg font-bold text-cyan-300">
            {Math.round((calStatus?.progress ?? 0) * 100)}%
          </div>
          <p className="mt-1 text-sm text-cyan-200">{calStatus?.message ?? 'Starting camera…'}</p>
          <p className="mt-3 text-xs text-slate-400">
            🔒 Your camera video stays on your device and is never stored or uploaded.
          </p>
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

      {/* pose failure → retry or back */}
      {poseError && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/85 p-6">
          <div className="max-w-sm rounded-glass border border-white/10 bg-surface p-6 text-center">
            <h3 className="font-heading text-xl font-bold text-slate-50">Camera unavailable</h3>
            <p className="mt-2 text-sm text-slate-300">{poseError}</p>
            <p className="mt-2 text-xs text-slate-400">
              The game needs camera permission and internet (first run) for the pose model.
            </p>
            <div className="mt-5 flex justify-center gap-3">
              <button
                onClick={() => {
                  setPoseError(null);
                  setRetryNonce((n) => n + 1);
                }}
                className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950"
              >
                Retry
              </button>
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
