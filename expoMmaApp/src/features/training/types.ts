import type { AnalysisErrorCode } from '@/features/analysis/types';

export type TrainingPhase =
  | 'idle'
  | 'countdown'
  | 'recording'
  | 'review'
  | 'processing'
  | 'keyframe_review'
  | 'error';

export type MovementPhase =
  | 'START'
  | 'EXTENSION'
  | 'PEAK'
  | 'RETRACTION'
  | 'RECOVERY';

export type PhaseKeyframe = {
  phase: MovementPhase;
  timestampMs: number;
  userImageUri: string | null;
  referenceImageUri: string | null;
};

/**
 * Canonical record of a single training attempt.
 * Pose timestamps, keyframes and assessment stay empty until later phases.
 */
export type AttemptData = {
  videoUri: string;
  durationMs: number;
  recordedAtMs: number;
  phaseTimestamps: Partial<Record<MovementPhase, number>> | null;
  keyframes: PhaseKeyframe[] | null;
};

export type TrainingSession = {
  techniqueId: string;
  phase: TrainingPhase;
  attemptNumber: number;
  startedAtMs: number | null;
  attempt: AttemptData | null;
  lastError: string | null;
  lastErrorCode: AnalysisErrorCode | null;
};

export function createIdleSession(techniqueId: string): TrainingSession {
  return {
    techniqueId,
    phase: 'idle',
    attemptNumber: 1,
    startedAtMs: null,
    attempt: null,
    lastError: null,
    lastErrorCode: null,
  };
}

export function retrySession(session: TrainingSession): TrainingSession {
  return {
    techniqueId: session.techniqueId,
    phase: 'idle',
    attemptNumber: session.attemptNumber + 1,
    startedAtMs: null,
    attempt: null,
    lastError: null,
    lastErrorCode: null,
  };
}
