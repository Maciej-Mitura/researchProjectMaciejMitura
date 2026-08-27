import { AnalysisClientError } from '@/features/analysis/api/errors';
import type {
  AnalyzeGenericAttemptResponse,
  ComparisonPair,
  ComparisonSide,
  ComparisonTechnique,
  MovementSimilarityResult,
  ProcessingLatency,
  SimilarityComponents,
  SimilarityDiagnostics,
  SimilarityFeedback,
  SimilarityLargestDeviation,
} from '@/features/comparison/types';
import { GENERIC_COMPARISON_PHASES } from '@/features/comparison/types';
import type { MovementWindow } from '@/features/reference/types';
import type { VideoMetadata } from '@/features/analysis/types';

export function parseAnalyzeGenericAttemptResponse(
  value: unknown,
): AnalyzeGenericAttemptResponse {
  if (!isRecord(value)) {
    throw malformed();
  }

  return {
    analysisId: requireString(value, 'analysisId'),
    technique: parseTechnique(value.technique),
    analysisValid: requireBoolean(value, 'analysisValid'),
    failureReason: optionalString(value.failureReason),
    failureMessage: optionalString(value.failureMessage),
    poseCoverage: optionalNumber(value.poseCoverage),
    majorLandmarkCoverage: optionalNumber(value.majorLandmarkCoverage),
    movementWindow: parseWindow(value.movementWindow),
    referenceMovementWindow: parseWindow(value.referenceMovementWindow),
    movementRegionCount: optionalNumber(value.movementRegionCount),
    referenceMovementRegionCount: optionalNumber(value.referenceMovementRegionCount),
    video: parseVideo(value.video),
    pairs: parsePairs(value.pairs),
    comparisonVideoUrl: optionalString(value.comparisonVideoUrl),
    comparisonPoseVideoUrl: optionalString(value.comparisonPoseVideoUrl),
    comparisonDurationMs: optionalNumber(value.comparisonDurationMs),
    movementSimilarity: parseMovementSimilarity(value.movementSimilarity),
    poseOverlayAvailable: optionalBoolean(value.poseOverlayAvailable) ?? Boolean(optionalString(value.comparisonPoseVideoUrl)),
    processingLatency: parseLatency(value.processingLatency),
    normalizedSampleCount: optionalNumber(value.normalizedSampleCount),
  };
}

function parseLatency(value: unknown): ProcessingLatency | null {
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

function parseMovementSimilarity(value: unknown): MovementSimilarityResult | null {
  if (value == null) {
    return null;
  }
  if (!isRecord(value)) {
    throw malformed();
  }
  return {
    similarityValid: requireBoolean(value, 'similarityValid'),
    invalidReason: optionalString(value.invalidReason),
    movementSimilarity: optionalNumber(value.movementSimilarity),
    components: parseComponents(value.components),
    diagnostics: parseDiagnostics(value.diagnostics),
    feedback: parseFeedback(value.feedback),
  };
}

function parseComponents(value: unknown): SimilarityComponents | null {
  if (value == null) {
    return null;
  }
  if (!isRecord(value)) {
    throw malformed();
  }
  return {
    poseSimilarity: requireNumber(value, 'poseSimilarity'),
    movementPathSimilarity: requireNumber(value, 'movementPathSimilarity'),
    timingSimilarity: requireNumber(value, 'timingSimilarity'),
  };
}

function parseDiagnostics(value: unknown): SimilarityDiagnostics | null {
  if (value == null) {
    return null;
  }
  if (!isRecord(value)) {
    throw malformed();
  }
  return {
    referenceDurationMs: optionalNumber(value.referenceDurationMs),
    userDurationMs: optionalNumber(value.userDurationMs),
    largestDeviation: parseLargestDeviation(value.largestDeviation),
    upperBodySimilarity: optionalNumber(value.upperBodySimilarity),
    lowerBodySimilarity: optionalNumber(value.lowerBodySimilarity),
    timeline: parseTimeline(value.timeline),
  };
}

function parseLargestDeviation(value: unknown): SimilarityLargestDeviation | null {
  if (value == null) {
    return null;
  }
  if (!isRecord(value)) {
    throw malformed();
  }
  return {
    bodyPart: requireString(value, 'bodyPart'),
    progressStart: requireNumber(value, 'progressStart'),
    progressEnd: requireNumber(value, 'progressEnd'),
  };
}

function parseFeedback(value: unknown): SimilarityFeedback | null {
  if (value == null) {
    return null;
  }
  if (!isRecord(value)) {
    throw malformed();
  }
  return {
    strongest: requireString(value, 'strongest'),
    mainDifference: requireString(value, 'mainDifference'),
  };
}

function parseTimeline(value: unknown): number[] | null {
  if (value == null) {
    return null;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw malformed();
  }
  return value;
}

function parseTechnique(value: unknown): ComparisonTechnique {
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

function parsePairs(value: unknown): ComparisonPair[] | null {
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
    const phase = requireString(item, 'phase');
    if (!isGenericPhase(phase)) {
      throw malformed();
    }
    return {
      phase,
      normalizedPosition: requireNumber(item, 'normalizedPosition'),
      user: parseSide(item.user),
      reference: parseSide(item.reference),
    };
  });
}

function parseSide(value: unknown): ComparisonSide {
  if (!isRecord(value)) {
    throw malformed();
  }
  return {
    timestampMs: requireNumber(value, 'timestampMs'),
    keyframeUrl: requireString(value, 'keyframeUrl'),
  };
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

function parseVideo(value: unknown): VideoMetadata | null {
  if (value == null) {
    return null;
  }
  if (!isRecord(value)) {
    throw malformed();
  }
  return {
    fps: requireNumber(value, 'fps'),
    durationMs: requireNumber(value, 'durationMs'),
    width: requireNumber(value, 'width'),
    height: requireNumber(value, 'height'),
    frameCount: requireNumber(value, 'frameCount'),
  };
}

function isGenericPhase(value: string): value is ComparisonPair['phase'] {
  return (GENERIC_COMPARISON_PHASES as readonly string[]).includes(value);
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
