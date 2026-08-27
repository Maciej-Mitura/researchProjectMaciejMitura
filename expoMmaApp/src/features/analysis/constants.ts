export const ANALYZE_REQUEST_TIMEOUT_MS = 45_000;

export const ANALYSIS_SUPPORTED_TECHNIQUE_ID = 'simple_jab';

export const ANALYSIS_PHASE_ORDER = [
  'START',
  'EXTENSION',
  'PEAK',
  'RETRACTION',
  'RECOVERY',
] as const;

export const KICK_UNSUPPORTED_MESSAGE =
  'Automatic analysis for MMA Kick is not implemented yet.';
