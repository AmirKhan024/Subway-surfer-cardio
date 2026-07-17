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
  }
}

function buffer(): LogEntry[] | null {
  if (typeof window === 'undefined') return null;
  if (!window.__KR_LOGS) window.__KR_LOGS = [];
  return window.__KR_LOGS;
}

let debugFlag: boolean | null = null;
function isDebug(): boolean {
  if (typeof window === 'undefined') return false;
  if (debugFlag === null) {
    debugFlag = new URLSearchParams(window.location.search).has('debug');
  }
  return debugFlag;
}

export function klog(tag: string, data?: unknown): void {
  const buf = buffer();
  if (!buf) return;
  buf.push({ t: performance.now(), tag, data });
  if (buf.length > CAP) buf.splice(0, buf.length - CAP);
  if (isDebug()) {
    // eslint-disable-next-line no-console
    console.log(`[KR] ${tag}`, data ?? '');
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

/** The paste-ready diagnostics blob: header + RUN REPORT + event log. */
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
  lines.push('----- RUN REPORT -----');
  lines.push(
    lastRunReport ? JSON.stringify(lastRunReport, roundingReplacer, 2) : '(no completed run yet)',
  );
  lines.push('');
  lines.push('----- EVENT LOG -----');
  lines.push(formatEntries(getLogEntries()));
  return lines.join('\n');
}
