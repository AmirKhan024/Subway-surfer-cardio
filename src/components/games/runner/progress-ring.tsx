'use client';

/**
 * Circular progress ring — same geometry as the calibration ring
 * (r=47, circumference ≈ 295, -rotate-90 so it fills from 12 o'clock).
 * Purely presentational; the caller animates `fraction`.
 */
export default function ProgressRing({
  fraction,
  color,
  children,
}: {
  fraction: number;
  color: string;
  children?: React.ReactNode;
}) {
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <div className="relative mx-auto h-44 w-44">
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90">
        <circle cx="50" cy="50" r="47" fill="none" stroke="#1e293b" strokeWidth="5" />
        <circle
          cx="50"
          cy="50"
          r="47"
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${f * 295} 295`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}
