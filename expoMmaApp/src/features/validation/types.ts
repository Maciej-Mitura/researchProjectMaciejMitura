export const VALIDATION_SCENARIOS = [
  'self_comparison',
  'clean_reproduction',
  'minor_deliberate_error',
  'major_deliberate_error',
  'bad_camera',
  'multi_action',
  'custom',
] as const;

export type ValidationScenario = (typeof VALIDATION_SCENARIOS)[number];

export const VALIDATION_SCENARIO_LABELS: Record<ValidationScenario, string> = {
  self_comparison: 'Reference self-test',
  clean_reproduction: 'Clean attempt',
  minor_deliberate_error: 'Deliberate difference — small',
  major_deliberate_error: 'Deliberate difference — major',
  bad_camera: 'Poor recording test',
  multi_action: 'Multi-action validation (legacy)',
  custom: 'Custom (legacy)',
};

export const QUICK_METHOD_LABEL = 'deterministic MediaPipe comparison';
export const NORMALIZED_SAMPLE_COUNT = 60;
export const NOTES_MAX_LENGTH = 500;
export const ALLOWED_GEMINI_REPEAT_COUNTS = [1, 3] as const;

export type ProcessingLatency = {
  poseAnalysisMs: number | null;
  comparisonVideoMs: number | null;
  quickSimilarityMs: number | null;
  aiVideoPreparationMs: number | null;
  geminiProviderMs: number | null;
  totalQuickMs: number | null;
  totalDetailedMs: number | null;
};

export type GeminiCriteriaScores = {
  movementPath: number | null;
  rangeOfMotion: number | null;
  bodyPositioning: number | null;
  sequencingAndTiming: number | null;
  balanceAndControl: number | null;
  recoveryOrCompletion: number | null;
};

export type RepeatabilityRun = {
  index: number;
  overallScore: number | null;
  criteria: GeminiCriteriaScores | null;
  model: string | null;
  fallbackUsed: boolean | null;
  latencyMs: number | null;
  summary: string | null;
  videoSha256: string | null;
};

export type RepeatabilityStats = {
  runCount: number;
  minimum: number | null;
  maximum: number | null;
  mean: number | null;
  scoreRange: number | null;
};

export type RepeatabilityResult = {
  analysisId: string;
  assetFilename: string;
  assetSha256: string;
  identicalAssetEachRun: boolean;
  reusedExistingAiVideo: boolean;
  runs: RepeatabilityRun[];
  overall: RepeatabilityStats | null;
};

export type DeterministicRepeatResult = {
  passed: boolean;
  label: string;
  firstOverall: number | null;
  secondOverall: number | null;
  identical: boolean;
};

export type ValidationRecord = {
  id: string;
  timestamp: string;
  techniqueSlug: string;
  techniqueName: string;
  scenarioType: ValidationScenario;
  comparisonValid: boolean;
  invalidReason: string | null;
  poseCoverage: number | null;
  majorLandmarkCoverage: number | null;
  quickOverall: number | null;
  quickPose: number | null;
  quickPath: number | null;
  quickTiming: number | null;
  referenceMovementDurationMs: number | null;
  userMovementDurationMs: number | null;
  userMovementRegionCount: number | null;
  referenceMovementRegionCount: number | null;
  geminiOverall: number | null;
  geminiCriteria: GeminiCriteriaScores | null;
  geminiModel: string | null;
  geminiFallbackUsed: boolean | null;
  geminiLatencyMs: number | null;
  geminiAnalysisId: string | null;
  totalAnalysisLatencyMs: number | null;
  latency: ProcessingLatency | null;
  notes: string | null;
  repeatability: RepeatabilityResult | null;
  selfComparison: boolean;
  quickMethod: string;
  normalizedSampleCount: number;
};

export type ValidationRecordCreate = Omit<
  ValidationRecord,
  'id' | 'timestamp' | 'quickMethod' | 'normalizedSampleCount'
> & {
  quickMethod?: string;
  normalizedSampleCount?: number;
};

export type ScenarioAggregate = {
  scenarioType: ValidationScenario;
  label: string;
  count: number;
  invalidCount: number;
  quickMean: number | null;
  geminiMean: number | null;
};

export type ValidationSummary = {
  runCount: number;
  invalidCount: number;
  records: ValidationRecord[];
  perScenario: ScenarioAggregate[];
};

export type SelfCompareResponse = {
  comparison: import('@/features/comparison/types').AnalyzeGenericAttemptResponse;
  deterministicRepeat: DeterministicRepeatResult;
  processingLatency: ProcessingLatency | null;
};

export type AnalysisDetails = {
  quickMethod?: string | null;
  normalizedSampleCount?: number | null;
  userMovementRegionCount?: number | null;
  referenceMovementRegionCount?: number | null;
  referenceDurationMs?: number | null;
  userDurationMs?: number | null;
  poseCoverage?: number | null;
  quickLatencyMs?: number | null;
  provider?: string | null;
  aiModel?: string | null;
  fallbackUsed?: boolean | null;
  aiLatencyMs?: number | null;
  fullAnalysisLatencyMs?: number | null;
  aiComparisonDurationMs?: number | null;
  previewMatchesGemini?: boolean | null;
};
