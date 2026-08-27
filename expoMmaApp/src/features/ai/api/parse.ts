import { AnalysisClientError } from '@/features/analysis/api/errors';
import type {
  AiAnalysisJob,
  AiAnalysisJobCreated,
  AiCriterionAssessment,
  AiCriterionId,
  AiDebug,
  AiJobChecklistItem,
  AiJobError,
  AiMainCorrection,
  AiTechnique,
  DetailedAssessmentResponse,
  MotionRegionDebug,
  VideoSideDebug,
} from '@/features/ai/types';
import { AI_ASSESSMENT_CRITERIA } from '@/features/ai/types';
import type { MovementWindow } from '@/features/reference/types';

export function parseDetailedAssessmentResponse(value: unknown): DetailedAssessmentResponse {
  if (!isRecord(value)) {
    throw malformed();
  }

  return {
    analysisId: requireString(value, 'analysisId'),
    technique: parseTechnique(value.technique),
    analysisValid: requireBoolean(value, 'analysisValid'),
    failureReason: optionalString(value.failureReason),
    failureMessage: optionalString(value.failureMessage),
    comparisonValid: optionalBoolean(value.comparisonValid),
    invalidReason: optionalString(value.invalidReason),
    confidence: optionalNumber(value.confidence),
    overallScore: optionalNumber(value.overallScore),
    overallMax: optionalNumber(value.overallMax) ?? 100,
    criteria: parseCriteria(value.criteria),
    strengths: parseStringList(value.strengths),
    mainCorrections: parseCorrections(value.mainCorrections),
    summary: optionalString(value.summary),
    movementWindow: parseWindow(value.movementWindow),
    referenceMovementWindow: parseWindow(value.referenceMovementWindow),
    movementRegionCount: optionalNumber(value.movementRegionCount),
    referenceMovementRegionCount: optionalNumber(value.referenceMovementRegionCount),
    comparisonVideoUrl: optionalString(value.comparisonVideoUrl),
    comparisonPoseVideoUrl: optionalString(value.comparisonPoseVideoUrl),
    poseOverlayAvailable: optionalBoolean(value.poseOverlayAvailable) ?? false,
    processingLatency: parseLatency(value.processingLatency),
    debug: parseDebug(value.debug),
  };
}

function parseLatency(value: unknown): DetailedAssessmentResponse['processingLatency'] {
  if (value == null) {
    return null;
  }
  if (!isRecord(value)) {
    throw malformed();
  }
  return {
    poseAnalysisMs: optionalNumber(value.poseAnalysisMs),
    comparisonVideoMs: optionalNumber(value.comparisonVideoMs),
    quickSimilarityMs: optionalNumber(value.quickSimilarityMs),
    aiVideoPreparationMs: optionalNumber(value.aiVideoPreparationMs),
    geminiProviderMs: optionalNumber(value.geminiProviderMs),
    totalQuickMs: optionalNumber(value.totalQuickMs),
    totalDetailedMs: optionalNumber(value.totalDetailedMs),
  };
}

function parseTechnique(value: unknown): AiTechnique {
  if (!isRecord(value)) {
    throw malformed();
  }
  return {
    id: requireString(value, 'id'),
    slug: requireString(value, 'slug'),
    name: requireString(value, 'name'),
    description: optionalString(value.description),
  };
}

function parseCriteria(value: unknown): AiCriterionAssessment[] | null {
  if (value == null) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw malformed();
  }
  return value.map((item) => {
    if (!isRecord(item)) {
      throw malformed();
    }
    const criterion = requireString(item, 'criterion');
    if (criterion === 'overallSimilarity') {
      return null;
    }
    if (!isCriterion(criterion)) {
      throw malformed();
    }
    return {
      criterion,
      notApplicable: optionalBoolean(item.notApplicable) ?? false,
      score: optionalNumber(item.score),
      observation: requireString(item, 'observation'),
    };
  }).filter((item): item is AiCriterionAssessment => item != null);
}

function parseCorrections(value: unknown): AiMainCorrection[] | null {
  if (value == null) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw malformed();
  }
  return value.map((item) => {
    if (!isRecord(item)) {
      throw malformed();
    }
    const relevantRaw = optionalString(item.relevantCriterion);
    let relevantCriterion: AiCriterionId | null = null;
    if (relevantRaw != null && relevantRaw !== 'overallSimilarity') {
      if (!isCriterion(relevantRaw)) {
        throw malformed();
      }
      relevantCriterion = relevantRaw;
    }
    return {
      title: requireString(item, 'title'),
      explanation: requireString(item, 'explanation'),
      relevantCriterion,
    };
  });
}

function parseStringList(value: unknown): string[] | null {
  if (value == null) {
    return null;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw malformed();
  }
  return value;
}

function parseWindow(value: unknown): MovementWindow | null {
  if (value == null) {
    return null;
  }
  if (!isRecord(value)) {
    throw malformed();
  }
  return {
    startMs: requireNumber(value, 'startMs'),
    endMs: requireNumber(value, 'endMs'),
    durationMs: requireNumber(value, 'durationMs'),
  };
}

function parseDebug(value: unknown): AiDebug | null {
  if (value == null) {
    return null;
  }
  if (!isRecord(value)) {
    throw malformed();
  }
  return {
    model: requireString(value, 'model'),
    latencyMs: requireNumber(value, 'latencyMs'),
    analysisId: requireString(value, 'analysisId'),
    provider: optionalString(value.provider),
    uploadMethod: optionalString(value.uploadMethod),
    userFrameCount: optionalNumber(value.userFrameCount),
    referenceFrameCount: optionalNumber(value.referenceFrameCount),
    userMovementDurationMs: optionalNumber(value.userMovementDurationMs),
    referenceMovementDurationMs: optionalNumber(value.referenceMovementDurationMs),
    aiVideoDurationMs: optionalNumber(value.aiVideoDurationMs),
    comparisonDurationMs: optionalNumber(value.comparisonDurationMs),
    geminiVideoFps: optionalNumber(value.geminiVideoFps),
    confidence: optionalNumber(value.confidence),
    inputTokens: optionalNumber(value.inputTokens),
    outputTokens: optionalNumber(value.outputTokens),
    requestedModel: optionalString(value.requestedModel),
    primaryAttempts: optionalNumber(value.primaryAttempts),
    fallbackUsed: optionalBoolean(value.fallbackUsed),
    fallbackAttempts: optionalNumber(value.fallbackAttempts),
    fallbackModel: optionalString(value.fallbackModel),
    referencePipeline: parseSideDebug(value.referencePipeline),
    userPipeline: parseSideDebug(value.userPipeline),
    aiTargetDurationMs: optionalNumber(value.aiTargetDurationMs),
    aiOutputFps: optionalNumber(value.aiOutputFps),
    aiOutputFrameCount: optionalNumber(value.aiOutputFrameCount),
    aiEncodedDurationMs: optionalNumber(value.aiEncodedDurationMs),
    previewMatchesGemini: optionalBoolean(value.previewMatchesGemini),
    compositeId: optionalString(value.compositeId),
    referenceSource: optionalString(value.referenceSource),
  };
}

function parseSideDebug(value: unknown): VideoSideDebug | null {
  if (value == null) {
    return null;
  }
  if (!isRecord(value)) {
    throw malformed();
  }
  return {
    rawKind: requireString(value, 'rawKind'),
    rawDurationMs: optionalNumber(value.rawDurationMs),
    rawFps: optionalNumber(value.rawFps),
    rawFrameCount: optionalNumber(value.rawFrameCount),
    regionCount: optionalNumber(value.regionCount),
    regions: parseRegions(value.regions),
    canonicalStartMs: optionalNumber(value.canonicalStartMs),
    canonicalEndMs: optionalNumber(value.canonicalEndMs),
    canonicalDurationMs: optionalNumber(value.canonicalDurationMs),
    canonicalFrameCount: optionalNumber(value.canonicalFrameCount),
  };
}

function parseRegions(value: unknown): MotionRegionDebug[] | null {
  if (value == null) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw malformed();
  }
  return value.map((item) => {
    if (!isRecord(item)) {
      throw malformed();
    }
    return {
      startMs: requireNumber(item, 'startMs'),
      endMs: requireNumber(item, 'endMs'),
    };
  });
}

function isCriterion(value: string): value is AiCriterionId {
  return (AI_ASSESSMENT_CRITERIA as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw malformed();
  }
  return value;
}

function requireBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw malformed();
  }
  return value;
}

function requireNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw malformed();
  }
  return value;
}

function optionalString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw malformed();
  }
  return value;
}

function optionalNumber(value: unknown): number | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw malformed();
  }
  return value;
}

function optionalBoolean(value: unknown): boolean | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== 'boolean') {
    throw malformed();
  }
  return value;
}

function malformed(): AnalysisClientError {
  return new AnalysisClientError(
    'malformed',
    'The analysis server returned an unexpected response.',
  );
}

export function parseAnalysisJobCreated(value: unknown): AiAnalysisJobCreated {
  if (!isRecord(value)) {
    throw malformed();
  }
  return {
    jobId: requireString(value, 'jobId'),
    status: requireString(value, 'status'),
    pollPath: requireString(value, 'pollPath'),
  };
}

export function parseAnalysisJob(value: unknown): AiAnalysisJob {
  if (!isRecord(value)) {
    throw malformed();
  }
  const status = requireString(value, 'status');
  const progress = requireNumber(value, 'progress');
  return {
    jobId: requireString(value, 'jobId'),
    status,
    stage: requireString(value, 'stage'),
    progress: status === 'complete' ? 100 : Math.max(0, Math.min(100, progress)),
    message: requireString(value, 'message'),
    progressCaption: optionalString(value.progressCaption) ?? '',
    model: optionalString(value.model),
    requestedModel: optionalString(value.requestedModel),
    modelLabel: optionalString(value.modelLabel),
    attempt: optionalNumber(value.attempt),
    maxAttempts: optionalNumber(value.maxAttempts),
    fallbackUsed: optionalBoolean(value.fallbackUsed) ?? false,
    elapsedMs: requireNumber(value, 'elapsedMs'),
    checklist: parseChecklist(value.checklist),
    result: value.result == null ? null : parseDetailedAssessmentResponse(value.result),
    error: parseJobError(value.error),
  };
}

function parseChecklist(value: unknown): AiJobChecklistItem[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw malformed();
  }
  return value.map((item) => {
    if (!isRecord(item)) {
      throw malformed();
    }
    return {
      id: requireString(item, 'id'),
      label: requireString(item, 'label'),
      state: requireString(item, 'state'),
    };
  });
}

function parseJobError(value: unknown): AiJobError | null {
  if (value == null) {
    return null;
  }
  if (!isRecord(value)) {
    throw malformed();
  }
  return {
    code: requireString(value, 'code'),
    message: requireString(value, 'message'),
  };
}
