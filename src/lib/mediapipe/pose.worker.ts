/**
 * Pose inference Web Worker — the whole MediaPipe stack (WASM + lite model,
 * CPU delegate) runs HERE so detectForVideo never blocks the render thread.
 * The main thread only grabs camera frames (createImageBitmap, downscaled to
 * POSE_INPUT_WIDTH) and transfers them in; plain-POJO landmarks go back.
 *
 * The delegate is CPU ON PURPOSE — GPU-in-worker inits but yields no results
 * on target devices; see initEngine() for the full history. Off-thread CPU
 * beats on-thread GPU here: the render is what the user sees.
 *
 * Contract (see pose-worker-client.ts):
 *  - {type:'init'} → {type:'ready', delegate} | {type:'init-error', message}
 *      · delegate is the delegate the model ACTUALLY loaded with — 'CPU' by
 *        design — so the main thread can label the backend honestly.
 *  - {type:'detect', bitmap, timestamp, gen} →
 *      {type:'result', landmarks|null, timestamp, gen, inferMs}
 *    · timestamp is the MAIN THREAD's performance.now() — this worker must
 *      NEVER stamp with its own clock (different timeOrigin would trip the
 *      engine's strictly-increasing-timestamp guard).
 *    · gen is echoed verbatim so the client can drop stale-session results.
 *    · the bitmap is close()d here after detection (transfer = we own it).
 *  - onmessage is assigned SYNCHRONOUSLY at top level: the port buffers
 *    pre-evaluation messages, and pre-ready detects reply {landmarks:null}
 *    (+ close the bitmap) so the client's inFlight flag can never wedge.
 *
 * Typing: tsconfig lib is dom+esnext (no webworker — the reference lib
 * collides with dom). `self` is cast locally to the minimal worker shape.
 */
import { PoseEngine } from '@/modules/pose/engine';

const ctx = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
};

interface InitMsg {
  type: 'init';
}
interface DetectMsg {
  type: 'detect';
  bitmap: ImageBitmap;
  timestamp: number;
  gen: number;
}
type InMsg = InitMsg | DetectMsg;

let engine: PoseEngine | null = null;
let initStarted = false;

async function initEngine(): Promise<void> {
  try {
    // CPU delegate, ALWAYS — deliberate, do not "optimize" this back to GPU.
    // GPU-in-worker *initializes* on this device and then produces ZERO
    // results at runtime (the classic OffscreenCanvas-worker GPU readback
    // failure), which tripped the stall watchdog → main-thread failover →
    // render collapsed 113fps → 28fps. A previous WebGL2 capability probe
    // here made it worse: holding a live GL context defeated MediaPipe's own
    // internal GPU→CPU fallback. Probing "can GPU init" does NOT tell you
    // whether GPU inference works.
    //
    // With the 288px downscale (see POSE_INPUT_WIDTH) CPU is ~34ms ≈ ~29fps
    // AND stays off the render thread — which is what the user actually sees.
    const e = new PoseEngine({ delegate: 'CPU' });
    await e.init();
    engine = e;
    ctx.postMessage({
      type: 'ready',
      delegate: e.resolvedDelegate ?? 'CPU',
    });
  } catch (err) {
    ctx.postMessage({
      type: 'init-error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

ctx.onmessage = (e: MessageEvent) => {
  const msg = e.data as InMsg;
  if (msg.type === 'init') {
    if (!initStarted) {
      initStarted = true;
      void initEngine();
    }
    return;
  }
  if (msg.type === 'detect') {
    if (!engine?.isReady) {
      msg.bitmap.close();
      ctx.postMessage({
        type: 'result',
        landmarks: null,
        timestamp: msg.timestamp,
        gen: msg.gen,
        inferMs: 0,
      });
      return;
    }
    const t0 = performance.now(); // duration only — never a mediapipe stamp
    const result = engine.detectForVideo(msg.bitmap, msg.timestamp);
    const inferMs = performance.now() - t0;
    msg.bitmap.close();
    ctx.postMessage({
      type: 'result',
      landmarks: result?.landmarks ?? null,
      timestamp: msg.timestamp,
      gen: msg.gen,
      inferMs,
    });
  }
};
