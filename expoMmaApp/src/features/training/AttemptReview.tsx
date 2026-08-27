import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { MediaFrame } from '@/components/MediaFrame';
import { AttemptPlayback } from '@/features/camera/AttemptPlayback';
import { CAMERA_MEDIA_ASPECT_RATIO } from '@/features/training/constants';
import type { AttemptData } from '@/features/training/types';
import { spacing } from '@/theme/spacing';

type AttemptReviewProps = {
  techniqueName: string;
  attempt: AttemptData;
  onRetry: () => void;
  onAccept: () => void;
};

export function AttemptReview({
  techniqueName,
  attempt,
  onRetry,
  onAccept,
}: AttemptReviewProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <AppText variant="caption" tone="accent">
          Review
        </AppText>
        <AppText variant="title">{techniqueName}</AppText>
        <AppText variant="body" tone="muted">
          Watch the attempt, then retry or use this recording.
        </AppText>
      </View>

      <MediaFrame aspectRatio={CAMERA_MEDIA_ASPECT_RATIO}>
        <AttemptPlayback uri={attempt.videoUri} />
      </MediaFrame>

      <View style={styles.actions}>
        <Button label="Use This Attempt" onPress={onAccept} />
        <Button label="Retry" variant="secondary" onPress={onRetry} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.lg,
  },
  header: {
    gap: spacing.sm,
  },
  actions: {
    gap: spacing.sm,
  },
});
