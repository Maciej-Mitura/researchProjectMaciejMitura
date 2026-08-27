import type { VideoMetadata } from '@/features/analysis/types';
import type { GenericKeyframePhase, MovementWindow } from '@/features/reference/types';

export const GENERIC_COMPARISON_PHASES: readonly GenericKeyframePhase[] = [
  'START',
  'EARLY',
  'MIDDLE',
  'LATE',
  'END',
];

export const GENERIC_ANALYZE_TIMEOUT_MS = 120_000;

export const COMPARISON_PLAYBACK_RATES = [0.25, 0.5, 1] as const;
export type ComparisonPlaybackRate = (typeof COMPARISON_PLAYBACK_RATES)[number];

export type ComparisonTechnique = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
};

export type ComparisonSide = {
  timestampMs: number;
  keyframeUrl: string;
};

export type ComparisonPair = {
  phase: GenericKeyframePhase;
  normalizedPosition: number;
  user: ComparisonSide;
  reference: ComparisonSide;
};

/**
 * Generic USER ↔ REFERENCE pairing package.
 * Measurement quality plus deterministic Movement Similarity.
 * Primary review is the synchronized comparison video.
 * Movement Similarity is not an expert MMA correctness score.
 */
export type SimilarityComponents = {
  poseSimilarity: number;
  movementPathSimilarity: number;
  timingSimilarity: number;
};

export type SimilarityLargestDeviation = {
  bodyPart: string;
  progressStart: number;
  progressEnd: number;
};

export type SimilarityDiagnostics = {
  referenceDurationMs: number | null;
  userDurationMs: number | null;
  largestDeviation: SimilarityLargestDeviation | null;
  upperBodySimilarity: number | null;
  lowerBodySimilarity: number | null;
  timeline: number[] | null;
};

export type SimilarityFeedback = {
  strongest: string;
  mainDifference: string;
};

export type ProcessingLatency = {
  poseAnalysisMs: number | null;
  comparisonVideoMs: number | null;
  quickSimilarityMs: number | null;
  aiVideoPreparationMs: number | null;
  geminiProviderMs: number | null;
  totalQuickMs: number | null;
  totalDetailedMs: number | null;
};

export type MovementSimilarityResult = {
  similarityValid: boolean;
  invalidReason: string | null;
  movementSimilarity: number | null;
  components: SimilarityComponents | null;
  diagnostics: SimilarityDiagnostics | null;
  feedback: SimilarityFeedback | null;
};

export type AnalyzeGenericAttemptResponse = {
  analysisId: string;
  technique: ComparisonTechnique;
  analysisValid: boolean;
  failureReason: string | null;
  failureMessage: string | null;
  poseCoverage: number | null;
  majorLandmarkCoverage: number | null;
  movementWindow: MovementWindow | null;
  referenceMovementWindow: MovementWindow | null;
  movementRegionCount?: number | null;
  referenceMovementRegionCount?: number | null;
  video: VideoMetadata | null;
  pairs: ComparisonPair[] | null;
  comparisonVideoUrl: string | null;
  comparisonPoseVideoUrl: string | null;
  comparisonDurationMs: number | null;
  movementSimilarity: MovementSimilarityResult | null;
  poseOverlayAvailable?: boolean;
  processingLatency?: ProcessingLatency | null;
  normalizedSampleCount?: number | null;
};

export type StoredComparison = {
  techniqueId: string;
  attemptVideoUri: string;
  response: AnalyzeGenericAttemptResponse;
  receivedAtMs: number;
};
