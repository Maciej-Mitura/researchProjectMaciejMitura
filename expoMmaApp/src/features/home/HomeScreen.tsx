import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { PRIVACY_SCREEN_LINK_LABEL } from '@/features/privacy/copy';
import { spacing } from '@/theme/spacing';
import { privacyHref, validationHref } from '@/utils/routes';

export function HomeScreen() {
  return (
    <Screen>
      <View style={styles.hero}>
        <AppText variant="caption" tone="accent">
          MMA TRAINER
        </AppText>
        <AppText variant="display">Train your striking</AppText>
        <AppText variant="body" tone="muted">
          Record a human reference, practice the same movement, then review with computer vision
          or optional Google Gemini analysis.
        </AppText>
      </View>

      <View style={styles.primary}>
        <Button label="Start Training" onPress={() => router.push('/techniques')} />
        <Button
          label="Techniques"
          variant="secondary"
          accessibilityLabel="Manage techniques"
          onPress={() => router.push('/techniques')}
        />
      </View>

      <Button
        label={PRIVACY_SCREEN_LINK_LABEL}
        variant="ghost"
        accessibilityLabel="Open Privacy and Data information"
        onPress={() => router.push(privacyHref)}
      />

      <Card>
        <AppText variant="caption" tone="muted">
          Research tools
        </AppText>
        <AppText variant="body" tone="muted">
          Developer / presentation
        </AppText>
        <Button
          label="Research Validation"
          variant="secondary"
          accessibilityLabel="Research Validation, research tool"
          onPress={() => router.push(validationHref)}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.md,
    paddingTop: spacing.xxxl,
  },
  primary: {
    gap: spacing.sm,
  },
});
