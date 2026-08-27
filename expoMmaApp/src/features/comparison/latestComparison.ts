import type { StoredComparison } from '@/features/comparison/types';

let latestComparison: StoredComparison | null = null;

export function setLatestComparison(comparison: StoredComparison): void {
  latestComparison = comparison;
}

export function getLatestComparison(): StoredComparison | null {
  return latestComparison;
}

export function clearLatestComparison(): void {
  latestComparison = null;
}
