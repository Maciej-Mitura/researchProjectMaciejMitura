import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { MediaFrame } from '@/components/MediaFrame';
import { Screen } from '@/components/Screen';
import { AttemptPlayback } from '@/features/camera/AttemptPlayback';
import { createReferenceDraft } from '@/features/reference/api/client';
import { ReferenceClientError } from '@/features/reference/api/errors';
import {
  getReferenceCapture,
  setReferenceDraft,
} from '@/features/reference/captureSession';
import { ReferenceProcessingView } from '@/features/reference/ReferenceProcessingView';
import { CAMERA_MEDIA_ASPECT_RATIO } from '@/features/training/constants';
import { recordReferenceHref, referenceKeyframesHref } from '@/utils/routes';
import { spacing } from '@/theme/spacing';

export function ReferenceReviewScreen() {
  const capture = getReferenceCapture();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onAnalyze = useCallback(async () => {
    if (!capture?.videoUri || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const draft = await createReferenceDraft({
        name: capture.name,
        description: capture.description,
        videoUri: capture.videoUri,
        recordingDurationSeconds: capture.recordingDurationSeconds,
      });
      setReferenceDraft(draft);
      router.replace(referenceKeyframesHref);
    } catch (caught) {
      if (caught instanceof ReferenceClientError && caught.code === 'analysis_rejected' && caught.draft) {
        setReferenceDraft(caught.draft);
        router.replace(referenceKeyframesHref);
        return;
      }
      const message =
        caught instanceof ReferenceClientError
          ? caught.message
          : 'The reference could not be uploaded. Please try again.';
      setError(message);
      setBusy(false);
    }
  }, [busy, capture]);

  if (!capture?.videoUri) {
    return (
      <Screen>
        <AppText variant="title">No recording to review</AppText>
        <Button label="Record again" onPress={() => router.replace(recordReferenceHref)} />
      </Screen>
    );
  }

  if (busy) {
    return (
      <Screen>
        <ReferenceProcessingView />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="caption" tone="accent">
          Review recording
        </AppText>
        <AppText variant="title">{capture.name}</AppText>
        <AppText variant="body" tone="muted">
          Watch the full clip. Confirming later saves this recording as the technique reference
          that future attempts are compared against.
        </AppText>
      </View>

      <MediaFrame aspectRatio={CAMERA_MEDIA_ASPECT_RATIO}>
        <AttemptPlayback uri={capture.videoUri} />
      </MediaFrame>

      {error ? (
        <AppText variant="body" tone="warning">
          {error}
        </AppText>
      ) : null}

      <View style={styles.actions}>
        <Button
          label="Analyze Reference"
          onPress={() => {
            void onAnalyze();
          }}
        />
        <Button
          label="Retake"
          variant="secondary"
          onPress={() => router.replace(recordReferenceHref)}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm,
  },
  actions: {
    gap: spacing.sm,
  },
});
