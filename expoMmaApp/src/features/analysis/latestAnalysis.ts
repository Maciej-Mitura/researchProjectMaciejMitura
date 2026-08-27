import type { AnalyzeAttemptResponse } from '@/features/analysis/types';

export type StoredAnalysis = {
  techniqueId: string;
  attemptVideoUri: string;
  response: AnalyzeAttemptResponse;
  receivedAtMs: number;
};

let latestAnalysis: StoredAnalysis | null = null;

export function setLatestAnalysis(analysis: StoredAnalysis): void {
  latestAnalysis = analysis;
}

export function getLatestAnalysis(): StoredAnalysis | null {
  return latestAnalysis;
}

export function clearLatestAnalysis(): void {
  latestAnalysis = null;
}
