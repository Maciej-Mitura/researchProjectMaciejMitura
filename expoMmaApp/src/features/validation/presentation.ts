import {
  VALIDATION_SCENARIO_LABELS,
  type ValidationScenario,
} from '@/features/validation/types';
import type { AnalyzeGenericAttemptResponse } from '@/features/comparison/types';

export const SELF_TEST_MIN_SCORE = 99;

export const ADVANCED_TOOLS_DEFAULT_EXPANDED = false;

export const GEMINI_STARTS_AUTOMATICALLY = false;

export const PRIMARY_TEST_COUNT = 4;

export type PrimaryValidationTestId = 'self_test' | 'clean' | 'deliberate' | 'poor_recording';

export type DeliberateSeverity = 'small' | 'major';

export type PrimaryValidationTest = {
  id: PrimaryValidationTestId;
  title: string;
  description: string;
  badge?: string;
  cta: string;
  requiresRecording: boolean;
};

export const PRIMARY_VALIDATION_TESTS: readonly PrimaryValidationTest[] = [
  {
    id: 'self_test',
    title: 'Reference self-test',
    description:
      'Compare the reference with itself. This should produce a near-perfect deterministic similarity score.',
    badge: 'No recording required',
    cta: 'Run self-test',
    requiresRecording: false,
  },
  {
    id: 'clean',
    title: 'Clean attempt',
    description: 'Record yourself reproducing the reference as closely as possible.',
    cta: 'Record clean attempt',
    requiresRecording: true,
  },
  {
    id: 'deliberate',
    title: 'Deliberate difference',
    description:
      'Intentionally change part of the movement to check whether the analysis detects the difference.',
    cta: 'Record changed attempt',
    requiresRecording: true,
  },
  {
    id: 'poor_recording',
    title: 'Poor recording test',
    description:
      'Deliberately create poor visibility to verify that bad measurement is rejected instead of receiving a fake low score.',
    cta: 'Record poor-quality attempt',
    requiresRecording: true,
  },
];

export const PRIMARY_TEST_TITLES = PRIMARY_VALIDATION_TESTS.map((item) => item.title);

export const HIDDEN_FROM_PRIMARY_SCENARIOS: readonly ValidationScenario[] = [
  'multi_action',
  'custom',
];

export function scenarioDisplayLabel(scenario: ValidationScenario): string {
  return VALIDATION_SCENARIO_LABELS[scenario];
}

export function scenarioForPrimaryTest(
  id: PrimaryValidationTestId,
  severity: DeliberateSeverity = 'small',
): ValidationScenario {
  switch (id) {
    case 'self_test':
      return 'self_comparison';
    case 'clean':
      return 'clean_reproduction';
    case 'deliberate':
      return severity === 'major' ? 'major_deliberate_error' : 'minor_deliberate_error';
    case 'poor_recording':
      return 'bad_camera';
  }
}

export function primaryTestIdForScenario(
  scenario: ValidationScenario,
): PrimaryValidationTestId | null {
  switch (scenario) {
    case 'self_comparison':
      return 'self_test';
    case 'clean_reproduction':
      return 'clean';
    case 'minor_deliberate_error':
    case 'major_deliberate_error':
      return 'deliberate';
    case 'bad_camera':
      return 'poor_recording';
    default:
      return null;
  }
}

export function isHiddenFromPrimary(scenario: ValidationScenario): boolean {
  return HIDDEN_FROM_PRIMARY_SCENARIOS.includes(scenario);
}

export function whatThisTestChecks(scenario: ValidationScenario): string {
  switch (scenario) {
    case 'self_comparison':
      return 'Identical input should produce a near-perfect deterministic result.';
    case 'clean_reproduction':
      return 'Similar movement should produce a high similarity score.';
    case 'minor_deliberate_error':
    case 'major_deliberate_error':
      return 'Changing the movement should reduce the relevant similarity measures.';
    case 'bad_camera':
      return 'Insufficient measurement quality should result in an invalid analysis, not a score of zero.';
    case 'multi_action':
      return 'A multi-action technique can be validated the same way as a single strike.';
    case 'custom':
      return 'A researcher-defined check against the selected technique.';
  }
}

export function noteFieldForTest(
  id: PrimaryValidationTestId,
): { label: string; placeholder: string; collapsedByDefault: boolean } | null {
  switch (id) {
    case 'self_test':
      return null;
    case 'clean':
      return {
        label: 'Add note',
        placeholder: 'Optional context for this clean attempt',
        collapsedByDefault: true,
      };
    case 'deliberate':
      return {
        label: 'What will you change?',
        placeholder: 'Example: shorten the third punch',
        collapsedByDefault: false,
      };
    case 'poor_recording':
      return {
        label: 'What will make the recording poor?',
        placeholder: 'Example: stand too close to the camera',
        collapsedByDefault: false,
      };
  }
}

export type SelfTestVerdict = 'pass' | 'needs_investigation' | 'invalid';

export function selfTestVerdict(comparison: AnalyzeGenericAttemptResponse | null): SelfTestVerdict {
  if (!comparison) {
    return 'invalid';
  }
  const similarity = comparison.movementSimilarity;
  const valid = comparison.analysisValid && similarity?.similarityValid === true;
  if (!valid) {
    return 'invalid';
  }
  const scores = [
    similarity?.movementSimilarity,
    similarity?.components?.poseSimilarity,
    similarity?.components?.movementPathSimilarity,
    similarity?.components?.timingSimilarity,
  ];
  if (scores.every((score) => score != null && score >= SELF_TEST_MIN_SCORE)) {
    return 'pass';
  }
  return 'needs_investigation';
}

export type PoorRecordingVerdict = 'rejected_as_expected' | 'accepted';

export function poorRecordingVerdict(comparisonValid: boolean): PoorRecordingVerdict {
  return comparisonValid ? 'accepted' : 'rejected_as_expected';
}

export function comparisonIsValid(comparison: AnalyzeGenericAttemptResponse | null): boolean {
  if (!comparison) {
    return false;
  }
  const similarity = comparison.movementSimilarity;
  return comparison.analysisValid && (similarity?.similarityValid ?? comparison.analysisValid);
}

export function canSaveValidationResult(hasResult: boolean): boolean {
  return hasResult;
}

export function shouldOfferGemini(args: {
  comparisonValid: boolean;
  hasAttemptVideo: boolean;
  selfTest: boolean;
}): boolean {
  return args.comparisonValid && args.hasAttemptVideo && !args.selfTest;
}

export const SELF_TEST_PASS_COPY =
  'The deterministic system produces a near-perfect score when the reference is compared with itself.';

export const SELF_TEST_INVESTIGATION_COPY = 'Needs investigation';
