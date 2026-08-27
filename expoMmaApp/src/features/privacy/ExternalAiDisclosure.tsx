import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import {
  CONTINUE_AI_LABEL,
  EXTERNAL_AI_DISCLOSURE_INTRO,
  EXTERNAL_AI_DISCLOSURE_POINTS,
  EXTERNAL_AI_DISCLOSURE_TITLE,
  EXTERNAL_AI_PROVIDER_LABEL,
  USE_QUICK_INSTEAD_LABEL,
} from '@/features/privacy/copy';
import { spacing } from '@/theme/spacing';

type ExternalAiDisclosureProps = {
  onUseQuickComparison: () => void;
  onContinue: () => void;
};

export function ExternalAiDisclosure({
  onUseQuickComparison,
  onContinue,
}: ExternalAiDisclosureProps) {
  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="caption" tone="accent">
          External AI processing
        </AppText>
        <AppText variant="title">{EXTERNAL_AI_DISCLOSURE_TITLE}</AppText>
        <AppText variant="body" tone="muted">
          {EXTERNAL_AI_DISCLOSURE_INTRO}
        </AppText>
      </View>

      <Card>
        <AppText variant="caption">{`Provider: ${EXTERNAL_AI_PROVIDER_LABEL}`}</AppText>
        {EXTERNAL_AI_DISCLOSURE_POINTS.map((point) => (
          <AppText key={point} variant="body">
            {`•  ${point}`}
          </AppText>
        ))}
      </Card>

      <View style={styles.actions}>
        <Button
          label={CONTINUE_AI_LABEL}
          accessibilityLabel="Continue with AI Analysis and send comparison video to Google Gemini"
          onPress={onContinue}
        />
        <Button
          label={USE_QUICK_INSTEAD_LABEL}
          variant="secondary"
          accessibilityLabel="Use Quick Comparison instead of sending video to Google Gemini"
          onPress={onUseQuickComparison}
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
