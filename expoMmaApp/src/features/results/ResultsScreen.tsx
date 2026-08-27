import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { TechniqueNotFound } from '@/features/techniques/TechniqueNotFound';
import { getTechniqueById } from '@/features/techniques/catalog';
import { spacing } from '@/theme/spacing';
import { useTechniqueIdParam } from '@/utils/techniqueParams';

/**
 * Retired mock scoring screen.
 * Kept as an isolated legacy route so old bookmarks do not show fake scores.
 */
export function ResultsScreen() {
  const techniqueId = useTechniqueIdParam();
  const technique = techniqueId ? getTechniqueById(techniqueId) : undefined;

  if (!techniqueId || !technique) {
    return <TechniqueNotFound techniqueId={techniqueId} />;
  }

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="caption" tone="muted">
          Experimental / legacy
        </AppText>
        <AppText variant="title">Mock results retired</AppText>
        <AppText variant="body" tone="muted">
          This screen previously showed placeholder scores. It is not a technique result. Use a
          recorded technique with Computer Vision Comparison or Detailed AI Analysis.
        </AppText>
      </View>
      <Card>
        <AppText variant="body" tone="muted">
          {technique.name} is a built-in catalog entry. Comparison uses a recorded human
          reference, not this legacy mock path.
        </AppText>
      </Card>
      <View style={styles.actions}>
        <Button label="Back to Techniques" onPress={() => router.replace('/techniques')} />
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
    marginTop: spacing.sm,
  },
});
