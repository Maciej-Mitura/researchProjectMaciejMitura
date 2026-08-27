import { useCallback, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { MediaFrame } from '@/components/MediaFrame';
import { Screen } from '@/components/Screen';
import { resolveApiUrl } from '@/features/analysis/api/config';
import { confirmReferenceDraft, discardReferenceDraft } from '@/features/reference/api/client';
import { ReferenceClientError } from '@/features/reference/api/errors';
import {
  clearReferenceCapture,
  getReferenceCapture,
} from '@/features/reference/captureSession';
import { GENERIC_KEYFRAME_ORDER } from '@/features/reference/constants';
import type { ReferenceKeyframe } from '@/features/reference/types';
import { recordedSummaryToTechnique } from '@/features/techniques/library';
import { useTechniqueLibrary } from '@/features/techniques/TechniqueLibraryContext';
import { CAMERA_MEDIA_ASPECT_RATIO } from '@/features/training/constants';
import { addTechniqueHref, recordReferenceHref } from '@/utils/routes';
import { spacing } from '@/theme/spacing';

function formatTimestamp(timestampMs: number): string {
  return `${(timestampMs / 1000).toFixed(2)} s`;
}

function orderedKeyframes(keyframes: ReferenceKeyframe[] | null): ReferenceKeyframe[] {
  if (!keyframes) {
    return [];
  }
  return [...keyframes].sort((a, b) => {
    const aIndex = GENERIC_KEYFRAME_ORDER.findIndex((name) => name === a.phase);
    const bIndex = GENERIC_KEYFRAME_ORDER.findIndex((name) => name === b.phase);
    if (aIndex === -1 || bIndex === -1) {
      return a.timestampMs - b.timestampMs;
    }
    return aIndex - bIndex;
  });
}

export function ReferenceKeyframeReviewScreen() {
  const capture = getReferenceCapture();
  const { refresh, upsertRecorded, setLibraryNotice } = useTechniqueLibrary();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onRetake = useCallback(() => {
    const draftId = capture?.draft?.draftId;
    if (draftId) {
      void discardReferenceDraft(draftId);
    }
    router.replace(recordReferenceHref);
  }, [capture?.draft?.draftId]);

  const onConfirm = useCallback(async () => {
    const draft = capture?.draft;
    if (!draft || busy) {
      return;
    }
    if (!draft.analysisValid) {
      setError('This reference could not be measured. Retake the recording.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const confirmed = await confirmReferenceDraft(draft.draftId);
      upsertRecorded(recordedSummaryToTechnique(confirmed.technique));
      setLibraryNotice(`Reference saved: ${confirmed.technique.name}. You can replay it, practice against it, or delete it later.`);
      setLibraryNotice(`Reference saved: ${confirmed.technique.name}. You can replay it, practice against it, or delete it later.`);
      void refresh();
      clearReferenceCapture();
      router.replace({
        pathname: '/technique/[techniqueId]',
        params: { techniqueId: confirmed.technique.id },
      });
    } catch (caught) {
      const message =
        caught instanceof ReferenceClientError
          ? caught.message
          : 'The reference could not be saved. Please try again.';
      setError(message);
      setBusy(false);
    }
  }, [busy, capture?.draft, refresh, setLibraryNotice, upsertRecorded]);

  if (!capture?.draft) {
    return (
      <Screen>
        <AppText variant="title">No reference analysis to display</AppText>
        <Button label="Back" onPress={() => router.replace(addTechniqueHref)} />
      </Screen>
    );
  }

  const { draft } = capture;
  const coverage =
    draft.poseCoverage == null ? null : `${Math.round(draft.poseCoverage * 100)}%`;
  const windowDuration =
    draft.movementWindow == null
      ? null
      : `${(draft.movementWindow.durationMs / 1000).toFixed(2)} s`;

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="caption" tone="accent">
          Reference keyframes
        </AppText>
        <AppText variant="title">{draft.name}</AppText>
        <AppText variant="body" tone="muted">
          Confirming saves this recording as the technique reference. Future practice attempts will
          be compared to this video. This is not a technique score.
        </AppText>
      </View>

      <Card>
        <AppText variant="caption" tone={draft.analysisValid ? 'success' : 'warning'}>
          {draft.analysisValid ? 'Reference measurable' : 'Reference not measurable'}
        </AppText>
        {coverage ? (
          <AppText variant="body" tone="muted">
            Pose coverage {coverage}
          </AppText>
        ) : null}
        {windowDuration ? (
          <AppText variant="body" tone="muted">
            Movement window {windowDuration}
          </AppText>
        ) : null}
      </Card>

      {draft.analysisValid ? (
        <>
          {orderedKeyframes(draft.keyframes).map((frame) => (
            <KeyframeCard key={`${draft.draftId}-${frame.phase}`} frame={frame} />
          ))}
          {error ? (
            <AppText variant="body" tone="warning">
              {error}
            </AppText>
          ) : null}
          <View style={styles.actions}>
            <Button
              label={busy ? 'Saving…' : 'Confirm Reference'}
              disabled={busy}
              onPress={() => {
                void onConfirm();
              }}
            />
            <Button label="Retake" variant="secondary" disabled={busy} onPress={onRetake} />
          </View>
        </>
      ) : (
        <>
          <Card>
            <AppText variant="title">Reference could not be measured</AppText>
            <AppText variant="body" tone="muted">
              {draft.failureMessage ??
                'The recording did not contain a usable movement window.'}
            </AppText>
            <AppText variant="body" tone="muted">
              This is not a low technique score. Retake with a clearer full-body view.
            </AppText>
          </Card>
          <Button label="Retake" onPress={onRetake} />
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

function KeyframeCard({ frame }: { frame: ReferenceKeyframe }) {
  const uri = keyframeImageUri(frame.url);

  return (
    <Card>
      <View style={styles.phaseHeader}>
        <AppText variant="caption" tone="accent">
          {frame.phase}
        </AppText>
        <AppText variant="caption" tone="muted">
          {formatTimestamp(frame.timestampMs)}
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
