import type { ReferenceDraftResponse } from '@/features/reference/types';
import { GENERIC_ATTEMPT_DURATION_DEFAULT_SECONDS } from '@/features/training/constants';

export type ReferenceCaptureState = {
  name: string;
  description: string;
  recordingDurationSeconds: number;
  videoUri: string | null;
  draft: ReferenceDraftResponse | null;
};

let capture: ReferenceCaptureState | null = null;

export function startReferenceCapture(
  name: string,
  description: string,
  recordingDurationSeconds: number = GENERIC_ATTEMPT_DURATION_DEFAULT_SECONDS,
): ReferenceCaptureState {
  capture = {
    name,
    description,
    recordingDurationSeconds,
    videoUri: null,
    draft: null,
  };
  return capture;
}

export function getReferenceCapture(): ReferenceCaptureState | null {
  return capture;
}

export function setReferenceRecordingDuration(seconds: number): void {
  if (!capture) {
    return;
  }
  capture = { ...capture, recordingDurationSeconds: seconds };
}

export function setReferenceVideoUri(videoUri: string): void {
  if (!capture) {
    return;
  }
  capture = { ...capture, videoUri, draft: null };
}

export function setReferenceDraft(draft: ReferenceDraftResponse): void {
  if (!capture) {
    return;
  }
  capture = { ...capture, draft };
}

export function clearReferenceCapture(): void {
  capture = null;
}
