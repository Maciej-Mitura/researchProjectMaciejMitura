import type { DetailedAssessmentResponse } from '@/features/ai/types';
import type { AnalyzeGenericAttemptResponse } from '@/features/comparison/types';
import { createRecordDraft } from '@/features/validation/records';
import type {
  RepeatabilityResult,
  ValidationRecordCreate,
  ValidationScenario,
} from '@/features/validation/types';

export function buildValidationSavePayload({
  techniqueSlug,
  techniqueName,
  scenario,
  notes,
  comparison,
  latestAi,
  repeatability,
}: {
  techniqueSlug: string;
  techniqueName: string;
  scenario: ValidationScenario;
  notes: string | null;
  comparison: AnalyzeGenericAttemptResponse | null;
  latestAi: DetailedAssessmentResponse | null;
  repeatability: RepeatabilityResult | null;
}): ValidationRecordCreate {
  const similarity = comparison?.movementSimilarity;
  const valid = comparison
    ? comparison.analysisValid && (similarity?.similarityValid ?? comparison.analysisValid)
    : latestAi?.analysisValid === true && latestAi.comparisonValid !== false;
  return createRecordDraft({
    techniqueSlug,
    techniqueName,
    scenarioType: scenario,
    comparisonValid: Boolean(valid),
    invalidReason:
      comparison?.failureMessage ??
      comparison?.movementSimilarity?.invalidReason ??
      latestAi?.failureMessage ??
      latestAi?.invalidReason ??
      null,
    poseCoverage: comparison?.poseCoverage ?? null,
    majorLandmarkCoverage: comparison?.majorLandmarkCoverage ?? null,
    quickOverall: similarity?.movementSimilarity ?? null,
    quickPose: similarity?.components?.poseSimilarity ?? null,
    quickPath: similarity?.components?.movementPathSimilarity ?? null,
    quickTiming: similarity?.components?.timingSimilarity ?? null,
    referenceMovementDurationMs:
      comparison?.referenceMovementWindow?.durationMs ?? latestAi?.referenceMovementWindow?.durationMs ?? null,
    userMovementDurationMs: comparison?.movementWindow?.durationMs ?? latestAi?.movementWindow?.durationMs ?? null,
    userMovementRegionCount: comparison?.movementRegionCount ?? latestAi?.movementRegionCount ?? null,
    referenceMovementRegionCount:
      comparison?.referenceMovementRegionCount ?? latestAi?.referenceMovementRegionCount ?? null,
    geminiOverall: latestAi?.overallScore ?? null,
    geminiCriteria: criteriaFromAi(latestAi),
    geminiModel: latestAi?.debug?.model ?? null,
    geminiFallbackUsed: latestAi?.debug?.fallbackUsed ?? null,
    geminiLatencyMs: latestAi?.debug?.latencyMs ?? latestAi?.processingLatency?.geminiProviderMs ?? null,
    geminiAnalysisId: latestAi?.analysisId ?? null,
    totalAnalysisLatencyMs:
      latestAi?.processingLatency?.totalDetailedMs ?? comparison?.processingLatency?.totalQuickMs ?? null,
    latency: comparison?.processingLatency ?? latestAi?.processingLatency ?? null,
    notes,
    repeatability,
    selfComparison: scenario === 'self_comparison',
  });
}

export function criteriaFromAi(latestAi: DetailedAssessmentResponse | null) {
  if (!latestAi?.criteria) {
    return null;
  }
  const find = (id: string) => latestAi.criteria?.find((item) => item.criterion === id)?.score ?? null;
  return {
    movementPath: find('movementPath'),
    rangeOfMotion: find('rangeOfMotion'),
    bodyPositioning: find('bodyPositioning'),
    sequencingAndTiming: find('sequencingAndTiming'),
    balanceAndControl: find('balanceAndControl'),
    recoveryOrCompletion: find('recoveryOrCompletion'),
  };
}
