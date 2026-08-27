export type AssessmentCriterion = {
  id: string;
  label: string;
  score: number;
  maxScore: number;
};

/**
 * Structured assessment contract for later scoring and AI analysis modules.
 * Phase 1 only supplies mock values. No scoring is implemented here.
 */
export type TechniqueAssessment = {
  techniqueId: string;
  overallScore: number;
  overallMax: number;
  criteria: AssessmentCriterion[];
  strength: string;
  mainCorrection: string;
  capturedAtMs: number;
};
