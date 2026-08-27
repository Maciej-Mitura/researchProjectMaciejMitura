import type { AttemptData } from '@/features/training/types';

let acceptedAttempt: AttemptData | null = null;

export function setAcceptedAttempt(attempt: AttemptData): void {
  acceptedAttempt = attempt;
}

export function getAcceptedAttempt(): AttemptData | null {
  return acceptedAttempt;
}

export function clearAcceptedAttempt(): void {
  acceptedAttempt = null;
}
