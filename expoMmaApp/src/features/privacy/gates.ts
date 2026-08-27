import type { PrivacyAcknowledgements } from '@/features/privacy/acknowledgements';

export type CameraDisclosureVariant = 'reference' | 'practice';

export type DetailedAiChoice = 'continue' | 'quick';

export type DetailedAiDecision = 'show-disclosure' | 'start-gemini' | 'use-quick';

export function shouldShowCameraDisclosure(state: PrivacyAcknowledgements): boolean {
  return !state.cameraPrivacyAcknowledged;
}

export function shouldMountCameraPreview(state: PrivacyAcknowledgements): boolean {
  return state.cameraPrivacyAcknowledged;
}

export function shouldShowFullCameraDisclosure(state: PrivacyAcknowledgements): boolean {
  return shouldShowCameraDisclosure(state);
}

export function shouldShowCompactRecordingNotice(state: PrivacyAcknowledgements): boolean {
  return state.cameraPrivacyAcknowledged;
}

export function canRunQuickComparison(_state: PrivacyAcknowledgements): boolean {
  return true;
}

export function canCreateGeminiJob(state: PrivacyAcknowledgements): boolean {
  return state.externalAiAcknowledged;
}

export function shouldShowExternalAiDisclosure(state: PrivacyAcknowledgements): boolean {
  return !state.externalAiAcknowledged;
}

/**
 * Application UX protection only. A frontend boolean is not legal proof of consent.
 */
export function decideDetailedAiRequest(
  state: PrivacyAcknowledgements,
  choice: DetailedAiChoice | 'request',
): DetailedAiDecision {
  if (choice === 'quick') {
    return 'use-quick';
  }
  if (!state.externalAiAcknowledged) {
    return 'show-disclosure';
  }
  return 'start-gemini';
}

export function geminiSubmissionBlocked(state: PrivacyAcknowledgements): boolean {
  return !canCreateGeminiJob(state);
}

export function nextDetailedAnalysisAction(
  state: PrivacyAcknowledgements,
): Exclude<DetailedAiDecision, 'use-quick'> {
  return decideDetailedAiRequest(state, 'request') === 'start-gemini'
    ? 'start-gemini'
    : 'show-disclosure';
}
