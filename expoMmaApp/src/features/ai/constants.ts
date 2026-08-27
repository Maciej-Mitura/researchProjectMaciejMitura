export const AI_ANALYZE_TIMEOUT_MS = 240_000;
export const AI_JOB_POLL_MS = 800;

export const AI_PROCESSING_STEPS = [
  'Preparing comparison video',
  'Analyzing continuous movement',
  'Generating feedback',
] as const;

export const AI_PROCESSING_TITLE = 'Detailed AI Analysis';
export const AI_PROCESSING_DESCRIPTION =
  'This percentage is analysis pipeline progress, not Gemini inference completion.';

export const QUICK_PROCESSING_STEPS = [
  'Uploading recording',
  'Detecting movement',
  'Calculating similarity',
  'Preparing synchronized replay',
] as const;
