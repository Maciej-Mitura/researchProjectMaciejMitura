import type { StoredAiAssessment } from '@/features/ai/types';

let latestAssessment: StoredAiAssessment | null = null;

export function setLatestAiAssessment(assessment: StoredAiAssessment): void {
  latestAssessment = assessment;
}

export function getLatestAiAssessment(): StoredAiAssessment | null {
  return latestAssessment;
}

export function clearLatestAiAssessment(): void {
  latestAssessment = null;
}
