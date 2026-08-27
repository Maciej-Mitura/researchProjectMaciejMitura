import {
  ALLOWED_GEMINI_REPEAT_COUNTS,
  NOTES_MAX_LENGTH,
  NORMALIZED_SAMPLE_COUNT,
  QUICK_METHOD_LABEL,
  VALIDATION_SCENARIOS,
  type GeminiCriteriaScores,
  type ProcessingLatency,
  type RepeatabilityResult,
  type ValidationRecord,
  type ValidationRecordCreate,
  type ValidationScenario,
} from '@/features/validation/types';

export const EXPORT_FORBIDDEN_SUBSTRINGS = [
  'apikey',
  'api_key',
  'prompt',
  'landmarks',
  'poseframe',
  'pose_frame',
  'posearray',
  'keyframes',
  'videobytes',
  'videourl',
  'video_url',
  'secret',
] as const;

export function isValidationScenario(value: string): value is ValidationScenario {
  return (VALIDATION_SCENARIOS as readonly string[]).includes(value);
}

export function boundRepeatCount(value: number): number {
  if (!(ALLOWED_GEMINI_REPEAT_COUNTS as readonly number[]).includes(value)) {
    throw new Error('Repeat count must be 1 or 3.');
  }
  return value;
}

export function stripScoresIfInvalid<T extends { comparisonValid: boolean }>(record: T): T {
  if (record.comparisonValid) {
    return record;
  }
  return {
    ...record,
    quickOverall: null,
    quickPose: null,
    quickPath: null,
    quickTiming: null,
    geminiOverall: null,
    geminiCriteria: null,
  };
}

export function normalizeNotes(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.slice(0, NOTES_MAX_LENGTH);
}

export function toExportObject(record: ValidationRecord): Record<string, unknown> {
  return stripForbidden({
    id: record.id,
    timestamp: record.timestamp,
    techniqueSlug: record.techniqueSlug,
    techniqueName: record.techniqueName,
    scenarioType: record.scenarioType,
    comparisonValid: record.comparisonValid,
    invalidReason: record.invalidReason,
    poseCoverage: record.poseCoverage,
    majorLandmarkCoverage: record.majorLandmarkCoverage,
    quickOverall: record.quickOverall,
    quickPose: record.quickPose,
    quickPath: record.quickPath,
    quickTiming: record.quickTiming,
    referenceMovementDurationMs: record.referenceMovementDurationMs,
    userMovementDurationMs: record.userMovementDurationMs,
    userMovementRegionCount: record.userMovementRegionCount,
    referenceMovementRegionCount: record.referenceMovementRegionCount,
    geminiOverall: record.geminiOverall,
    geminiCriteria: record.geminiCriteria,
    geminiModel: record.geminiModel,
    geminiFallbackUsed: record.geminiFallbackUsed,
    geminiLatencyMs: record.geminiLatencyMs,
    geminiAnalysisId: record.geminiAnalysisId,
    totalAnalysisLatencyMs: record.totalAnalysisLatencyMs,
    latency: record.latency,
    notes: record.notes,
    repeatability: exportRepeatability(record.repeatability),
    selfComparison: record.selfComparison,
    quickMethod: record.quickMethod,
    normalizedSampleCount: record.normalizedSampleCount,
  });
}

export function stripForbidden(value: unknown): Record<string, unknown> {
  return stripValue(value) as Record<string, unknown>;
}

function stripValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripValue);
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const compact = key.toLowerCase().replace(/[-_]/g, '');
      const forbidden = EXPORT_FORBIDDEN_SUBSTRINGS.some(
        (token) => compact.includes(token.replace(/[-_]/g, '')) || key.toLowerCase().includes(token),
      );
      if (forbidden && key !== 'geminiAnalysisId') {
        continue;
      }
      result[key] = stripValue(item);
    }
    return result;
  }
  return value;
}

function exportRepeatability(value: RepeatabilityResult | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  return {
    analysisId: value.analysisId,
    assetFilename: value.assetFilename,
    assetSha256: value.assetSha256,
    identicalAssetEachRun: value.identicalAssetEachRun,
    reusedExistingAiVideo: value.reusedExistingAiVideo,
    overall: value.overall,
    runs: value.runs.map((run) => ({
      index: run.index,
      overallScore: run.overallScore,
      criteria: run.criteria,
      model: run.model,
      fallbackUsed: run.fallbackUsed,
      latencyMs: run.latencyMs,
      summary: run.summary,
      videoSha256: run.videoSha256,
    })),
  };
}

export function emptyLatency(): ProcessingLatency {
  return {
    poseAnalysisMs: null,
    comparisonVideoMs: null,
    quickSimilarityMs: null,
    aiVideoPreparationMs: null,
    geminiProviderMs: null,
    totalQuickMs: null,
    totalDetailedMs: null,
  };
}

export function emptyCriteria(): GeminiCriteriaScores {
  return {
    movementPath: null,
    rangeOfMotion: null,
    bodyPositioning: null,
    sequencingAndTiming: null,
    balanceAndControl: null,
    recoveryOrCompletion: null,
  };
}

export function createRecordDraft(
  partial: ValidationRecordCreate,
): ValidationRecordCreate {
  return stripScoresIfInvalid({
    ...partial,
    notes: normalizeNotes(partial.notes),
    quickMethod: partial.quickMethod ?? QUICK_METHOD_LABEL,
    normalizedSampleCount: partial.normalizedSampleCount ?? NORMALIZED_SAMPLE_COUNT,
  });
}
