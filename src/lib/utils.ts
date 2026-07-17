import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combines classnames with tailwind-merge to handle conflicts
 * Usage: cn("px-2 py-1", "p-3") => "p-3"
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function getScoreColor(score: number): string {
  return score >= 80 ? '#22c55e' : score >= 60 ? '#fb923c' : '#ef4444';
}

export function getSeverityColor(bucket: string): string {
  switch (bucket) {
    case 'Emergency':
      return '#ef4444';
    case 'Severe':
      return '#fb923c';
    case 'Moderate':
      return '#f59e0b';
    default:
      return '#22c55e';
  }
}

export function formatScore(decimal: number): string {
  return `${Math.round(decimal * 100)}%`;
}

export function getAgeCohort(age: number): number {
  if (age < 18) return 0;
  if (age <= 39) return 0;
  if (age <= 49) return 1;
  if (age <= 59) return 2;
  if (age <= 69) return 3;
  return 4;
}
