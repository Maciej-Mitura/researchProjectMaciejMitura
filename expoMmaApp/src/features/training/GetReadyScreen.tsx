import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { MediaFrame } from '@/components/MediaFrame';
import { Screen } from '@/components/Screen';
import { CameraPlaceholder } from '@/features/camera/CameraPlaceholder';
import { PRACTICE_COMPACT_NOTICE } from '@/features/privacy/copy';
import { shouldShowCompactRecordingNotice } from '@/features/privacy/gates';
import { PrivacyNotice } from '@/features/privacy/PrivacyNotice';
import { usePrivacyAcknowledgements } from '@/features/privacy/PrivacyAcknowledgementsContext';
import { ReferenceVideoPlayer } from '@/features/reference/ReferenceVideoPlayer';
import { TechniqueNotFound } from '@/features/techniques/TechniqueNotFound';
import { techniqueSupportsGenericComparison } from '@/features/techniques/catalog';
import { useTechniqueLibrary } from '@/features/techniques/TechniqueLibraryContext';
import { captureConfigForTechnique } from '@/features/training/config';
import { CAMERA_MEDIA_ASPECT_RATIO } from '@/features/training/constants';
import { spacing } from '@/theme/spacing';
import { getValidationSession } from '@/features/validation/session';
import { scenarioDisplayLabel } from '@/features/validation/presentation';
import { privacyHref } from '@/utils/routes';
import { useTechniqueIdParam } from '@/utils/techniqueParams';

const POSITIONING_TIPS = [
  'Stand far enough back so your full body is visible.',
  'Leave space around you for the punch or kick.',
  'Keep the phone stable and at chest-to-head height.',
];

const GENERIC_POSITIONING_TIPS = [
  'Watch the reference video first.',
  'Start in the same initial stance as the reference.',
  'Stand far enough back so your full body is visible.',
  'Keep the phone stable and at chest-to-head height.',
];

export function GetReadyScreen() {
  const techniqueId = useTechniqueIdParam();
  const { getById, loading } = useTechniqueLibrary();
  const technique = techniqueId ? getById(techniqueId) : undefined;
  const privacy = usePrivacyAcknowledgements();

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

  const generic = techniqueSupportsGenericComparison(technique);
  const tips = generic ? GENERIC_POSITIONING_TIPS : POSITIONING_TIPS;
  const practiceDurationSeconds = captureConfigForTechnique(technique).maxDurationSeconds;
  const validation = getValidationSession();
  const validationActive = validation?.techniqueId === technique.id;

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="caption" tone="accent">
          {validationActive ? 'RESEARCH VALIDATION' : 'GET READY'}
        </AppText>
        <AppText variant="title">{technique.name}</AppText>
        {validationActive && validation ? (
          <AppText variant="bodyStrong">{scenarioDisplayLabel(validation.scenarioType)}</AppText>
        ) : null}
        <AppText variant="body" tone="muted">
          {generic
            ? 'Watch the reference, then stand so the camera sees your full body.'
            : 'This built-in catalog technique has no recorded human reference. Add your own technique to practice and compare.'}
        </AppText>
      </View>

      {generic ? (
        <ReferenceVideoPlayer slug={technique.slug} />
      ) : (
        <MediaFrame aspectRatio={CAMERA_MEDIA_ASPECT_RATIO}>
          <CameraPlaceholder label="Body position guide" />
        </MediaFrame>
      )}

      <Card>
        {tips.map((tip) => (
          <AppText key={tip} variant="body">
            {`•  ${tip}`}
          </AppText>
        ))}
      </Card>

      {generic ? (
        <AppText variant="body" tone="muted">
          {`Your attempt will record for ${practiceDurationSeconds}s to match this reference.`}
        </AppText>
      ) : null}

      {privacy.ready && shouldShowCompactRecordingNotice(privacy.acknowledgements) ? (
        <PrivacyNotice title="Practice recording" body={PRACTICE_COMPACT_NOTICE} />
      ) : (
        <AppText variant="body" tone="muted">
          Before the first recording, you will be asked to review camera and movement data
          information.
        </AppText>
      )}

      {generic ? (
        <Button
          label="Continue"
          onPress={() =>
            router.push({
              pathname: '/training/[techniqueId]',
              params: { techniqueId: technique.id },
            })
          }
        />
      ) : (
        <Button
          label="Back to Technique"
          onPress={() =>
            router.replace({
              pathname: '/technique/[techniqueId]',
              params: { techniqueId: technique.id },
            })
          }
        />
      )}
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
