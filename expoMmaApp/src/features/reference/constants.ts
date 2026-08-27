export const REFERENCE_DRAFT_TIMEOUT_MS = 90_000;
export const REFERENCE_CONFIRM_TIMEOUT_MS = 20_000;
export const REFERENCE_LIST_TIMEOUT_MS = 8_000;

export const GENERIC_KEYFRAME_ORDER = ['START', 'EARLY', 'MIDDLE', 'LATE', 'END'] as const;

export const REFERENCE_GUIDANCE = [
  'Stand far enough back so your full body is visible.',
  'Start in your initial stance.',
  'Perform the technique once.',
  'Return to your ending stance.',
  'Recording stops automatically at the chosen length.',
] as const;
