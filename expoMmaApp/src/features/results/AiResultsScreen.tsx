import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { Stat } from '@/components/Stat';
import { buildDetailedSpeechText } from '@/features/audio/detailedSpeech';
import { FeedbackSpeechControls } from '@/features/audio/FeedbackSpeechControls';
import { useFeedbackSpeech } from '@/features/audio/useFeedbackSpeech';
import { resolveApiUrl } from '@/features/analysis/api/config';
import {
  AI_ASSESSMENT_CRITERIA,
  AI_CRITERION_LABELS,
  type AiCriterionAssessment,
} from '@/features/ai/types';
import { clearLatestAiAssessment, getLatestAiAssessment } from '@/features/ai/latestAssessment';
import { SynchronizedComparisonPlayer } from '@/features/comparison/SynchronizedComparisonPlayer';
import { analyzeGenericAttempt } from '@/features/comparison/api/analyzeGenericAttempt';
import { getLatestComparison, setLatestComparison } from '@/features/comparison/latestComparison';
import {
  AnalysisClientError,
  toAnalysisClientError,
} from '@/features/analysis/api/errors';
import { EXTERNAL_AI_PROVIDER_LABEL } from '@/features/privacy/copy';
import { TechniqueNotFound } from '@/features/techniques/TechniqueNotFound';
import { useTechniqueLibrary } from '@/features/techniques/TechniqueLibraryContext';
import { getAcceptedAttempt } from '@/features/training/acceptedAttempt';
import { spacing } from '@/theme/spacing';
import { comparisonHref, privacyHref } from '@/utils/routes';
import { useTechniqueIdParam } from '@/utils/techniqueParams';
import { AnalysisDetailsCard } from '@/features/validation/AnalysisDetailsCard';

export function AiResultsScreen() {
  const techniqueId = useTechniqueIdParam();
  const { getById, loading } = useTechniqueLibrary();
  const technique = techniqueId ? getById(techniqueId) : undefined;
  const stored = getLatestAiAssessment();
  const [openingQuick, setOpeningQuick] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const speech = useFeedbackSpeech();

  const retryAttempt = useCallback(() => {
    if (!technique) {
      return;
    }
    clearLatestAiAssessment();
    router.replace({
      pathname: '/training/[techniqueId]',
      params: { techniqueId: technique.id },
    });
  }, [technique]);

  const openQuickComparison = useCallback(async () => {
    if (!technique) {
      return;
    }
    const existing = getLatestComparison();
    if (existing && existing.techniqueId === technique.id && existing.response.analysisValid) {
      router.push(comparisonHref(technique.id));
      return;
    }
    const videoUri = stored?.attemptVideoUri ?? getAcceptedAttempt()?.videoUri;
    if (!videoUri) {
      setQuickError('Record an attempt again to open Quick Comparison.');
      return;
    }
    setOpeningQuick(true);
    setQuickError(null);
    try {
      const response = await analyzeGenericAttempt({
        slug: technique.id,
        videoUri,
      });
      setLatestComparison({
        techniqueId: technique.id,
        attemptVideoUri: videoUri,
        response,
        receivedAtMs: Date.now(),
      });
      router.push(comparisonHref(technique.id));
    } catch (error) {
      const clientError =
        error instanceof AnalysisClientError ? error : toAnalysisClientError(error);
      if (clientError.code === 'analysis_rejected' && clientError.comparison) {
        setLatestComparison({
          techniqueId: technique.id,
          attemptVideoUri: videoUri,
          response: clientError.comparison,
          receivedAtMs: Date.now(),
        });
        router.push(comparisonHref(technique.id));
        return;
      }
      setQuickError(clientError.message);
    } finally {
      setOpeningQuick(false);
    }
  }, [stored?.attemptVideoUri, technique]);

  if (loading && !technique) {
    return (
      <Screen>
        <AppText variant="body" tone="muted">
          Loading technique…
        </AppText>
      </Screen>
    );
  }

  if (!techniqueId || !technique) {
    return <TechniqueNotFound techniqueId={techniqueId} />;
  }

  if (!stored || stored.techniqueId !== technique.id) {
    return (
      <Screen>
        <AppText variant="title">No detailed analysis to display</AppText>
        <AppText variant="body" tone="muted">
          Record an attempt and choose Detailed AI Analysis to see feedback here.
        </AppText>
        <Button label="Back to Technique" onPress={retryAttempt} />
      </Screen>
    );
  }

  const { response } = stored;
  const comparisonUri = mediaUri(response.comparisonVideoUrl);
  const poseUri = mediaUri(response.comparisonPoseVideoUrl);

  if (!response.analysisValid) {
    return (
      <Screen>
        <View style={styles.header}>
          <AppText variant="caption" tone="warning">
            Could not measure
          </AppText>
          <AppText variant="title">{technique.name}</AppText>
          <AppText variant="body" tone="muted">
            {response.failureMessage ??
              'The complete movement could not be prepared for AI analysis. Please retry the recording.'}
          </AppText>
        </View>
        <View style={styles.actions}>
          <Button label="Try Again" onPress={retryAttempt} />
          <Button
            label="Back to Technique"
            variant="secondary"
            onPress={() =>
              router.replace({
                pathname: '/technique/[techniqueId]',
                params: { techniqueId: technique.id },
              })
            }
          />
        </View>
      </Screen>
    );
  }

  if (response.comparisonValid === false) {
    return (
      <Screen>
        <View style={styles.header}>
          <AppText variant="caption" tone="warning">
            Comparison unavailable
          </AppText>
          <AppText variant="title">{technique.name}</AppText>
          <AppText variant="body" tone="muted">
            {response.invalidReason ??
              'The recordings could not be compared confidently from the available views.'}
          </AppText>
          <AppText variant="body" tone="muted">
            This is not a low technique score.
          </AppText>
        </View>
        {watching && comparisonUri ? (
          <SynchronizedComparisonPlayer
            uri={comparisonUri}
            poseUri={poseUri}
            poseAvailable={response.poseOverlayAvailable ?? Boolean(poseUri)}
          />
        ) : null}
        <View style={styles.actions}>
          <Button label="Try Again" onPress={retryAttempt} />
          {comparisonUri ? (
            <Button
              label={watching ? 'Hide Comparison' : 'Watch Comparison'}
              variant="secondary"
              onPress={() => setWatching((value) => !value)}
            />
          ) : (
            <Button
              label={openingQuick ? 'Opening…' : 'View Quick Comparison'}
              variant="secondary"
              disabled={openingQuick}
              onPress={() => {
                void openQuickComparison();
              }}
            />
          )}
          <Button
            label="Back to Technique"
            variant="ghost"
            onPress={() =>
              router.replace({
                pathname: '/technique/[techniqueId]',
                params: { techniqueId: technique.id },
              })
            }
          />
        </View>
        {quickError ? (
          <AppText variant="body" tone="warning">
            {quickError}
          </AppText>
        ) : null}
        {__DEV__ && response.debug ? <DeveloperDebug debug={response.debug} /> : null}
      </Screen>
    );
  }

  const criteria = orderedCriteria(response.criteria);
  const overall =
    response.overallScore == null ? '—' : `${response.overallScore} / ${response.overallMax}`;
  const speechText = buildDetailedSpeechText(response);

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="caption" tone="accent">
          Detailed AI Analysis
        </AppText>
        <AppText variant="caption" tone="muted">
          {EXTERNAL_AI_PROVIDER_LABEL}
        </AppText>
        <AppText variant="title">{technique.name}</AppText>
        <Stat label="Overall Similarity" value={overall} large />
      </View>

      <Card>
        {criteria.map((item) => (
          <View key={item.criterion} style={styles.phaseRow}>
            <AppText variant="body">{AI_CRITERION_LABELS[item.criterion]}</AppText>
            <AppText variant="bodyStrong">
              {item.notApplicable || item.score == null ? 'N/A' : `${item.score} / 4`}
            </AppText>
          </View>
        ))}
      </Card>

      {response.strengths && response.strengths.length > 0 ? (
        <Card>
          <AppText variant="caption" tone="success">
            What matched well
          </AppText>
          {response.strengths.map((item) => (
            <AppText key={item} variant="body">
              {`•  ${item}`}
            </AppText>
          ))}
        </Card>
      ) : null}

      {response.mainCorrections && response.mainCorrections.length > 0 ? (
        <Card>
          <AppText variant="caption" tone="accent">
            Main differences
          </AppText>
          {response.mainCorrections.map((item, index) => (
            <View key={`${item.title}-${index}`} style={styles.correction}>
              <AppText variant="bodyStrong">
                {`${index + 1}. ${item.title}`}
              </AppText>
              <AppText variant="body" tone="muted">
                {item.explanation}
              </AppText>
            </View>
          ))}
        </Card>
      ) : null}

      {response.summary ? (
        <Card>
          <AppText variant="caption">Summary</AppText>
          <AppText variant="body">{response.summary}</AppText>
        </Card>
      ) : null}

      {comparisonUri ? (
        <Button
          label={watching ? 'Hide Comparison' : 'Watch Comparison'}
          onPress={() => setWatching((value) => !value)}
        />
      ) : null}

      {watching && comparisonUri ? (
        <SynchronizedComparisonPlayer
          uri={comparisonUri}
          poseUri={poseUri}
          poseAvailable={response.poseOverlayAvailable ?? Boolean(poseUri)}
        />
      ) : null}

      {speechText ? (
        <Card>
          <AppText variant="caption">Audio feedback</AppText>
          <FeedbackSpeechControls
            speaking={speech.speaking}
            error={speech.error}
            onPlay={() => {
              void speech.play(speechText);
            }}
            onStop={() => {
              void speech.stop();
            }}
          />
        </Card>
      ) : null}

      <AnalysisDetailsCard
        details={{
          userMovementRegionCount: response.movementRegionCount,
          referenceMovementRegionCount: response.referenceMovementRegionCount,
          referenceDurationMs: response.referenceMovementWindow?.durationMs,
          userDurationMs: response.movementWindow?.durationMs,
          provider: response.debug?.provider ?? EXTERNAL_AI_PROVIDER_LABEL,
          aiModel: response.debug?.model,
          fallbackUsed: response.debug?.fallbackUsed ?? null,
          aiLatencyMs: response.debug?.latencyMs ?? response.processingLatency?.geminiProviderMs,
          fullAnalysisLatencyMs: response.processingLatency?.totalDetailedMs,
          quickLatencyMs: response.processingLatency?.totalQuickMs,
          aiComparisonDurationMs: response.debug?.aiVideoDurationMs,
          previewMatchesGemini: response.debug?.previewMatchesGemini,
        }}
      />

      <View style={styles.actions}>
        <Button label="Try Again" variant="secondary" onPress={retryAttempt} />
        <Button
          label={openingQuick ? 'Opening…' : 'View Computer Vision Comparison'}
          variant="secondary"
          disabled={openingQuick}
          onPress={() => {
            void openQuickComparison();
          }}
        />
        <Button
          label="Back to Technique"
          variant="ghost"
          onPress={() =>
            router.replace({
              pathname: '/technique/[techniqueId]',
              params: { techniqueId: technique.id },
            })
          }
        />
        <Button
          label="Privacy & Data"
          variant="ghost"
          accessibilityLabel="Open Privacy and Data information"
          onPress={() => router.push(privacyHref)}
        />
      </View>
      {quickError ? (
        <AppText variant="body" tone="warning">
          {quickError}
        </AppText>
      ) : null}
      {__DEV__ && response.debug ? <DeveloperDebug debug={response.debug} /> : null}
    </Screen>
  );
}

function orderedCriteria(items: AiCriterionAssessment[] | null): AiCriterionAssessment[] {
  if (!items) {
    return [];
  }
  return AI_ASSESSMENT_CRITERIA.map((id) => items.find((item) => item.criterion === id)).filter(
    (item): item is AiCriterionAssessment => item != null,
  );
}

function formatDebugSeconds(durationMs: number | null | undefined): string {
  if (durationMs == null) {
    return '—';
  }
  return `${(durationMs / 1000).toFixed(2)} s`;
}

function mediaUri(pathOrUrl: string | null): string | null {
  if (!pathOrUrl) {
    return null;
  }
  try {
    return resolveApiUrl(pathOrUrl);
  } catch {
    return null;
  }
}

function DeveloperDebug({
  debug,
}: {
  debug: NonNullable<ReturnType<typeof getLatestAiAssessment>>['response']['debug'];
}) {
  if (!debug) {
    return null;
  }
  return (
    <Card>
      <AppText variant="caption" tone="muted">
        Developer debug
      </AppText>
      <AppText variant="body" tone="muted">
        {`Provider ${debug.provider ?? '—'}`}
      </AppText>
      <AppText variant="body" tone="muted">
        {`Model ${debug.model}`}
      </AppText>
      {debug.requestedModel ? (
        <AppText variant="body" tone="muted">
          {`Requested ${debug.requestedModel}`}
        </AppText>
      ) : null}
      {debug.fallbackUsed ? (
        <AppText variant="body" tone="muted">
          {`Fallback used (${debug.fallbackAttempts ?? 0} backup attempts)`}
        </AppText>
      ) : null}
      {debug.primaryAttempts != null ? (
        <AppText variant="body" tone="muted">
          {`Primary attempts ${debug.primaryAttempts}`}
        </AppText>
      ) : null}
      <AppText variant="body" tone="muted">
        {`Latency ${debug.latencyMs} ms`}
      </AppText>
      {debug.uploadMethod ? (
        <AppText variant="body" tone="muted">
          {`Upload ${debug.uploadMethod}`}
        </AppText>
      ) : null}
      {debug.aiVideoDurationMs != null ? (
        <AppText variant="body" tone="muted">
          {`AI video ${(debug.aiVideoDurationMs / 1000).toFixed(2)} s`}
        </AppText>
      ) : null}
      {debug.geminiVideoFps != null ? (
        <AppText variant="body" tone="muted">
          {`Gemini FPS ${debug.geminiVideoFps}`}
        </AppText>
      ) : null}
      {debug.userMovementDurationMs != null ? (
        <AppText variant="body" tone="muted">
          {`USER movement ${(debug.userMovementDurationMs / 1000).toFixed(2)} s`}
        </AppText>
      ) : null}
      {debug.referenceMovementDurationMs != null ? (
        <AppText variant="body" tone="muted">
          {`REFERENCE movement ${(debug.referenceMovementDurationMs / 1000).toFixed(2)} s`}
        </AppText>
      ) : null}
      {debug.previewMatchesGemini != null ? (
        <AppText variant="body" tone="muted">
          {`Preview matches Gemini ${debug.previewMatchesGemini ? 'yes' : 'no'}`}
        </AppText>
      ) : null}
      {debug.referenceSource ? (
        <AppText variant="body" tone="muted">
          {`Reference source ${debug.referenceSource}`}
        </AppText>
      ) : null}
      {debug.referencePipeline?.regionCount != null ? (
        <AppText variant="body" tone="muted">
          {`REFERENCE regions ${debug.referencePipeline.regionCount} canonical ${formatDebugSeconds(debug.referencePipeline.canonicalDurationMs)}`}
        </AppText>
      ) : null}
      {debug.userPipeline?.regionCount != null ? (
        <AppText variant="body" tone="muted">
          {`USER regions ${debug.userPipeline.regionCount} canonical ${formatDebugSeconds(debug.userPipeline.canonicalDurationMs)}`}
        </AppText>
      ) : null}
      {debug.compositeId ? (
        <AppText variant="body" tone="muted">
          {`Composite ${debug.compositeId}`}
        </AppText>
      ) : null}
      <AppText variant="body" tone="muted">
        {`Analysis ${debug.analysisId}`}
      </AppText>
      {debug.confidence != null ? (
        <AppText variant="body" tone="muted">
          {`Confidence ${debug.confidence.toFixed(2)}`}
        </AppText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm,
  },
  phaseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  correction: {
    gap: spacing.xs,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
