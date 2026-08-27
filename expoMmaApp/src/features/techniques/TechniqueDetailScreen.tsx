import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { MediaFrame } from '@/components/MediaFrame';
import { Screen } from '@/components/Screen';
import { deleteRecordedTechnique } from '@/features/reference/api/client';
import { ReferenceClientError } from '@/features/reference/api/errors';
import { DELETE_TECHNIQUE_CONFIRMATION } from '@/features/privacy/copy';
import { ReferencePlaceholder } from '@/features/reference/ReferencePlaceholder';
import { ReferenceVideoPlayer } from '@/features/reference/ReferenceVideoPlayer';
import { TechniqueNotFound } from '@/features/techniques/TechniqueNotFound';
import {
  isBuiltinCatalogTechnique,
  techniqueSupportsGenericComparison,
  techniqueSupportsTrainingCapture,
} from '@/features/techniques/catalog';
import { useTechniqueLibrary } from '@/features/techniques/TechniqueLibraryContext';
import { addTechniqueHref, privacyHref } from '@/utils/routes';
import { REFERENCE_MEDIA_ASPECT_RATIO } from '@/features/training/constants';
import { spacing } from '@/theme/spacing';
import { useTechniqueIdParam } from '@/utils/techniqueParams';

export function TechniqueDetailScreen() {
  const techniqueId = useTechniqueIdParam();
  const { getById, loading, refresh, removeRecorded, setLibraryNotice, libraryNotice } =
    useTechniqueLibrary();
  const technique = techniqueId ? getById(techniqueId) : undefined;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  const canTrain = techniqueSupportsTrainingCapture(technique);
  const canReplay = techniqueSupportsGenericComparison(technique);
  const canDelete = technique.source === 'recorded';
  const builtin = isBuiltinCatalogTechnique(technique);
  const recordedSlug = technique.slug;
  const recordedId = technique.id;

  async function confirmDelete() {
    if (!canDelete || deleting) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteRecordedTechnique(recordedSlug);
      removeRecorded(recordedId);
      setLibraryNotice('Technique deleted. Its saved reference was removed.');
      await refresh();
      router.replace('/techniques');
    } catch (error) {
      const message =
        error instanceof ReferenceClientError
          ? error.message
          : 'Could not delete the technique. Please try again.';
      setDeleteError(message);
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="caption" tone="accent">
          {builtin ? 'Built-in catalog' : 'Recorded technique'}
        </AppText>
        <AppText variant="display">{technique.name}</AppText>
        <AppText variant="body" tone="muted">
          {technique.description || 'No description.'}
        </AppText>
        <AppText
          variant="caption"
          tone={technique.referenceStatus === 'available' && canReplay ? 'success' : 'muted'}>
          {canReplay
            ? 'Recorded human reference saved'
            : 'No recorded human reference'}
        </AppText>
      </View>

      {libraryNotice ? (
        <AppText variant="body" tone="success">
          {libraryNotice}
        </AppText>
      ) : null}

      {canReplay ? (
        <ReferenceVideoPlayer slug={technique.slug} />
      ) : (
        <MediaFrame aspectRatio={REFERENCE_MEDIA_ASPECT_RATIO}>
          <ReferencePlaceholder techniqueName={technique.name} />
        </MediaFrame>
      )}

      {canTrain ? (
        <Button
          label="Start Practice"
          onPress={() =>
            router.push({
              pathname: '/get-ready/[techniqueId]',
              params: { techniqueId: technique.id },
            })
          }
        />
      ) : builtin ? (
        <Card>
          <AppText variant="subtitle">Comparison is not available here</AppText>
          <AppText variant="body" tone="muted">
            {technique.id === 'mmakick'
              ? 'MMA Kick is a catalog description only. It has no recorded human reference, so practice comparison is not offered.'
              : 'This built-in catalog entry has no recorded human reference. Add your own technique to practice and compare against a saved recording.'}
          </AppText>
          <Button label="Add Technique" onPress={() => router.push(addTechniqueHref)} />
        </Card>
      ) : (
        <Card>
          <AppText variant="subtitle">Reference not saved</AppText>
          <AppText variant="body" tone="muted">
            This technique cannot be practiced until a recorded reference is saved.
          </AppText>
        </Card>
      )}

      {canDelete ? (
        confirmingDelete ? (
          <Card>
            <AppText variant="subtitle">{`Delete "${technique.name}"?`}</AppText>
            <AppText variant="body" tone="muted">
              {DELETE_TECHNIQUE_CONFIRMATION}
            </AppText>
            <Button
              label="Cancel"
              variant="secondary"
              accessibilityLabel="Cancel technique deletion"
              onPress={() => setConfirmingDelete(false)}
            />
            <Button
              label={deleting ? 'Deleting…' : 'Delete permanently'}
              variant="danger"
              disabled={deleting}
              accessibilityLabel="Delete technique permanently"
              onPress={() => {
                void confirmDelete();
              }}
            />
          </Card>
        ) : (
          <Button
            label="Delete Technique"
            variant="ghost"
            accessibilityLabel="Delete recorded technique"
            onPress={() => {
              setDeleteError(null);
              setConfirmingDelete(true);
            }}
          />
        )
      ) : null}

      {deleteError ? (
        <AppText variant="body" tone="warning">
          {deleteError}
        </AppText>
      ) : null}

      <Button
        label="Privacy & Data"
        variant="ghost"
        accessibilityLabel="Open Privacy and Data information"
        onPress={() => router.push(privacyHref)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm,
  },
});
