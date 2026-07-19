/**
 * Kriya Runner diagnostics logger.
 *
 * Ring buffer (~500 entries) on window.__KR_LOGS + klog(tag, data). Console
 * echo only when ?debug=1. Captures window errors / unhandled rejections /
 * console.error into the same buffer. getDiagnosticsText() renders one
 * paste-ready blob (RUN REPORT + event log) for the report screen's
 * "Copy diagnostics" button — the workflow is: play → copy → paste to
 * Claude Code to diagnose.
 *
 * SSR-safe: every entry point no-ops without window. Observation only —
 * never called from inside the engine (the engine stays pure and exposes
 * drainEvents() instead).
 */

export const APP_VERSION = '0.2.0';

export interface LogEntry {
  t: number;
  tag: string;
  data?: unknown;
}

const CAP = 500;

declare global {
  interface Window {
    __KR_LOGS?: LogEntry[];
    __KR_ERR_CAPTURE?: boolean;
    /** prints the one copy-pasteable diagnostics block to the console */
    __KR_DIAG?: () => void;
  }
}

function buffer(): LogEntry[] | null {
  if (typeof window === 'undefined') return null;
  if (!window.__KR_LOGS) window.__KR_LOGS = [];
  return window.__KR_LOGS;
}

let debugFlag: boolean | null = null;
/**
 * Debug gate: `?debug` (any value) OR localStorage KR_DEBUG='1' (survives
 * reloads — mobile devtools lose query params). Memoized once per load.
 */
export function isDebug(): boolean {
  if (typeof window === 'undefined') return false;
  if (debugFlag === null) {
    let ls = false;
    try {
      ls = window.localStorage?.getItem('KR_DEBUG') === '1';
    } catch {
      /* storage unavailable */
    }
    debugFlag = new URLSearchParams(window.location.search).has('debug') || ls;
  }
  return debugFlag;
}

export function klog(tag: string, data?: unknown): void {
  const buf = buffer();
  if (!buf) return;
  const t = performance.now();
  buf.push({ t, tag, data });
  if (buf.length > CAP) buf.splice(0, buf.length - CAP);
  if (isDebug()) {
    // eslint-disable-next-line no-console
    console.log(`[KR +${(t / 1000).toFixed(2)}s] ${tag}`, data ?? '');
  }
}

/** Read-only view of the event buffer (for building the RUN REPORT). */
export function getLogEntries(): LogEntry[] {
  return buffer() ?? [];
}

/** Install once: crashes and console.errors land in the buffer too. */
export function installErrorCapture(): void {
  if (typeof window === 'undefined' || window.__KR_ERR_CAPTURE) return;
  window.__KR_ERR_CAPTURE = true;
  window.addEventListener('error', (e) => {
    klog('ERROR', { message: e.message, source: `${e.filename}:${e.lineno}` });
  });
  window.addEventListener('unhandledrejection', (e) => {
    klog('UNHANDLED_REJECTION', { reason: String(e.reason) });
  });
  const orig = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    klog('CONSOLE_ERROR', { message: args.map((a) => String(a)).join(' ') });
    orig(...args);
  };
  // the copy-pasteable console dump, callable anytime (incl. report screen —
  // screens are same-page React state, so the buffer + console history
  // survive game → gameover → report; only a page reload clears them)
  window.__KR_DIAG = printDiag;
  installLongTaskObserver();
}

/** Debug-only: capture main-thread stalls >50ms — the exact jank moments. */
let longTaskInstalled = false;
function installLongTaskObserver(): void {
  if (longTaskInstalled || !isDebug() || typeof PerformanceObserver === 'undefined') return;
  longTaskInstalled = true;
  try {
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 50) {
          klog('LONGTASK', { ms: Math.round(entry.duration), at: Math.round(entry.startTime) });
        }
      }
    });
    obs.observe({ entryTypes: ['longtask'] });
  } catch {
    /* longtask unsupported (Safari) — POSE_TIMING/FRAME_STATS still cover it */
  }
}

/** Print the one copy-pasteable diagnostics block (also window.__KR_DIAG). */
export function printDiag(): void {
  /* eslint-disable no-console */
  console.groupCollapsed('===== KR DIAG (expand, select all, copy) =====');
  console.log(getDiagnosticsText());
  console.groupEnd();
  /* eslint-enable no-console */
}

// ── run report storage ────────────────────────────────────────────────────

let lastRunReport: Record<string, unknown> | null = null;

export function setRunReport(report: Record<string, unknown>): void {
  lastRunReport = report;
}

// ── formatting (pure — unit-testable) ─────────────────────────────────────

/** JSON replacer: round floats to 3dp so the paste stays readable. */
export function roundingReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'number' && Number.isFinite(value) && !Number.isInteger(value)) {
    return Math.round(value * 1000) / 1000;
  }
  return value;
}

/** Render event-log entries as readable lines, t relative to the first. */
export function formatEntries(entries: LogEntry[]): string {
  if (entries.length === 0) return '(no events)';
  const t0 = entries[0].t;
  return entries
    .map((e) => {
      const t = ((e.t - t0) / 1000).toFixed(2).padStart(8);
      const data = e.data === undefined ? '' : ` ${JSON.stringify(e.data, roundingReplacer)}`;
      return `${t}s  ${e.tag}${data}`;
    })
    .join('\n');
}

/**
 * Perf section: ENV + the last few FRAME_STATS / POSE_TIMING windows + all
 * LONGTASK stalls, pulled from the ring buffer by tag. Pure — testable.
 */
export function formatPerfSection(entries: LogEntry[]): string {
  const byTag = (tag: string) => entries.filter((e) => e.tag === tag);
  const fmt = (list: LogEntry[]) =>
    list.length === 0 ? '(none)' : formatEntries(list);
  const lines: string[] = [];
  const env = byTag('ENV');
  lines.push('ENV:');
  lines.push(
    env.length > 0
      ? JSON.stringify(env[env.length - 1].data, roundingReplacer, 2)
      : '(not captured)',
  );
  lines.push('');
  lines.push('FRAME_STATS (last 5 windows):');
  lines.push(fmt(byTag('FRAME_STATS').slice(-5)));
  lines.push('');
  lines.push('POSE_TIMING (last 5 windows):');
  lines.push(fmt(byTag('POSE_TIMING').slice(-5)));
  lines.push('');
  lines.push('POSE_LOOP / POSE_BACKEND transitions:');
  lines.push(fmt(entries.filter((e) => e.tag === 'POSE_LOOP' || e.tag === 'POSE_BACKEND')));
  lines.push('');
  lines.push('LONGTASK (main-thread stalls >50ms):');
  lines.push(fmt(byTag('LONGTASK')));
  return lines.join('\n');
}

/** The paste-ready diagnostics blob: header + ENV/PERF + RUN REPORT + log. */
export function getDiagnosticsText(): string {
  const lines: string[] = [];
  lines.push('===== KRIYA RUNNER DIAGNOSTICS =====');
  lines.push(`version: ${APP_VERSION}`);
  if (typeof window !== 'undefined') {
    lines.push(`time: ${new Date().toISOString()}`);
    lines.push(`userAgent: ${navigator.userAgent}`);
    lines.push(`viewport: ${window.innerWidth}x${window.innerHeight}`);
    lines.push(`debugMode: ${isDebug()}`);
  }
  lines.push('');
  lines.push('----- ENV / PERF -----');
  lines.push(formatPerfSection(getLogEntries()));
  lines.push('');
  lines.push('----- RUN REPORT -----');
  lines.push(
    lastRunReport ? JSON.stringify(lastRunReport, roundingReplacer, 2) : '(no completed run yet)',
  );
  lines.push('');
  lines.push('----- CAPTURED ERRORS -----');
  lines.push(
    formatEntries(
      getLogEntries().filter(
        (e) => e.tag === 'ERROR' || e.tag === 'UNHANDLED_REJECTION' || e.tag === 'CONSOLE_ERROR',
      ),
    ),
  );
  lines.push('');
  lines.push('----- EVENT LOG -----');
  lines.push(formatEntries(getLogEntries()));
  return lines.join('\n');
}
