import type { VideoMetadata } from '@/features/analysis/types';
import type { ProcessingLatency } from '@/features/comparison/types';
import type { MovementWindow } from '@/features/reference/types';

export const AI_ASSESSMENT_CRITERIA = [
  'movementPath',
  'rangeOfMotion',
  'bodyPositioning',
  'sequencingAndTiming',
  'balanceAndControl',
  'recoveryOrCompletion',
] as const;

export type AiCriterionId = (typeof AI_ASSESSMENT_CRITERIA)[number];

export const AI_CRITERION_LABELS: Record<AiCriterionId, string> = {
  movementPath: 'Movement path',
  rangeOfMotion: 'Range of motion',
  bodyPositioning: 'Body positioning',
  sequencingAndTiming: 'Sequencing / coordination',
  balanceAndControl: 'Balance / control',
  recoveryOrCompletion: 'Recovery / completion',
};

export type AiTechnique = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
};

export type AiCriterionAssessment = {
  criterion: AiCriterionId;
  notApplicable: boolean;
  score: number | null;
  observation: string;
};

export type AiMainCorrection = {
  title: string;
  explanation: string;
  relevantCriterion: AiCriterionId | null;
};

export type MotionRegionDebug = {
  startMs: number;
  endMs: number;
};

export type VideoSideDebug = {
  rawKind: string;
  rawDurationMs: number | null;
  rawFps: number | null;
  rawFrameCount: number | null;
  regionCount: number | null;
  regions: MotionRegionDebug[] | null;
  canonicalStartMs: number | null;
  canonicalEndMs: number | null;
  canonicalDurationMs: number | null;
  canonicalFrameCount: number | null;
};

export type AiDebug = {
  model: string;
  latencyMs: number;
  analysisId: string;
  provider: string | null;
  uploadMethod: string | null;
  userFrameCount: number | null;
  referenceFrameCount: number | null;
  userMovementDurationMs: number | null;
  referenceMovementDurationMs: number | null;
  aiVideoDurationMs: number | null;
  comparisonDurationMs: number | null;
  geminiVideoFps: number | null;
  confidence: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  requestedModel: string | null;
  primaryAttempts: number | null;
  fallbackUsed: boolean | null;
  fallbackAttempts: number | null;
  fallbackModel: string | null;
  referencePipeline: VideoSideDebug | null;
  userPipeline: VideoSideDebug | null;
  aiTargetDurationMs: number | null;
  aiOutputFps: number | null;
  aiOutputFrameCount: number | null;
  aiEncodedDurationMs: number | null;
  previewMatchesGemini: boolean | null;
  compositeId: string | null;
  referenceSource: string | null;
};

/**
 * Detailed AI Analysis payload.
 * overallScore is computed by the backend, never chosen independently by the model.
 */
export type DetailedAssessmentResponse = {
  analysisId: string;
  technique: AiTechnique;
  analysisValid: boolean;
  failureReason: string | null;
  failureMessage: string | null;
  comparisonValid: boolean | null;
  invalidReason: string | null;
  confidence: number | null;
  overallScore: number | null;
  overallMax: number;
  criteria: AiCriterionAssessment[] | null;
  strengths: string[] | null;
  mainCorrections: AiMainCorrection[] | null;
  summary: string | null;
  movementWindow: MovementWindow | null;
  referenceMovementWindow: MovementWindow | null;
  movementRegionCount?: number | null;
  referenceMovementRegionCount?: number | null;
  comparisonVideoUrl: string | null;
  comparisonPoseVideoUrl: string | null;
  poseOverlayAvailable?: boolean;
  processingLatency?: ProcessingLatency | null;
  debug: AiDebug | null;
  video?: VideoMetadata | null;
};

export type AiJobChecklistItem = {
  id: string;
  label: string;
  state: 'complete' | 'active' | 'pending' | string;
};

export type AiJobError = {
  code: string;
  message: string;
};

export type AiJobStatus = 'queued' | 'processing' | 'complete' | 'failed' | string;

export type AiAnalysisJobCreated = {
  jobId: string;
  status: string;
  pollPath: string;
};

export type AiAnalysisJob = {
  jobId: string;
  status: AiJobStatus;
  stage: string;
  progress: number;
  message: string;
  progressCaption: string;
  model: string | null;
  requestedModel: string | null;
  modelLabel: string | null;
  attempt: number | null;
  maxAttempts: number | null;
  fallbackUsed: boolean;
  elapsedMs: number;
  checklist: AiJobChecklistItem[];
  result: DetailedAssessmentResponse | null;
  error: AiJobError | null;
};

export type StoredAiAssessment = {
  techniqueId: string;
  attemptVideoUri: string;
  response: DetailedAssessmentResponse;
  receivedAtMs: number;
};
