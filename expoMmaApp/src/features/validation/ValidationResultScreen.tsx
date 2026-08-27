import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { Stat } from '@/components/Stat';
import { AiProcessingView } from '@/features/ai/AiProcessingView';
import { getLatestAiAssessment } from '@/features/ai/latestAssessment';
import { useDetailedAnalysis } from '@/features/ai/useDetailedAnalysis';
import { AnalysisClientError } from '@/features/analysis/api/errors';
import { getLatestComparison } from '@/features/comparison/latestComparison';
import type { AnalyzeGenericAttemptResponse } from '@/features/comparison/types';
import { ExternalAiDisclosure } from '@/features/privacy/ExternalAiDisclosure';
import { nextDetailedAnalysisAction } from '@/features/privacy/gates';
import { usePrivacyAcknowledgements } from '@/features/privacy/PrivacyAcknowledgementsContext';
import { AnalysisErrorView } from '@/features/training/AnalysisErrorView';
import { AnalysisDetailsCard } from '@/features/validation/AnalysisDetailsCard';
import { requestGeminiRepeatability, saveValidationRecord } from '@/features/validation/api';
import { buildValidationSavePayload } from '@/features/validation/buildRecord';
import {
  canSaveValidationResult,
  comparisonIsValid,
  poorRecordingVerdict,
  scenarioDisplayLabel,
  SELF_TEST_INVESTIGATION_COPY,
  SELF_TEST_PASS_COPY,
  selfTestVerdict,
  shouldOfferGemini,
  whatThisTestChecks,
} from '@/features/validation/presentation';
import { RepeatabilityCard } from '@/features/validation/RepeatabilityCard';
import { getValidationSession } from '@/features/validation/session';
import type { RepeatabilityResult } from '@/features/validation/types';
import { spacing } from '@/theme/spacing';
import { comparisonHref, validationHref, validationSummaryHref } from '@/utils/routes';

export function ValidationResultScreen() {
  const session = getValidationSession();
  const stored = getLatestComparison();
  const detailed = useDetailedAnalysis();
  const privacy = usePrivacyAcknowledgements();
  const [showAiDisclosure, setShowAiDisclosure] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedWithAi, setSavedWithAi] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [repeatability, setRepeatability] = useState<RepeatabilityResult | null>(null);

  const comparison =
    stored && session && stored.techniqueId === session.techniqueId ? stored.response : stored?.response ?? null;
  const latestAiStore = getLatestAiAssessment();
  const latestAi =
    session && latestAiStore && latestAiStore.techniqueId === session.techniqueId
      ? latestAiStore.response
      : null;
  const hasResult = Boolean(comparison || latestAi);
  const valid = comparisonIsValid(comparison);
  const attemptVideo = stored?.attemptVideoUri ?? '';
  const offerGemini = shouldOfferGemini({
    comparisonValid: valid,
    hasAttemptVideo: attemptVideo.length > 0,
    selfTest: session?.scenarioType === 'self_comparison',
  });

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await work();
    } catch (caught) {
      const client =
        caught instanceof AnalysisClientError ? caught : new AnalysisClientError('validation_failed', String(caught));
      setError(client.message);
    } finally {
      setBusy(null);
    }
  }

  if (detailed.phase === 'processing') {
    return (
      <Screen>
        <AiProcessingView job={detailed.job} />
      </Screen>
    );
  }

  if (detailed.phase === 'error') {
    return (
      <Screen>
        <AnalysisErrorView
          message={detailed.errorMessage ?? 'Detailed AI Analysis could not be completed.'}
          errorCode={detailed.errorCode}
          hint="Quick Comparison still works. You can save the Quick result without Gemini."
          onRetry={() => detailed.reset()}
          onBack={() => detailed.reset()}
        />
      </Screen>
    );
  }

  if (showAiDisclosure) {
    return (
      <ExternalAiDisclosure
        onUseQuickComparison={() => setShowAiDisclosure(false)}
        onContinue={() => {
          if (!session || !attemptVideo) {
            setShowAiDisclosure(false);
            return;
          }
          void (async () => {
            await privacy.acknowledgeExternalAi();
            setShowAiDisclosure(false);
            void detailed.run(session.techniqueId, attemptVideo, { navigateOnComplete: false });
          })();
        }}
      />
    );
  }

  if (!session) {
    return (
      <Screen>
        <AppText variant="title">No validation test in progress</AppText>
        <AppText variant="body" tone="muted">
          Choose a technique and a test from Research Validation first.
        </AppText>
        <Button label="Back to tests" onPress={() => router.replace(validationHref)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="caption" tone="accent">
          Validation result
        </AppText>
        <AppText variant="title">{scenarioDisplayLabel(session.scenarioType)}</AppText>
        <AppText variant="body" tone="muted">
          {session.techniqueName}
        </AppText>
      </View>

      <Card>
        <AppText variant="caption">What this test checks</AppText>
        <AppText variant="body" tone="muted">
          {whatThisTestChecks(session.scenarioType)}
        </AppText>
      </Card>

      {comparison ? (
        <ResultMetrics
          comparison={comparison}
          scenario={session.scenarioType}
          valid={valid}
        />
      ) : (
        <Card>
          <AppText variant="body" tone="muted">
            No Quick result is available for this test yet.
          </AppText>
        </Card>
      )}

      {latestAi ? (
        <Card>
          <AppText variant="caption">Detailed AI</AppText>
          {latestAi.comparisonValid && latestAi.overallScore != null ? (
            <Stat label="Gemini overall" value={`${latestAi.overallScore} / 100`} />
          ) : (
            <AppText variant="body" tone="muted">
              {latestAi.failureMessage ??
                latestAi.invalidReason ??
                'Detailed Analysis did not produce a comparable score.'}
            </AppText>
          )}
          {latestAi.debug?.model ? (
            <AppText variant="body" tone="muted">
              {`Model ${latestAi.debug.model}${latestAi.debug.fallbackUsed ? ' · fallback used' : ''}`}
            </AppText>
          ) : null}
        </Card>
      ) : null}

      {offerGemini && !latestAi ? (
        <Card>
          <AppText variant="bodyStrong">Run Detailed AI Analysis</AppText>
          <AppText variant="body" tone="muted">
            Optional — compare how Gemini evaluates the same prepared movement.
          </AppText>
          <Button
            label="Run Detailed AI Analysis"
            variant="secondary"
            disabled={busy != null}
            onPress={() => {
              if (!privacy.ready) {
                return;
              }
              if (nextDetailedAnalysisAction(privacy.acknowledgements) === 'show-disclosure') {
                setShowAiDisclosure(true);
                return;
              }
              void detailed.run(session.techniqueId, attemptVideo, { navigateOnComplete: false });
            }}
          />
        </Card>
      ) : null}

      {comparison?.comparisonVideoUrl ? (
        <Button
          label="Watch comparison"
          variant="secondary"
          onPress={() => router.push(comparisonHref(session.techniqueId))}
        />
      ) : null}

      {canSaveValidationResult(hasResult) && (!saved || Boolean(latestAi && !savedWithAi)) ? (
        <Button
          label={busy === 'save' ? 'Saving…' : 'Save result'}
          disabled={busy != null}
          onPress={() => {
            void run('save', async () => {
              await saveValidationRecord(
                buildValidationSavePayload({
                  techniqueSlug: session.techniqueSlug,
                  techniqueName: session.techniqueName,
                  scenario: session.scenarioType,
                  notes: session.notes,
                  comparison,
                  latestAi,
                  repeatability,
                }),
              );
              setSaved(true);
              if (latestAi) {
                setSavedWithAi(true);
              }
              setNotice('Validation result saved.');
            });
          }}
        />
      ) : null}

      {saved ? (
        <Card>
          <AppText variant="body" tone="success">
            {notice ?? 'Validation result saved.'}
          </AppText>
          <Button label="Run another test" onPress={() => router.replace(validationHref)} />
          <Button
            label="View saved results"
            variant="secondary"
            onPress={() => router.push(validationSummaryHref)}
          />
        </Card>
      ) : null}

      <Pressable accessibilityRole="button" onPress={() => setShowDetails((value) => !value)}>
        <AppText variant="bodyStrong" tone="accent">
          {showDetails ? 'Hide research details' : 'Research details'}
        </AppText>
      </Pressable>

      {showDetails ? (
        <>
          {session.notes ? (
            <AppText variant="body" tone="muted">
              {`Note: ${session.notes}`}
            </AppText>
          ) : null}
          {session.deterministicRepeat ? (
            <AppText variant="body" tone={session.deterministicRepeat.passed ? 'success' : 'warning'}>
              {session.deterministicRepeat.label}
            </AppText>
          ) : null}
          {comparison ? (
            <AnalysisDetailsCard
              title="Analysis details"
              collapsible={false}
              details={{
                userMovementRegionCount: comparison.movementRegionCount,
                referenceMovementRegionCount: comparison.referenceMovementRegionCount,
                referenceDurationMs: comparison.referenceMovementWindow?.durationMs,
                userDurationMs: comparison.movementWindow?.durationMs,
                poseCoverage: comparison.poseCoverage,
                quickLatencyMs: comparison.processingLatency?.totalQuickMs,
                normalizedSampleCount: comparison.normalizedSampleCount,
                aiModel: latestAi?.debug?.model,
                fallbackUsed: latestAi?.debug?.fallbackUsed,
                aiLatencyMs: latestAi?.debug?.latencyMs ?? latestAi?.processingLatency?.geminiProviderMs,
                fullAnalysisLatencyMs: latestAi?.processingLatency?.totalDetailedMs,
              }}
            />
          ) : null}
          {latestAi?.analysisValid ? (
            <Card>
              <AppText variant="caption">Gemini repeatability</AppText>
              <AppText variant="body" tone="muted">
                Reuses the same prepared AI video. This is research instrumentation, not a
                presentation step.
              </AppText>
              <Button
                label={busy === 'gemini1' ? 'Running…' : 'Prototype stability check · 1 run'}
                variant="secondary"
                disabled={busy != null}
                onPress={() => {
                  void run('gemini1', async () => {
                    setRepeatability(await requestGeminiRepeatability(latestAi.analysisId, 1));
                  });
                }}
              />
              <Button
                label={busy === 'gemini3' ? 'Running…' : 'Prototype stability check · 3 runs'}
                variant="secondary"
                disabled={busy != null}
                onPress={() => {
                  void run('gemini3', async () => {
                    setRepeatability(await requestGeminiRepeatability(latestAi.analysisId, 3));
                  });
                }}
              />
            </Card>
          ) : null}
          {repeatability ? <RepeatabilityCard result={repeatability} /> : null}
        </>
      ) : null}

      {error ? (
        <AppText variant="body" tone="warning">
          {error}
        </AppText>
      ) : null}

      {!saved ? (
        <Button label="Back to tests" variant="ghost" onPress={() => router.replace(validationHref)} />
      ) : null}
    </Screen>
  );
}

function ResultMetrics({
  comparison,
  scenario,
  valid,
}: {
  comparison: AnalyzeGenericAttemptResponse;
  scenario: import('@/features/validation/types').ValidationScenario;
  valid: boolean;
}) {
  const similarity = comparison.movementSimilarity;

  if (scenario === 'self_comparison') {
    const verdict = selfTestVerdict(comparison);
    return (
      <Card>
        {similarity?.similarityValid && similarity.movementSimilarity != null ? (
          <Stat label="Movement Similarity" value={`${similarity.movementSimilarity} / 100`} large />
        ) : (
          <AppText variant="body" tone="warning">
            {similarity?.invalidReason ?? comparison.failureMessage ?? 'Self-test could not be measured.'}
          </AppText>
        )}
        {similarity?.components ? (
          <View style={styles.components}>
            <AppText variant="body">{`Pose / Form       ${similarity.components.poseSimilarity}`}</AppText>
            <AppText variant="body">{`Movement Path     ${similarity.components.movementPathSimilarity}`}</AppText>
            <AppText variant="body">{`Timing            ${similarity.components.timingSimilarity}`}</AppText>
          </View>
        ) : null}
        {verdict === 'pass' ? (
          <>
            <AppText variant="bodyStrong" tone="success">
              ✓ PASS
            </AppText>
            <AppText variant="body" tone="muted">
              {SELF_TEST_PASS_COPY}
            </AppText>
          </>
        ) : (
          <AppText variant="bodyStrong" tone="warning">
            {SELF_TEST_INVESTIGATION_COPY}
          </AppText>
        )}
      </Card>
    );
  }

  if (scenario === 'bad_camera') {
    const outcome = poorRecordingVerdict(valid);
    return (
      <Card>
        {outcome === 'rejected_as_expected' ? (
          <>
            <AppText variant="bodyStrong" tone="success">
              ✓ Measurement rejected as expected
            </AppText>
            <AppText variant="body" tone="muted">
              {comparison.failureMessage ??
                similarity?.invalidReason ??
                'The recording did not produce a usable measurement.'}
            </AppText>
          </>
        ) : (
          <>
            <AppText variant="bodyStrong" tone="warning">
              ⚠ Measurement was accepted
            </AppText>
            {similarity?.similarityValid && similarity.movementSimilarity != null ? (
              <Stat label="Movement Similarity" value={`${similarity.movementSimilarity} / 100`} />
            ) : null}
            <AppText variant="body" tone="muted">
              This poor-recording test produced a valid measurement. That can still be saved as an
              unexpected outcome.
            </AppText>
          </>
        )}
      </Card>
    );
  }

  return (
    <Card>
      <AppText variant="caption" tone={valid ? 'success' : 'warning'}>
        {valid ? '✓ Valid measurement' : 'Invalid measurement'}
      </AppText>
      {valid && similarity?.movementSimilarity != null ? (
        <Stat label="Movement Similarity" value={`${similarity.movementSimilarity} / 100`} large />
      ) : (
        <AppText variant="body" tone="muted">
          {similarity?.invalidReason ??
            comparison.failureMessage ??
            'No fake similarity score is shown for invalid measurement.'}
        </AppText>
      )}
      {valid && similarity?.components ? (
        <View style={styles.components}>
          <AppText variant="body">{`Pose / Form       ${similarity.components.poseSimilarity}`}</AppText>
          <AppText variant="body">{`Movement Path     ${similarity.components.movementPathSimilarity}`}</AppText>
          <AppText variant="body">{`Timing            ${similarity.components.timingSimilarity}`}</AppText>
        </View>
      ) : null}
      <AppText variant="body" tone="muted">
        {scenario === 'clean_reproduction'
          ? 'A clean reproduction should score relatively high.'
          : 'A changed attempt should reduce the relevant similarity measures.'}
      </AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm,
  },
  components: {
    gap: spacing.xs,
  },
});
