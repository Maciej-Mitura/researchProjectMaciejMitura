import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { TechniqueNotFound } from '@/features/techniques/TechniqueNotFound';
import { isBuiltinCatalogTechnique } from '@/features/techniques/catalog';
import { useTechniqueLibrary } from '@/features/techniques/TechniqueLibraryContext';
import { addTechniqueHref } from '@/utils/routes';
import { spacing } from '@/theme/spacing';
import { useTechniqueIdParam } from '@/utils/techniqueParams';

export function ComparisonPlaceholderScreen() {
  const techniqueId = useTechniqueIdParam();
  const { getById, loading } = useTechniqueLibrary();
  const technique = techniqueId ? getById(techniqueId) : undefined;

  if (loading && !technique) {
    return (
      <Screen>
        <AppText variant="body" tone="muted">
          Loading technique…
        </AppText>
      </Screen>
    );
  }

  if (!techniqueId || !technique) {
    return <TechniqueNotFound techniqueId={techniqueId} />;
  }

  const builtin = isBuiltinCatalogTechnique(technique);

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="caption" tone="accent">
          {builtin ? 'Built-in catalog' : 'Practice'}
        </AppText>
        <AppText variant="title">{technique.name}</AppText>
      </View>
      <Card>
        <AppText variant="subtitle">
          {builtin ? 'No recorded human reference' : 'Comparison is not available'}
        </AppText>
        <AppText variant="body" tone="muted">
          {builtin
            ? 'Built-in catalog techniques are not used as comparison references. Record your own technique to practice against a saved human performance.'
            : 'This technique cannot be compared until a recorded reference is saved.'}
        </AppText>
      </Card>
      {builtin ? (
        <Button label="Add Technique" onPress={() => router.push(addTechniqueHref)} />
      ) : null}
      <Button
        label="Back to technique"
        variant={builtin ? 'secondary' : 'primary'}
        onPress={() =>
          router.replace({
            pathname: '/technique/[techniqueId]',
            params: { techniqueId: technique.id },
          })
        }
      />
      <Button label="Back to techniques" variant="ghost" onPress={() => router.replace('/techniques')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm,
  },
});
