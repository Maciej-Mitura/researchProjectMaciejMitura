/**
 * DTOs matching the FastAPI AnalyzeAttemptResponse.
 * These are measurement/analysis types, not technique scores.
 */

export type AnalysisPhaseName =
  | 'START'
  | 'EXTENSION'
  | 'PEAK'
  | 'RETRACTION'
  | 'RECOVERY';

export type VideoMetadata = {
  fps: number;
  durationMs: number;
  width: number;
  height: number;
  frameCount: number;
};

export type DetectedPhase = {
  phase: string;
  frameIndex: number;
  timestampMs: number;
  keyframeFilename: string | null;
  keyframeUrl: string | null;
};

export type AnalysisDebug = {
  leadSide: string;
  baseline: number | null;
  peakExtension: number | null;
  extensionDelta: number | null;
  smoothingMethod: string;
  smoothingWindow: number;
  fpsFallbackUsed: boolean;
  keyLandmarkCoverage: number | null;
  keyframeDir: string | null;
};

export type AnalyzeAttemptResponse = {
  analysisId: string;
  techniqueId: string;
  analysisValid: boolean;
  failureReason: string | null;
  failureMessage: string | null;
  video: VideoMetadata | null;
  poseCoverage: number | null;
  phases: DetectedPhase[] | null;
  debug: AnalysisDebug | null;
};

/**
 * Client-side analysis failure categories.
 * SERVER_UNREACHABLE → `unreachable`
 * UPLOAD_FAILED → `upload_failed`
 * REQUEST_TIMEOUT → `timeout`
 * ANALYSIS_REJECTED → `analysis_rejected` (`analysisValid: false`)
 * SERVER_ERROR → `http_500`
 */
export type AnalysisErrorCode =
  | 'missing_api_url'
  | 'unreachable'
  | 'upload_failed'
  | 'timeout'
  | 'analysis_rejected'
  | 'reference_missing'
  | 'reference_incomplete'
  | 'http_400'
  | 'http_413'
  | 'http_422'
  | 'http_500'
  | 'http_other'
  | 'malformed'
  | 'openai_not_configured'
  | 'openai_auth'
  | 'openai_quota'
  | 'openai_rate_limit'
  | 'openai_timeout'
  | 'openai_unavailable'
  | 'ai_malformed'
  | 'gemini_not_configured'
  | 'gemini_auth'
  | 'gemini_quota'
  | 'gemini_rate_limit'
  | 'gemini_timeout'
  | 'gemini_unavailable'
  | 'privacy_not_acknowledged'
  | 'comparison_video_invalid'
  | 'validation_failed'
  | 'export_failed';

export type AnalysisFailure = {
  code: AnalysisErrorCode;
  message: string;
  status: number | null;
};
