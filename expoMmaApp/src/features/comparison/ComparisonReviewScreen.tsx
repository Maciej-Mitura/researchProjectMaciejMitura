import { Image, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { useState } from 'react';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { MediaFrame } from '@/components/MediaFrame';
import { Screen } from '@/components/Screen';
import { Stat } from '@/components/Stat';
import { FeedbackSpeechControls } from '@/features/audio/FeedbackSpeechControls';
import { buildQuickSpeechText } from '@/features/audio/quickSpeech';
import { useFeedbackSpeech } from '@/features/audio/useFeedbackSpeech';
import { resolveApiUrl } from '@/features/analysis/api/config';
import { AiProcessingView } from '@/features/ai/AiProcessingView';
import { useDetailedAnalysis } from '@/features/ai/useDetailedAnalysis';
import { SynchronizedComparisonPlayer } from '@/features/comparison/SynchronizedComparisonPlayer';
import type { ComparisonPair, MovementSimilarityResult } from '@/features/comparison/types';
import { GENERIC_COMPARISON_PHASES } from '@/features/comparison/types';
import { clearLatestComparison, getLatestComparison } from '@/features/comparison/latestComparison';
import { ExternalAiDisclosure } from '@/features/privacy/ExternalAiDisclosure';
import { nextDetailedAnalysisAction } from '@/features/privacy/gates';
import { usePrivacyAcknowledgements } from '@/features/privacy/PrivacyAcknowledgementsContext';
import { TechniqueNotFound } from '@/features/techniques/TechniqueNotFound';
import { useTechniqueLibrary } from '@/features/techniques/TechniqueLibraryContext';
import { AnalysisErrorView } from '@/features/training/AnalysisErrorView';
import { CAMERA_MEDIA_ASPECT_RATIO } from '@/features/training/constants';
import { getAcceptedAttempt } from '@/features/training/acceptedAttempt';
import { spacing } from '@/theme/spacing';
import { useAppTheme } from '@/theme/useAppTheme';
import { shouldReturnToValidationResult } from '@/features/validation/session';
import { privacyHref, validationResultHref } from '@/utils/routes';
import { useTechniqueIdParam } from '@/utils/techniqueParams';
import { AnalysisDetailsCard } from '@/features/validation/AnalysisDetailsCard';
import { DeviationLegend } from '@/features/validation/DeviationLegend';

function orderedPairs(pairs: ComparisonPair[] | null): ComparisonPair[] {
  if (!pairs) {
    return [];
  }
  return [...pairs].sort((a, b) => {
    const aIndex = GENERIC_COMPARISON_PHASES.indexOf(a.phase);
    const bIndex = GENERIC_COMPARISON_PHASES.indexOf(b.phase);
    if (aIndex === -1 || bIndex === -1) {
      return a.user.timestampMs - b.user.timestampMs;
    }
    return aIndex - bIndex;
  });
}

export function ComparisonReviewScreen() {
  const techniqueId = useTechniqueIdParam();
  const { getById, loading } = useTechniqueLibrary();
  const technique = techniqueId ? getById(techniqueId) : undefined;
  const stored = getLatestComparison();
  const detailed = useDetailedAnalysis();
  const attempt = getAcceptedAttempt();
  const privacy = usePrivacyAcknowledgements();
  const speech = useFeedbackSpeech();
  const [showStills, setShowStills] = useState(false);
  const [showAiDisclosure, setShowAiDisclosure] = useState(false);

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
          hint="Quick Comparison still works. You can keep watching the synchronized video."
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
          const latest = getLatestComparison();
          const videoUri = latest?.attemptVideoUri || attempt?.videoUri;
          if (!videoUri) {
            setShowAiDisclosure(false);
            return;
          }
          void (async () => {
            await privacy.acknowledgeExternalAi();
            setShowAiDisclosure(false);
            void detailed.run(technique.id, videoUri);
          })();
        }}
      />
    );
  }

  const retryAttempt = () => {
    clearLatestComparison();
    router.replace({
      pathname: '/training/[techniqueId]',
      params: { techniqueId: technique.id },
    });
  };

  if (!stored || stored.techniqueId !== technique.id) {
    return (
      <Screen>
        <AppText variant="title">No comparison to display</AppText>
        <AppText variant="body" tone="muted">
          Record an attempt and choose Use This Attempt to prepare a synchronized comparison.
        </AppText>
        <Button label="Back to Training" onPress={retryAttempt} />
      </Screen>
    );
  }

  const { response } = stored;
  const comparisonUri = mediaUri(response.comparisonVideoUrl);
  const poseUri = mediaUri(response.comparisonPoseVideoUrl);

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="caption" tone="accent">
          Computer Vision Comparison
        </AppText>
        <AppText variant="title">{technique.name}</AppText>
        <AppText variant="body" tone="muted">
          Synchronized REFERENCE ↔ YOU. Movement Similarity measures how closely your detected
          movement matches the recorded reference.
        </AppText>
      </View>

      {response.analysisValid ? (
        <>
          {comparisonUri ? (
            <SynchronizedComparisonPlayer
              uri={comparisonUri}
              poseUri={poseUri}
              poseAvailable={response.poseOverlayAvailable ?? Boolean(poseUri)}
            />
          ) : (
            <Card>
              <AppText variant="title">Comparison video unavailable</AppText>
              <AppText variant="body" tone="muted">
                The synchronized video could not be created. Keyframe stills may still be available
                as debug material.
              </AppText>
            </Card>
          )}

          <MovementSimilarityCard
            similarity={response.movementSimilarity}
            analysisValid={response.analysisValid}
            speech={speech}
          />

          {response.movementSimilarity?.diagnostics?.largestDeviation ? (
            <DeviationLegend
              bodyPart={response.movementSimilarity.diagnostics.largestDeviation.bodyPart}
              progressStart={response.movementSimilarity.diagnostics.largestDeviation.progressStart}
              progressEnd={response.movementSimilarity.diagnostics.largestDeviation.progressEnd}
            />
          ) : null}

          <AnalysisDetailsCard
            details={{
              userMovementRegionCount: response.movementRegionCount,
              referenceMovementRegionCount: response.referenceMovementRegionCount,
              referenceDurationMs: response.referenceMovementWindow?.durationMs,
              userDurationMs: response.movementWindow?.durationMs,
              poseCoverage: response.poseCoverage,
              quickLatencyMs: response.processingLatency?.totalQuickMs,
              normalizedSampleCount: response.normalizedSampleCount,
            }}
          />

          <Pressable accessibilityRole="button" onPress={() => setShowStills((value) => !value)}>
            <AppText variant="bodyStrong" tone="accent">
              {showStills ? 'Hide keyframe stills' : 'Show keyframe stills (debug)'}
            </AppText>
          </Pressable>
          {showStills
            ? orderedPairs(response.pairs).map((pair) => (
                <PhasePairCard key={`${response.analysisId}-${pair.phase}`} pair={pair} />
              ))
            : null}

          <View style={styles.actions}>
            <Button
              label="Detailed AI Analysis"
              accessibilityLabel="Detailed AI Analysis using Google Gemini"
              onPress={() => {
                const videoUri = stored.attemptVideoUri || attempt?.videoUri;
                if (!videoUri) {
                  return;
                }
                if (!privacy.ready) {
                  return;
                }
                if (nextDetailedAnalysisAction(privacy.acknowledgements) === 'show-disclosure') {
                  setShowAiDisclosure(true);
                  return;
                }
                void detailed.run(technique.id, videoUri);
              }}
            />
            <Button label="Try Again" variant="secondary" onPress={retryAttempt} />
            <Button
              label={shouldReturnToValidationResult(technique.id) ? 'Back to result' : 'Back to Technique'}
              variant="ghost"
              onPress={() => {
                if (shouldReturnToValidationResult(technique.id)) {
                  router.replace(validationResultHref);
                  return;
                }
                router.replace({
                  pathname: '/technique/[techniqueId]',
                  params: { techniqueId: technique.id },
                });
              }}
            />
            <Button
              label="Privacy & Data"
              variant="ghost"
              accessibilityLabel="Open Privacy and Data information"
              onPress={() => router.push(privacyHref)}
            />
          </View>
        </>
      ) : (
        <>
          <Card>
            <AppText variant="title">Attempt could not be measured</AppText>
            <AppText variant="body" tone="muted">
              {response.failureMessage ??
                'The recording did not contain a usable movement window.'}
            </AppText>
            <AppText variant="body" tone="muted">
              This is not a low technique score. Retry with a clearer full-body view.
            </AppText>
          </Card>
          <View style={styles.actions}>
            <Button label="Retry Attempt" onPress={retryAttempt} />
            <Button
              label="Back"
              variant="secondary"
              onPress={() => {
                if (shouldReturnToValidationResult(technique.id)) {
                  router.replace(validationResultHref);
                  return;
                }
                router.replace({
                  pathname: '/get-ready/[techniqueId]',
                  params: { techniqueId: technique.id },
                });
              }}
            />
          </View>
        </>
      )}
    </Screen>
  );
}

function MovementSimilarityCard({
  similarity,
  analysisValid,
  speech,
}: {
  similarity: MovementSimilarityResult | null;
  analysisValid: boolean;
  speech: ReturnType<typeof useFeedbackSpeech>;
}) {
  if (!analysisValid) {
    return null;
  }
  if (!similarity || !similarity.similarityValid || similarity.movementSimilarity == null) {
    return (
      <Card>
        <AppText variant="caption" tone="warning">
          Movement Similarity unavailable
        </AppText>
        <AppText variant="body" tone="muted">
          {similarity?.invalidReason ??
            'Pose coverage was not sufficient to measure similarity. This is not a technique score.'}
        </AppText>
      </Card>
    );
  }

  const components = similarity.components;
  const overall = `${similarity.movementSimilarity} / 100`;
  const speechText = buildQuickSpeechText(similarity);

  return (
    <Card>
      <AppText variant="caption" tone="accent">
        Computer Vision Comparison
      </AppText>
      <Stat label="Movement Similarity" value={overall} large />
      {components ? (
        <View style={styles.componentColumn}>
          <View style={styles.phaseRow}>
            <AppText variant="body">Pose / Form</AppText>
            <AppText variant="bodyStrong">{`${components.poseSimilarity}`}</AppText>
          </View>
          <View style={styles.phaseRow}>
            <AppText variant="body">Movement Path</AppText>
            <AppText variant="bodyStrong">{`${components.movementPathSimilarity}`}</AppText>
          </View>
          <View style={styles.phaseRow}>
            <AppText variant="body">Timing</AppText>
            <AppText variant="bodyStrong">{`${components.timingSimilarity}`}</AppText>
          </View>
        </View>
      ) : null}
      {similarity.feedback ? (
        <View style={styles.feedbackBlock}>
          <AppText variant="caption" tone="success">
            Measured feedback
          </AppText>
          <AppText variant="body">{similarity.feedback.strongest}</AppText>
          <AppText variant="caption" tone="accent">
            Largest difference
          </AppText>
          <AppText variant="body">{similarity.feedback.mainDifference}</AppText>
        </View>
      ) : null}
      <SimilarityTimeline values={similarity.diagnostics?.timeline ?? null} />
      {speechText ? (
        <View style={styles.feedbackBlock}>
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
        </View>
      ) : null}
      <AppText variant="body" tone="muted">
        Similarity compares your detected movement with the recorded reference. It is not an
        expert correctness score.
      </AppText>
    </Card>
  );
}

function SimilarityTimeline({ values }: { values: number[] | null }) {
  const theme = useAppTheme();
  if (!values || values.length === 0) {
    return null;
  }
  return (
    <View style={styles.timeline} accessibilityLabel="Movement similarity timeline">
      {values.map((value, index) => {
        const height = 6 + Math.round((value / 100) * 18);
        return (
          <View
            key={`seg-${index}`}
            style={[
              styles.timelineBar,
              {
                height,
                backgroundColor: value >= 75 ? theme.success : value >= 50 ? theme.accent : theme.warning,
              },
            ]}
          />
        );
      })}
    </View>
  );
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

function PhasePairCard({ pair }: { pair: ComparisonPair }) {
  const { width } = useWindowDimensions();
  const sideBySide = width >= 720;

  return (
    <Card>
      <AppText variant="caption" tone="accent">
        {pair.phase}
      </AppText>
      <View style={sideBySide ? styles.sideBySide : styles.stacked}>
        <FrameBlock label="YOU" uri={mediaUri(pair.user.keyframeUrl)} timestampMs={pair.user.timestampMs} />
        <FrameBlock
          label="REFERENCE"
          uri={mediaUri(pair.reference.keyframeUrl)}
          timestampMs={pair.reference.timestampMs}
        />
      </View>
    </Card>
  );
}

function FrameBlock({
  label,
  uri,
  timestampMs,
}: {
  label: string;
  uri: string | null;
  timestampMs: number;
}) {
  return (
    <View style={styles.frameBlock}>
      <View style={styles.phaseHeader}>
        <AppText variant="caption">{label}</AppText>
        <AppText variant="caption" tone="muted">
          {`${(timestampMs / 1000).toFixed(2)} s`}
        </AppText>
      </View>
      <MediaFrame aspectRatio={CAMERA_MEDIA_ASPECT_RATIO}>
        {uri ? (
          <Image source={{ uri }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={styles.missing}>
            <AppText variant="body" tone="muted">
              Frame unavailable
            </AppText>
          </View>
        )}
      </MediaFrame>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm,
  },
  stacked: {
    gap: spacing.md,
  },
  sideBySide: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  frameBlock: {
    flex: 1,
    gap: spacing.sm,
  },
  phaseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  actions: {
    gap: spacing.sm,
  },
  componentColumn: {
    gap: spacing.xs,
  },
  phaseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  feedbackBlock: {
    gap: spacing.xs,
  },
  timeline: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    minHeight: 24,
  },
  timelineBar: {
    flex: 1,
    borderRadius: 2,
    minHeight: 6,
  },
});
