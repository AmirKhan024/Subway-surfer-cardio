/**
 * Pose inference Web Worker — the whole MediaPipe stack (WASM + lite model,
 * GPU delegate via OffscreenCanvas WebGL) runs HERE so detectForVideo never
 * blocks the render thread. The main thread only grabs camera frames
 * (createImageBitmap) and transfers them in; plain-POJO landmarks go back.
 *
 * Contract (see pose-worker-client.ts):
 *  - {type:'init'} → {type:'ready'} | {type:'init-error', message}
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
    const e = new PoseEngine(); // CDN wasm + lite model + GPU delegate
    await e.init();
    engine = e;
    ctx.postMessage({ type: 'ready' });
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
