import type { Technique } from '@/features/techniques/types';
import {
  ATTEMPT_DURATION_SECONDS,
  GENERIC_ATTEMPT_DURATION_DEFAULT_SECONDS,
} from '@/features/training/constants';

export type TrainingCaptureConfig = {
  maxDurationSeconds: number;
  allowManualStop: boolean;
  guidance: readonly string[];
};

export const JAB_TRAINING_CAPTURE: TrainingCaptureConfig = {
  maxDurationSeconds: ATTEMPT_DURATION_SECONDS,
  allowManualStop: false,
  guidance: [],
};

export const GENERIC_TRAINING_CAPTURE: TrainingCaptureConfig = {
  maxDurationSeconds: GENERIC_ATTEMPT_DURATION_DEFAULT_SECONDS,
  allowManualStop: false,
  guidance: [
    'Start in the same initial stance as the reference.',
    'Perform the technique once.',
    'Return to the ending stance.',
    'Recording stops when it matches the reference length.',
  ],
};

export const GENERIC_PROCESSING_STEPS = [
  'Uploading attempt',
  'Detecting movement',
  'Preparing comparison',
] as const;

export function captureConfigForTechnique(technique: Technique): TrainingCaptureConfig {
  if (technique.source === 'recorded' && technique.referenceStatus === 'available') {
    return {
      ...GENERIC_TRAINING_CAPTURE,
      maxDurationSeconds:
        technique.recordingDurationSeconds ?? GENERIC_ATTEMPT_DURATION_DEFAULT_SECONDS,
    };
  }
  return JAB_TRAINING_CAPTURE;
}

export function usesGenericComparison(technique: Technique): boolean {
  return technique.source === 'recorded' && technique.referenceStatus === 'available';
}
