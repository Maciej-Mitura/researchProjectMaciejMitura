import type { DeterministicRepeatResult, ValidationScenario } from '@/features/validation/types';

export type ValidationSessionSource = 'self_test' | 'recording' | 'latest_quick' | 'custom';

export type ValidationSession = {
  techniqueId: string;
  techniqueSlug: string;
  techniqueName: string;
  scenarioType: ValidationScenario;
  notes: string | null;
  source: ValidationSessionSource;
  deterministicRepeat: DeterministicRepeatResult | null;
};

let session: ValidationSession | null = null;

export function setValidationSession(next: ValidationSession): ValidationSession {
  session = next;
  return next;
}

export function getValidationSession(): ValidationSession | null {
  return session;
}

export function clearValidationSession(): void {
  session = null;
}

export function isActiveValidationSession(techniqueId: string): boolean {
  return session != null && session.techniqueId === techniqueId;
}

export function shouldReturnToValidationResult(techniqueId: string): boolean {
  return isActiveValidationSession(techniqueId);
}

export function shouldSkipChooseAnalysis(techniqueId: string): boolean {
  return isActiveValidationSession(techniqueId);
}

export function updateValidationSession(
  patch: Partial<ValidationSession>,
): ValidationSession | null {
  if (!session) {
    return null;
  }
  session = { ...session, ...patch };
  return session;
}
