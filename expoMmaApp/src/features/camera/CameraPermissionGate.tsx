import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import type { CameraPermissionState } from '@/features/camera/useCameraPermission';
import { spacing } from '@/theme/spacing';

type CameraPermissionGateProps = {
  state: CameraPermissionState;
  onRequestPermission: () => void;
  onOpenSettings: () => void;
};

export function CameraPermissionGate({
  state,
  onRequestPermission,
  onOpenSettings,
}: CameraPermissionGateProps) {
  if (state === 'loading') {
    return (
      <Card>
        <AppText variant="subtitle">Checking camera access</AppText>
        <AppText variant="body" tone="muted">
          Waiting for camera permission status.
        </AppText>
      </Card>
    );
  }

  if (state === 'blocked') {
    return (
      <Card>
        <AppText variant="subtitle">Camera access blocked</AppText>
        <AppText variant="body" tone="muted">
          Camera permission is turned off for MMA Trainer. Enable it in Settings to record an
          attempt.
        </AppText>
        <View style={styles.action}>
          <Button label="Open Settings" onPress={onOpenSettings} />
        </View>
      </Card>
    );
  }

  return (
    <Card>
      <AppText variant="subtitle">Camera permission needed</AppText>
      <AppText variant="body" tone="muted">
        MMA Trainer uses the camera to record your technique for analysis.
      </AppText>
      <View style={styles.action}>
        <Button label="Allow Camera" onPress={onRequestPermission} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  action: {
    marginTop: spacing.sm,
  },
});
