import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import {
  CAMERA_DISCLOSURE_INTRO,
  CAMERA_DISCLOSURE_POINTS,
  CAMERA_DISCLOSURE_TITLE,
  CANCEL_CAMERA_LABEL,
  CONTINUE_CAMERA_LABEL,
  PRACTICE_STORAGE_POINTS,
  PRACTICE_STORAGE_TITLE,
  REFERENCE_DELETION_SENTENCE,
  REFERENCE_STORAGE_POINTS,
  REFERENCE_STORAGE_TITLE,
} from '@/features/privacy/copy';
import type { CameraDisclosureVariant } from '@/features/privacy/gates';
import { spacing } from '@/theme/spacing';

type CameraPrivacyDisclosureProps = {
  variant: CameraDisclosureVariant;
  onCancel: () => void;
  onContinue: () => void;
};

export function CameraPrivacyDisclosure({
  variant,
  onCancel,
  onContinue,
}: CameraPrivacyDisclosureProps) {
  const extraTitle = variant === 'reference' ? REFERENCE_STORAGE_TITLE : PRACTICE_STORAGE_TITLE;
  const extraPoints = variant === 'reference' ? REFERENCE_STORAGE_POINTS : PRACTICE_STORAGE_POINTS;

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="caption" tone="accent">
          Privacy information
        </AppText>
        <AppText variant="title">{CAMERA_DISCLOSURE_TITLE}</AppText>
        <AppText variant="body" tone="muted">
          {CAMERA_DISCLOSURE_INTRO}
        </AppText>
      </View>

      <Card>
        {CAMERA_DISCLOSURE_POINTS.map((point) => (
          <AppText key={point} variant="body">
            {`•  ${point}`}
          </AppText>
        ))}
      </Card>

      <Card>
        <AppText variant="caption" tone="accent">
          {extraTitle}
        </AppText>
        {extraPoints.map((point) => (
          <AppText key={point} variant="body">
            {`•  ${point}`}
          </AppText>
        ))}
        {variant === 'reference' ? (
          <AppText variant="bodyStrong">{REFERENCE_DELETION_SENTENCE}</AppText>
        ) : null}
      </Card>

      <View style={styles.actions}>
        <Button
          label={CONTINUE_CAMERA_LABEL}
          accessibilityLabel="I understand, continue with camera recording"
          onPress={onContinue}
        />
        <Button
          label={CANCEL_CAMERA_LABEL}
          variant="ghost"
          accessibilityLabel="Cancel camera privacy disclosure"
          onPress={onCancel}
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
