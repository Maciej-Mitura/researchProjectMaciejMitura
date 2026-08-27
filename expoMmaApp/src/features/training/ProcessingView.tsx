import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { spacing } from '@/theme/spacing';
import { useAppTheme } from '@/theme/useAppTheme';

type ProcessingViewProps = {
  title?: string;
  description?: string;
  steps?: readonly string[];
  currentIndex?: number;
};

const DEFAULT_STEPS = ['Uploading attempt', 'Detecting pose', 'Finding movement phases'] as const;
const DEFAULT_DESCRIPTION =
  'This can take several seconds. The server is reading the recording, not scoring the technique.';

export function ProcessingView({
  title = 'Analyzing your movement…',
  description = DEFAULT_DESCRIPTION,
  steps = DEFAULT_STEPS,
  currentIndex = 0,
}: ProcessingViewProps) {
  const theme = useAppTheme();

  return (
    <View style={styles.wrap}>
      <Card>
        <ActivityIndicator size="large" color={theme.accent} />
        <AppText variant="title">{title}</AppText>
        <AppText variant="body" tone="muted">
          {description}
        </AppText>
        <View style={styles.steps}>
          {steps.map((step, index) => {
            const state = index < currentIndex ? 'complete' : index === currentIndex ? 'active' : 'pending';
            const marker = state === 'complete' ? '✓' : state === 'active' ? '●' : '○';
            const tone = state === 'complete' ? 'success' : state === 'active' ? 'accent' : 'muted';
            return (
              <AppText key={step} variant="body" tone={tone}>
                {`${marker} ${step}`}
              </AppText>
            );
          })}
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
