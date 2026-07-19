/**
 * Main-thread client for the pose Web Worker — a module-level singleton
 * mirroring PoseDetector's idempotent-init pattern (survives layer remounts;
 * StrictMode double-boot just awaits the same promise).
 *
 * init() races three signals: the worker's {type:'ready'}, the Worker
 * 'error' event (chunk 404 / parse failure), and a 20s timeout — and RESETS
 * the promise on failure so the caller can fall back to the main-thread
 * PoseDetector (and a later retry can attempt the worker again).
 *
 * Backend state is exported for diagnostics: every transition is klogged as
 * POSE_BACKEND {backend, reason} and getPoseBackend() feeds the ENV report.
 */
import { klog } from '@/lib/debug/run-logger';
import type { PoseLandmarks } from '@/modules/pose/types';

export type PoseBackend = 'worker-gpu' | 'main-gpu' | 'none';

export interface WorkerResult {
  landmarks: PoseLandmarks | null;
  timestamp: number;
  gen: number;
  inferMs: number;
}

let _backend: PoseBackend = 'none';

export function getPoseBackend(): PoseBackend {
  return _backend;
}

export function setPoseBackend(b: PoseBackend, reason: string): void {
  if (b === _backend) return;
  _backend = b;
  klog('POSE_BACKEND', { backend: b, reason });
}

const INIT_TIMEOUT_MS = 20_000;

class PoseWorkerClient {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private resultCb: ((r: WorkerResult) => void) | null = null;

  init(): Promise<void> {
    if (this.ready) return this.ready;
    let pending: Worker | null = null;
    this.ready = new Promise<void>((resolve, reject) => {
      // literal URL — webpack statically emits the worker chunk (classic
      // worker on purpose: module-type breaks at the nested mediapipe
      // dynamic-import chunk under Next's webpack config)
      const w = new Worker(new URL('./pose.worker.ts', import.meta.url));
      pending = w;
      const to = setTimeout(
        () => reject(new Error('pose worker init timeout')),
        INIT_TIMEOUT_MS,
      );
      w.onmessage = (e: MessageEvent) => {
        const msg = e.data as { type?: string; message?: string };
        if (msg?.type === 'ready') {
          clearTimeout(to);
          this.worker = w;
          w.onmessage = (ev: MessageEvent) => {
            const m = ev.data as { type?: string };
            if (m?.type === 'result') this.resultCb?.(ev.data as WorkerResult);
          };
          resolve();
        } else if (msg?.type === 'init-error') {
          clearTimeout(to);
          reject(new Error(msg.message ?? 'pose worker init failed'));
        }
      };
      w.onerror = (e: ErrorEvent) => {
        clearTimeout(to);
        reject(new Error(e.message || 'pose worker failed to load'));
      };
      w.postMessage({ type: 'init' });
    }).catch((err: unknown) => {
      pending?.terminate();
      this.worker = null;
      this.ready = null; // allow fallback now + a fresh attempt later
      throw err;
    });
    return this.ready;
  }

  get isReady(): boolean {
    return this.worker !== null;
  }

  onResult(cb: (r: WorkerResult) => void): void {
    this.resultCb = cb;
  }

  /** Transfer a camera frame in; the worker owns (and closes) the bitmap. */
  detect(bitmap: ImageBitmap, timestamp: number, gen: number): void {
    if (!this.worker) {
      bitmap.close();
      return;
    }
    this.worker.postMessage({ type: 'detect', bitmap, timestamp, gen }, [bitmap]);
  }

  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.resultCb = null;
  }
}

/** module-level singleton (mirrors PoseDetector) */
export const poseWorkerClient = new PoseWorkerClient();
