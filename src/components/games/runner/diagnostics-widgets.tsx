'use client';

/**
 * Shared diagnostics affordances for the game-over + report screens.
 * The buffer lives on window.__KR_LOGS and survives every screen transition,
 * so logs are copyable/viewable IN-APP even if DevTools was closed or
 * cleared. Always available (not ?debug-gated) — these are actively used
 * for playtest debugging.
 */
import { useState } from 'react';
import { getDiagnosticsText } from '@/lib/debug/run-logger';

export function CopyDiagnosticsButton() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(getDiagnosticsText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // clipboard blocked (http / permissions) — fall back to console
      // eslint-disable-next-line no-console
      console.log(getDiagnosticsText());
      alert('Clipboard unavailable — diagnostics printed to the console instead.');
    }
  };

  return (
    <button
      onClick={copy}
      className="w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-slate-400 transition hover:text-slate-200"
    >
      {copied ? 'Copied ✓ — paste it to the developer' : '🔍 Copy diagnostics'}
    </button>
  );
}

export function LogsPanel() {
  const [open, setOpen] = useState(false);
  // recomputed on each open so the panel always shows the latest buffer
  const [text, setText] = useState('');

  const toggle = () => {
    if (!open) setText(getDiagnosticsText());
    setOpen(!open);
  };

  return (
    <div className="mt-2">
      <button
        onClick={toggle}
        className="w-full rounded-lg border border-white/10 bg-slate-900/40 px-3 py-1.5 text-xs text-slate-500 transition hover:text-slate-300"
      >
        {open ? '▾ Hide logs' : '▸ View logs'}
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-white/10 bg-slate-950/80 p-2 text-left">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-[10px] leading-relaxed text-slate-400">
            {text}
          </pre>
          <p className="mt-1.5 border-t border-white/5 pt-1.5 text-[10px] text-slate-600">
            Tip: enable DevTools › Console › &quot;Preserve log&quot; to keep console history too.
          </p>
        </div>
      )}
    </div>
  );
}
