import type { VideoMetadata } from '@/features/analysis/types';

export type GenericKeyframePhase = 'START' | 'EARLY' | 'MIDDLE' | 'LATE' | 'END';

export type ReferenceKeyframe = {
  phase: string;
  frameIndex: number;
  timestampMs: number;
  filename: string;
  url: string | null;
};

export type MovementWindow = {
  startMs: number;
  endMs: number;
  durationMs: number;
};

export type ReferenceDebug = {
  strategy: string;
  baseline: number | null;
  peakMotion: number | null;
  motionDelta: number | null;
  smoothingMethod: string;
  smoothingWindow: number;
  fpsFallbackUsed: boolean;
  majorLandmarkCoverage: number | null;
  draftDir: string | null;
};

export type ReferenceDraftResponse = {
  draftId: string;
  name: string;
  description: string | null;
  slug: string;
  analysisValid: boolean;
  failureReason: string | null;
  failureMessage: string | null;
  video: VideoMetadata | null;
  poseCoverage: number | null;
  majorLandmarkCoverage: number | null;
  movementWindow: MovementWindow | null;
  keyframes: ReferenceKeyframe[] | null;
  debug: ReferenceDebug | null;
};

export type RecordedTechniqueSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  source: 'recorded';
  referenceStatus: 'available';
  createdAt: string;
  referenceStrategy: string;
  keyframeCount: number;
  recordingDurationSeconds: number | null;
};

export type ConfirmReferenceResponse = {
  technique: RecordedTechniqueSummary;
};

export type ReferenceErrorCode =
  | 'missing_api_url'
  | 'unreachable'
  | 'upload_failed'
  | 'timeout'
  | 'analysis_rejected'
  | 'duplicate_technique'
  | 'builtin_protected'
  | 'delete_failed'
  | 'technique_not_found'
  | 'http_400'
  | 'http_409'
  | 'http_413'
  | 'http_422'
  | 'http_500'
  | 'http_other'
  | 'malformed';
