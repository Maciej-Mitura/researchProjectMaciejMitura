import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import type { Technique } from '@/features/techniques/types';
import { useTechniqueLibrary } from '@/features/techniques/TechniqueLibraryContext';
import { addTechniqueHref, privacyHref } from '@/utils/routes';
import { radii } from '@/theme/radii';
import { spacing } from '@/theme/spacing';
import { useAppTheme } from '@/theme/useAppTheme';

function categoryLabel(category: Technique['category']): string {
  switch (category) {
    case 'punch':
      return 'Punch';
    case 'kick':
      return 'Kick';
    case 'defense':
      return 'Defense';
    case 'grappling':
      return 'Grappling';
    case 'other':
      return 'Recorded';
  }
}

function sourceLabel(technique: Technique): string {
  return technique.source === 'recorded' ? 'Recorded reference' : 'Built-in catalog';
}

function referenceStatusLabel(technique: Technique): string {
  if (technique.source === 'recorded' && technique.referenceStatus === 'available') {
    return 'Reference saved';
  }
  if (technique.source === 'builtin') {
    return 'No recorded human reference';
  }
  return 'Reference not recorded';
}

export function TechniqueSelectionScreen() {
  const { techniques, libraryWarning, libraryNotice } = useTechniqueLibrary();
  const theme = useAppTheme();
  const builtins = techniques.filter((technique) => technique.source === 'builtin');
  const recorded = techniques.filter((technique) => technique.source === 'recorded');

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="title">Choose a technique</AppText>
        <AppText variant="body" tone="muted">
          Practice against a recorded human reference. Built-in catalog entries are descriptions
          only — they are not comparison references.
        </AppText>
      </View>

      {libraryWarning ? (
        <AppText variant="body" tone="warning">
          {libraryWarning}
        </AppText>
      ) : null}

      {libraryNotice ? (
        <AppText variant="body" tone="success">
          {libraryNotice}
        </AppText>
      ) : null}

      <Button label="Add Technique" onPress={() => router.push(addTechniqueHref)} />

      <View style={styles.section}>
        <AppText variant="caption">Your recorded techniques</AppText>
        {recorded.length === 0 ? (
          <Card>
            <AppText variant="subtitle">No recorded techniques yet</AppText>
            <AppText variant="body" tone="muted">
              Add a technique, record one clean reference, then practice and compare against that
              saved movement.
            </AppText>
          </Card>
        ) : (
          recorded.map((technique) => (
            <TechniqueCard key={technique.id} technique={technique} theme={theme} />
          ))
        )}
      </View>

      <View style={styles.section}>
        <AppText variant="caption">Built-in catalog</AppText>
        {builtins.map((technique) => (
          <TechniqueCard key={technique.id} technique={technique} theme={theme} />
        ))}
      </View>

      <Button label="Back home" variant="ghost" onPress={() => router.replace('/')} />
      <Button
        label="Privacy & Data"
        variant="ghost"
        accessibilityLabel="Open Privacy and Data information"
        onPress={() => router.push(privacyHref)}
      />
    </Screen>
  );
}

function TechniqueCard({
  technique,
  theme,
}: {
  technique: Technique;
  theme: ReturnType<typeof useAppTheme>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${technique.name}. ${sourceLabel(technique)}.`}
      onPress={() =>
        router.push({
          pathname: '/technique/[techniqueId]',
          params: { techniqueId: technique.id },
        })
      }>
      <Card>
        <AppText variant="caption" tone="accent">
          {categoryLabel(technique.category)}
        </AppText>
        <AppText variant="subtitle">{technique.name}</AppText>
        <AppText variant="body" tone="muted">
          {technique.description || 'No description.'}
        </AppText>
        <View style={styles.metaRow}>
          <View style={[styles.chip, { backgroundColor: theme.surfaceMuted }]}>
            <AppText variant="caption">{sourceLabel(technique)}</AppText>
          </View>
          <View style={[styles.chip, { backgroundColor: theme.surfaceMuted }]}>
            <AppText variant="caption">{referenceStatusLabel(technique)}</AppText>
          </View>
          {technique.leadSide ? (
            <View style={[styles.chip, { backgroundColor: theme.surfaceMuted }]}>
              <AppText variant="caption">Lead {technique.leadSide}</AppText>
            </View>
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  section: {
    gap: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
});
