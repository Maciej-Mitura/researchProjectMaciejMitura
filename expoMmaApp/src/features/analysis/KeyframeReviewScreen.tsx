import { Image, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { MediaFrame } from '@/components/MediaFrame';
import { Screen } from '@/components/Screen';
import { resolveApiUrl } from '@/features/analysis/api/config';
import { ANALYSIS_PHASE_ORDER } from '@/features/analysis/constants';
import { clearLatestAnalysis, getLatestAnalysis } from '@/features/analysis/latestAnalysis';
import type { DetectedPhase } from '@/features/analysis/types';
import { TechniqueNotFound } from '@/features/techniques/TechniqueNotFound';
import { useTechniqueLibrary } from '@/features/techniques/TechniqueLibraryContext';
import { CAMERA_MEDIA_ASPECT_RATIO } from '@/features/training/constants';
import { spacing } from '@/theme/spacing';
import { useTechniqueIdParam } from '@/utils/techniqueParams';

function formatTimestamp(timestampMs: number): string {
  return `${(timestampMs / 1000).toFixed(2)} s`;
}

function orderedPhases(phases: DetectedPhase[] | null): DetectedPhase[] {
  if (!phases) {
    return [];
  }

  return [...phases].sort((a, b) => {
    const aIndex = ANALYSIS_PHASE_ORDER.findIndex((name) => name === a.phase);
    const bIndex = ANALYSIS_PHASE_ORDER.findIndex((name) => name === b.phase);
    if (aIndex === -1 || bIndex === -1) {
      return a.timestampMs - b.timestampMs;
    }
    return aIndex - bIndex;
  });
}

export function KeyframeReviewScreen() {
  const techniqueId = useTechniqueIdParam();
  const { getById, loading } = useTechniqueLibrary();
  const technique = techniqueId ? getById(techniqueId) : undefined;
  const stored = getLatestAnalysis();

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

  const retryAttempt = () => {
    clearLatestAnalysis();
    router.replace({
      pathname: '/training/[techniqueId]',
      params: { techniqueId: technique.id },
    });
  };

  if (!stored || stored.techniqueId !== technique.id) {
    return (
      <Screen>
        <AppText variant="title">No analysis to display</AppText>
        <AppText variant="body" tone="muted">
          This experimental keyframe check is not part of normal training. Use a recorded technique for comparison.
        </AppText>
        <Button label="Back to Training" onPress={retryAttempt} />
      </Screen>
    );
  }

  const { response } = stored;
  const coverage =
    response.poseCoverage == null ? null : `${Math.round(response.poseCoverage * 100)}%`;
  const duration =
    response.video == null ? null : `${(response.video.durationMs / 1000).toFixed(1)} s`;

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="caption" tone="muted">
          Experimental / legacy
        </AppText>
        <AppText variant="title">{technique.name}</AppText>
        <AppText variant="body" tone="muted">
          Built-in Jab five-frame check for research history. This is not production comparison
          and not a technique score.
        </AppText>
      </View>

      <Card>
        <AppText variant="caption" tone={response.analysisValid ? 'success' : 'warning'}>
          {response.analysisValid ? 'Analysis valid' : 'Analysis invalid'}
        </AppText>
        {coverage ? (
          <AppText variant="body" tone="muted">
            Pose coverage {coverage}
          </AppText>
        ) : null}
        {duration ? (
          <AppText variant="body" tone="muted">
            Video {duration}
          </AppText>
        ) : null}
      </Card>

      {response.analysisValid ? (
        <>
          {orderedPhases(response.phases).map((phase) => (
            <PhaseCard key={`${response.analysisId}-${phase.phase}`} phase={phase} />
          ))}
          <View style={styles.actions}>
            <AppText variant="body" tone="muted">
              Experimental / legacy five-frame check. This is not a technique score and does not
              open comparison results.
            </AppText>
            <Button
              label="Back to Technique"
              onPress={() =>
                router.replace({
                  pathname: '/technique/[techniqueId]',
                  params: { techniqueId: technique.id },
                })
              }
            />
            <Button label="Retry Attempt" variant="secondary" onPress={retryAttempt} />
          </View>
        </>
      ) : (
        <>
          <Card>
            <AppText variant="title">Attempt could not be analyzed</AppText>
            <AppText variant="body" tone="muted">
              {response.failureMessage ??
                'The recording did not contain a usable jab movement for measurement.'}
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
              onPress={() =>
                router.replace({
                  pathname: '/get-ready/[techniqueId]',
                  params: { techniqueId: technique.id },
                })
              }
            />
          </View>
        </>
      )}
    </Screen>
  );
}

function keyframeImageUri(pathOrUrl: string | null): string | null {
  if (!pathOrUrl) {
    return null;
  }

  try {
    return resolveApiUrl(pathOrUrl);
  } catch {
    return null;
  }
}

function PhaseCard({ phase }: { phase: DetectedPhase }) {
  const uri = keyframeImageUri(phase.keyframeUrl);

  return (
    <Card>
      <View style={styles.phaseHeader}>
        <AppText variant="caption" tone="accent">
          {phase.phase}
        </AppText>
        <AppText variant="caption" tone="muted">
          {formatTimestamp(phase.timestampMs)}
        </AppText>
      </View>
      <MediaFrame aspectRatio={CAMERA_MEDIA_ASPECT_RATIO}>
        {uri ? (
          <Image source={{ uri }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={styles.missing}>
            <AppText variant="body" tone="muted">
              Keyframe image unavailable
            </AppText>
          </View>
        )}
      </MediaFrame>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
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
});
