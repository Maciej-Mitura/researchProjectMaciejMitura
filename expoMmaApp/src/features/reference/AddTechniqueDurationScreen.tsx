import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { getReferenceCapture, setReferenceRecordingDuration } from '@/features/reference/captureSession';
import { RecordingDurationSlider } from '@/features/training/RecordingDurationSlider';
import { GENERIC_ATTEMPT_DURATION_DEFAULT_SECONDS } from '@/features/training/constants';
import { addTechniqueHref, recordReferenceHref } from '@/utils/routes';
import { spacing } from '@/theme/spacing';

export function AddTechniqueDurationScreen() {
  const capture = getReferenceCapture();
  const [durationSeconds, setDurationSeconds] = useState(
    capture?.recordingDurationSeconds ?? GENERIC_ATTEMPT_DURATION_DEFAULT_SECONDS,
  );

  const onContinue = useCallback(() => {
    if (!capture) {
      router.replace(addTechniqueHref);
      return;
    }
    setReferenceRecordingDuration(durationSeconds);
    router.push(recordReferenceHref);
  }, [capture, durationSeconds]);

  if (!capture) {
    return (
      <Screen>
        <AppText variant="title">No technique started</AppText>
        <AppText variant="body" tone="muted">
          Enter a name before choosing a recording length.
        </AppText>
        <Button label="Back" onPress={() => router.replace(addTechniqueHref)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="caption" tone="accent">
          Add technique
        </AppText>
        <AppText variant="title">Recording length</AppText>
        <AppText variant="body" tone="muted">
          Choose how long the camera records. Keep it long enough for the full technique, then a
          brief return to stance.
        </AppText>
      </View>

      <Card>
        <AppText variant="subtitle">{capture.name}</AppText>
        <RecordingDurationSlider value={durationSeconds} onChange={setDurationSeconds} />
      </Card>

      <Button label="Continue to recording" onPress={onContinue} />
      <Button label="Back" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm,
  },
});
