import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { spacing } from '@/theme/spacing';
import { useAppTheme } from '@/theme/useAppTheme';

const STEPS = [
  'Uploading reference',
  'Detecting pose',
  'Finding active movement',
  'Extracting keyframes',
] as const;

export function ReferenceProcessingView() {
  const theme = useAppTheme();

  return (
    <View style={styles.wrap}>
      <Card>
        <ActivityIndicator size="large" color={theme.accent} />
        <AppText variant="title">Analyzing the reference…</AppText>
        <AppText variant="body" tone="muted">
          The server is measuring whether this recording is usable. This is not a technique score.
        </AppText>
        <View style={styles.steps}>
          {STEPS.map((step) => (
            <AppText key={step} variant="caption" tone="muted">
              {step}
            </AppText>
          ))}
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.lg,
  },
  steps: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
