import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import {
  PLAY_FEEDBACK_LABEL,
  REPLAY_FEEDBACK_LABEL,
  STOP_FEEDBACK_LABEL,
} from '@/features/privacy/copy';
import { spacing } from '@/theme/spacing';

type FeedbackSpeechControlsProps = {
  disabled?: boolean;
  speaking: boolean;
  error: string | null;
  onPlay: () => void;
  onStop: () => void;
};

export function FeedbackSpeechControls({
  disabled = false,
  speaking,
  error,
  onPlay,
  onStop,
}: FeedbackSpeechControlsProps) {
  return (
    <View style={styles.wrap}>
      <Button
        label={PLAY_FEEDBACK_LABEL}
        disabled={disabled || speaking}
        accessibilityLabel="Play feedback"
        onPress={onPlay}
      />
      <Button
        label={STOP_FEEDBACK_LABEL}
        variant="secondary"
        disabled={!speaking}
        accessibilityLabel="Stop feedback"
        onPress={onStop}
      />
      <Button
        label={REPLAY_FEEDBACK_LABEL}
        variant="ghost"
        disabled={disabled || speaking}
        accessibilityLabel="Replay feedback"
        onPress={onPlay}
      />
      {error ? (
        <AppText variant="body" tone="warning">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
});
