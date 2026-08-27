import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  HIGHLIGHT_MEANING,
  HIGHLIGHT_NOT_MEANING,
} from '../src/features/validation/highlightCopy.ts';
import { buildValidationSavePayload } from '../src/features/validation/buildRecord.ts';
import {
  ADVANCED_TOOLS_DEFAULT_EXPANDED,
  canSaveValidationResult,
  GEMINI_STARTS_AUTOMATICALLY,
  isHiddenFromPrimary,
  poorRecordingVerdict,
  PRIMARY_TEST_COUNT,
  PRIMARY_TEST_TITLES,
  PRIMARY_VALIDATION_TESTS,
  primaryTestIdForScenario,
  scenarioDisplayLabel,
  scenarioForPrimaryTest,
  selfTestVerdict,
  shouldOfferGemini,
  whatThisTestChecks,
} from '../src/features/validation/presentation.ts';
import {
  boundRepeatCount,
  createRecordDraft,
  stripForbidden,
  stripScoresIfInvalid,
  toExportObject,
} from '../src/features/validation/records.ts';
import {
  clearValidationSession,
  getValidationSession,
  isActiveValidationSession,
  setValidationSession,
  shouldReturnToValidationResult,
  shouldSkipChooseAnalysis,
} from '../src/features/validation/session.ts';
import {
  NORMALIZED_SAMPLE_COUNT,
  QUICK_METHOD_LABEL,
  VALIDATION_SCENARIO_LABELS,
  type ValidationRecord,
} from '../src/features/validation/types.ts';

describe('validation records', () => {
  it('serializes a valid record without inventing a scenario claim', () => {
    const draft = createRecordDraft({
      techniqueSlug: 'front-kick',
      techniqueName: 'Front Kick',
      scenarioType: 'clean_reproduction',
      comparisonValid: true,
      invalidReason: null,
      poseCoverage: 0.9,
      majorLandmarkCoverage: 0.88,
      quickOverall: 86,
      quickPose: 88,
      quickPath: 84,
      quickTiming: 90,
      referenceMovementDurationMs: 1240,
      userMovementDurationMs: 1230,
      userMovementRegionCount: 1,
      referenceMovementRegionCount: 1,
      geminiOverall: 80,
      geminiCriteria: null,
      geminiModel: 'gemini-3.7-flash',
      geminiFallbackUsed: false,
      geminiLatencyMs: 4000,
      geminiAnalysisId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      totalAnalysisLatencyMs: 9000,
      latency: {
        poseAnalysisMs: 400,
        comparisonVideoMs: 800,
        quickSimilarityMs: 20,
        aiVideoPreparationMs: 1200,
        geminiProviderMs: 4000,
        totalQuickMs: 1500,
        totalDetailedMs: 9000,
      },
      notes: 'Attempt intended as clean reproduction.',
      repeatability: null,
      selfComparison: false,
    });
    assert.equal(draft.scenarioType, 'clean_reproduction');
    assert.equal(VALIDATION_SCENARIO_LABELS[draft.scenarioType], 'Clean attempt');
    assert.equal(draft.quickOverall, 86);
    assert.equal(draft.notes, 'Attempt intended as clean reproduction.');
  });

  it('saves invalid measurement without fake scores', () => {
    const draft = stripScoresIfInvalid({
      comparisonValid: false,
      quickOverall: 0,
      quickPose: 12,
      quickPath: 8,
      quickTiming: 4,
      geminiOverall: 15,
      geminiCriteria: { movementPath: 1 },
    });
    assert.equal(draft.comparisonValid, false);
    assert.equal(draft.quickOverall, null);
    assert.equal(draft.geminiOverall, null);
    assert.equal(draft.geminiCriteria, null);
  });

  it('bounds Gemini repeatability to 1 or 3', () => {
    assert.equal(boundRepeatCount(1), 1);
    assert.equal(boundRepeatCount(3), 3);
    assert.throws(() => boundRepeatCount(5), /1 or 3/);
  });

  it('export object excludes media, pose arrays, and API keys', () => {
    const record: ValidationRecord = {
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      timestamp: '2026-08-27T12:00:00Z',
      techniqueSlug: 'jab',
      techniqueName: 'Jab',
      scenarioType: 'minor_deliberate_error',
      comparisonValid: true,
      invalidReason: null,
      poseCoverage: 0.93,
      majorLandmarkCoverage: 0.9,
      quickOverall: 74,
      quickPose: 80,
      quickPath: 70,
      quickTiming: 72,
      referenceMovementDurationMs: 900,
      userMovementDurationMs: 880,
      userMovementRegionCount: 1,
      referenceMovementRegionCount: 1,
      geminiOverall: 71,
      geminiCriteria: null,
      geminiModel: 'gemini-3.7-flash',
      geminiFallbackUsed: false,
      geminiLatencyMs: 3500,
      geminiAnalysisId: 'analysis-1',
      totalAnalysisLatencyMs: 8000,
      latency: {
        poseAnalysisMs: 300,
        comparisonVideoMs: 700,
        quickSimilarityMs: 12,
        aiVideoPreparationMs: 900,
        geminiProviderMs: 3500,
        totalQuickMs: 1200,
        totalDetailedMs: 8000,
      },
      notes: 'Third punch intentionally shortened.',
      repeatability: null,
      selfComparison: false,
      quickMethod: QUICK_METHOD_LABEL,
      normalizedSampleCount: NORMALIZED_SAMPLE_COUNT,
    };
    const exported = toExportObject(record);
    const blob = JSON.stringify(exported).toLowerCase();
    assert.equal(exported.quickOverall, 74);
    assert.equal(exported.geminiAnalysisId, 'analysis-1');
    assert.equal(exported.notes, 'Third punch intentionally shortened.');
    assert.equal('apiKey' in exported, false);
    assert.match(blob, /74/);
    assert.doesNotMatch(blob, /sk-/);
    assert.doesNotMatch(blob, /"landmarks"/);
    const stripped = stripForbidden({
      ...exported,
      apiKey: 'secret-key',
      landmarks: [{ x: 0.2, y: 0.3 }],
      comparisonVideoUrl: '/api/comparisons/x/comparison.mp4',
      prompt: 'hidden prompt',
    });
    assert.equal('apiKey' in stripped, false);
    assert.equal('landmarks' in stripped, false);
    assert.equal('comparisonVideoUrl' in stripped, false);
    assert.equal('prompt' in stripped, false);
    assert.equal(stripped.quickOverall, 74);
  });
});

describe('validation presentation', () => {
  it('maps legacy scenario values to presentation labels', () => {
    assert.equal(scenarioDisplayLabel('self_comparison'), 'Reference self-test');
    assert.equal(scenarioDisplayLabel('clean_reproduction'), 'Clean attempt');
    assert.equal(scenarioDisplayLabel('minor_deliberate_error'), 'Deliberate difference — small');
    assert.equal(scenarioDisplayLabel('major_deliberate_error'), 'Deliberate difference — major');
    assert.equal(scenarioDisplayLabel('bad_camera'), 'Poor recording test');
    assert.equal(scenarioDisplayLabel('multi_action'), 'Multi-action validation (legacy)');
    assert.equal(scenarioDisplayLabel('custom'), 'Custom (legacy)');
  });

  it('exposes exactly four primary tests and hides multi-action and custom', () => {
    assert.equal(PRIMARY_VALIDATION_TESTS.length, PRIMARY_TEST_COUNT);
    assert.equal(PRIMARY_TEST_COUNT, 4);
    assert.deepEqual([...PRIMARY_TEST_TITLES], [
      'Reference self-test',
      'Clean attempt',
      'Deliberate difference',
      'Poor recording test',
    ]);
    assert.equal(isHiddenFromPrimary('multi_action'), true);
    assert.equal(isHiddenFromPrimary('custom'), true);
    assert.equal(isHiddenFromPrimary('self_comparison'), false);
    assert.equal(primaryTestIdForScenario('multi_action'), null);
    assert.equal(primaryTestIdForScenario('custom'), null);
  });

  it('maps primary tests to existing scenario types without a duplicate self-test selection', () => {
    assert.equal(scenarioForPrimaryTest('self_test'), 'self_comparison');
    assert.equal(scenarioForPrimaryTest('clean'), 'clean_reproduction');
    assert.equal(scenarioForPrimaryTest('deliberate', 'small'), 'minor_deliberate_error');
    assert.equal(scenarioForPrimaryTest('deliberate', 'major'), 'major_deliberate_error');
    assert.equal(scenarioForPrimaryTest('poor_recording'), 'bad_camera');
    const selfTest = PRIMARY_VALIDATION_TESTS.find((item) => item.id === 'self_test');
    assert.equal(selfTest?.requiresRecording, false);
    assert.equal(selfTest?.cta, 'Run self-test');
    assert.equal(PRIMARY_VALIDATION_TESTS.filter((item) => item.id === 'self_test').length, 1);
  });

  it('keeps Gemini optional and advanced tools collapsed by default', () => {
    assert.equal(GEMINI_STARTS_AUTOMATICALLY, false);
    assert.equal(ADVANCED_TOOLS_DEFAULT_EXPANDED, false);
    assert.equal(
      shouldOfferGemini({ comparisonValid: true, hasAttemptVideo: true, selfTest: false }),
      true,
    );
    assert.equal(
      shouldOfferGemini({ comparisonValid: true, hasAttemptVideo: true, selfTest: true }),
      false,
    );
    assert.equal(
      shouldOfferGemini({ comparisonValid: false, hasAttemptVideo: true, selfTest: false }),
      false,
    );
  });

  it('only allows save when a result exists', () => {
    assert.equal(canSaveValidationResult(false), false);
    assert.equal(canSaveValidationResult(true), true);
  });

  it('uses a strict near-100 self-test invariant and descriptive poor-recording outcomes', () => {
    assert.equal(
      selfTestVerdict({
        analysisValid: true,
        movementSimilarity: {
          similarityValid: true,
          invalidReason: null,
          movementSimilarity: 100,
          components: {
            poseSimilarity: 100,
            movementPathSimilarity: 100,
            timingSimilarity: 100,
          },
        },
      } as never),
      'pass',
    );
    assert.equal(
      selfTestVerdict({
        analysisValid: true,
        movementSimilarity: {
          similarityValid: true,
          invalidReason: null,
          movementSimilarity: 90,
          components: {
            poseSimilarity: 90,
            movementPathSimilarity: 90,
            timingSimilarity: 90,
          },
        },
      } as never),
      'needs_investigation',
    );
    assert.equal(poorRecordingVerdict(false), 'rejected_as_expected');
    assert.equal(poorRecordingVerdict(true), 'accepted');
  });
});

describe('validation session context', () => {
  it('carries technique, test type, severity, and note through the recording flow', () => {
    clearValidationSession();
    const started = setValidationSession({
      techniqueId: 'gehananan',
      techniqueSlug: 'gehananan',
      techniqueName: 'Gehananan',
      scenarioType: scenarioForPrimaryTest('deliberate', 'major'),
      notes: 'shorten the third punch',
      source: 'recording',
      deterministicRepeat: null,
    });
    assert.equal(started.scenarioType, 'major_deliberate_error');
    assert.equal(getValidationSession()?.notes, 'shorten the third punch');
    assert.equal(isActiveValidationSession('gehananan'), true);
    assert.equal(shouldSkipChooseAnalysis('gehananan'), true);
    assert.equal(shouldReturnToValidationResult('gehananan'), true);
    assert.equal(shouldReturnToValidationResult('other'), false);
    assert.equal(scenarioDisplayLabel(started.scenarioType), 'Deliberate difference — major');
    clearValidationSession();
    assert.equal(getValidationSession(), null);
  });

  it('lets a result screen recover the selected test automatically', () => {
    setValidationSession({
      techniqueId: 'gehananan',
      techniqueSlug: 'gehananan',
      techniqueName: 'Gehananan',
      scenarioType: 'clean_reproduction',
      notes: null,
      source: 'recording',
      deterministicRepeat: null,
    });
    const current = getValidationSession();
    assert.equal(current?.scenarioType, 'clean_reproduction');
    assert.equal(scenarioDisplayLabel(current!.scenarioType), 'Clean attempt');
    assert.equal(
      whatThisTestChecks('clean_reproduction'),
      'Similar movement should produce a high similarity score.',
    );
    clearValidationSession();
  });
});

describe('validation save payload', () => {
  it('keeps scenario and note on a saved result', () => {
    const payload = buildValidationSavePayload({
      techniqueSlug: 'gehananan',
      techniqueName: 'Gehananan',
      scenario: 'minor_deliberate_error',
      notes: 'shorten the third punch',
      comparison: {
        analysisValid: true,
        failureMessage: null,
        poseCoverage: 0.9,
        majorLandmarkCoverage: 0.88,
        movementWindow: { startMs: 0, endMs: 1000, durationMs: 1000 },
        referenceMovementWindow: { startMs: 0, endMs: 1100, durationMs: 1100 },
        movementRegionCount: 1,
        referenceMovementRegionCount: 1,
        processingLatency: {
          poseAnalysisMs: null,
          comparisonVideoMs: null,
          quickSimilarityMs: null,
          aiVideoPreparationMs: null,
          geminiProviderMs: null,
          totalQuickMs: 1200,
          totalDetailedMs: null,
        },
        movementSimilarity: {
          similarityValid: true,
          invalidReason: null,
          movementSimilarity: 52,
          components: {
            poseSimilarity: 60,
            movementPathSimilarity: 48,
            timingSimilarity: 50,
          },
        },
      } as never,
      latestAi: null,
      repeatability: null,
    });
    assert.equal(payload.scenarioType, 'minor_deliberate_error');
    assert.equal(payload.notes, 'shorten the third punch');
    assert.equal(payload.quickOverall, 52);
    assert.equal(payload.selfComparison, false);
  });
});

describe('highlight semantics', () => {
  it('describes measured deviation and not coaching correctness', () => {
    assert.match(HIGHLIGHT_MEANING, /largest measured trajectory deviation/);
    assert.equal(
      HIGHLIGHT_NOT_MEANING.some((line) => line.toLowerCase().includes('injury')),
      true,
    );
    assert.equal(
      HIGHLIGHT_NOT_MEANING.some((line) => line.toLowerCase().includes('incorrect mma')),
      true,
    );
  });
});
