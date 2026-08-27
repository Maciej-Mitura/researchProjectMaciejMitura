import { useCallback, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { MediaFrame } from '@/components/MediaFrame';
import { Screen } from '@/components/Screen';
import { CameraPermissionGate } from '@/features/camera/CameraPermissionGate';
import {
  TrainingCamera,
  type TrainingCameraHandle,
} from '@/features/camera/TrainingCamera';
import { useCameraPermission } from '@/features/camera/useCameraPermission';
import { CameraPrivacyDisclosure } from '@/features/privacy/CameraPrivacyDisclosure';
import { REFERENCE_COMPACT_NOTICE } from '@/features/privacy/copy';
import { shouldMountCameraPreview, shouldShowCameraDisclosure } from '@/features/privacy/gates';
import { PrivacyNotice } from '@/features/privacy/PrivacyNotice';
import { usePrivacyAcknowledgements } from '@/features/privacy/PrivacyAcknowledgementsContext';
import { getReferenceCapture, setReferenceVideoUri } from '@/features/reference/captureSession';
import { REFERENCE_GUIDANCE } from '@/features/reference/constants';
import { useReferenceRecordingSession } from '@/features/reference/useReferenceRecordingSession';
import { CAMERA_MEDIA_ASPECT_RATIO, GENERIC_ATTEMPT_DURATION_DEFAULT_SECONDS } from '@/features/training/constants';
import { addTechniqueHref, privacyHref, reviewReferenceHref } from '@/utils/routes';
import { radii } from '@/theme/radii';
import { spacing } from '@/theme/spacing';
import { useAppTheme } from '@/theme/useAppTheme';

export function RecordReferenceScreen() {
  const capture = getReferenceCapture();
  const theme = useAppTheme();
  const cameraRef = useRef<TrainingCameraHandle>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [mountError, setMountError] = useState<string | null>(null);
  const { state: permissionState, requestPermission, openSettings } = useCameraPermission();
  const privacy = usePrivacyAcknowledgements();

  const onRecorded = useCallback((videoUri: string) => {
    setReferenceVideoUri(videoUri);
    router.replace(reviewReferenceHref);
  }, []);

  const durationSeconds =
    capture?.recordingDurationSeconds ?? GENERIC_ATTEMPT_DURATION_DEFAULT_SECONDS;

  const getRecorder = useCallback(() => cameraRef.current, []);
  const { phase, countdownLabel, lastError, startCountdown, maxDurationLabel } =
    useReferenceRecordingSession({
      getRecorder,
      onRecorded,
      maxDurationSeconds: durationSeconds,
    });

  if (!capture) {
    return (
      <Screen>
        <AppText variant="title">No technique started</AppText>
        <AppText variant="body" tone="muted">
          Enter a name before recording a reference.
        </AppText>
        <Button label="Back" onPress={() => router.replace(addTechniqueHref)} />
      </Screen>
    );
  }

  if (!privacy.ready) {
    return (
      <Screen>
        <AppText variant="body" tone="muted">
          Loading privacy information…
        </AppText>
      </Screen>
    );
  }

  if (shouldShowCameraDisclosure(privacy.acknowledgements)) {
    return (
      <CameraPrivacyDisclosure
        variant="reference"
        onCancel={() => router.back()}
        onContinue={() => {
          void privacy.acknowledgeCameraPrivacy();
        }}
      />
    );
  }

  const cameraAllowed = shouldMountCameraPreview(privacy.acknowledgements);
  const showLiveCamera =
    cameraAllowed &&
    permissionState === 'granted' &&
    (phase === 'idle' || phase === 'countdown' || phase === 'recording');
  const canStart =
    cameraAllowed &&
    permissionState === 'granted' &&
    cameraReady &&
    phase === 'idle' &&
    Platform.OS !== 'web';

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="caption" tone="accent">
          Record reference
        </AppText>
        <AppText variant="title">{capture.name}</AppText>
        <AppText variant="body" tone="muted">
          Muted front-camera clip, {maxDurationLabel}. Recording stops automatically.
        </AppText>
      </View>

      <PrivacyNotice title="Reference storage" body={REFERENCE_COMPACT_NOTICE} />

      {lastError ? (
        <AppText variant="body" tone="warning">
          {lastError}
        </AppText>
      ) : null}
      {mountError ? (
        <AppText variant="body" tone="warning">
          {mountError}
        </AppText>
      ) : null}

      <Card>
        {REFERENCE_GUIDANCE.map((tip) => (
          <AppText key={tip} variant="body">
            {`•  ${tip}`}
          </AppText>
        ))}
      </Card>

      {permissionState === 'granted' ? (
        <MediaFrame aspectRatio={CAMERA_MEDIA_ASPECT_RATIO}>
          {showLiveCamera ? (
            <>
              <TrainingCamera
                ref={cameraRef}
                onReadyChange={setCameraReady}
                onMountError={setMountError}
              />
              {countdownLabel ? (
                <View style={[styles.overlay, { backgroundColor: theme.overlay }]}>
                  <AppText variant="stat">{countdownLabel}</AppText>
                </View>
              ) : null}
              {phase === 'recording' ? (
                <View style={[styles.recordingBadge, { backgroundColor: theme.accent }]}>
                  <AppText variant="caption" style={{ color: theme.accentText }}>
                    Recording {maxDurationLabel}
                  </AppText>
                </View>
              ) : null}
            </>
          ) : null}
        </MediaFrame>
      ) : (
        <CameraPermissionGate
          state={permissionState}
          onRequestPermission={() => {
            void requestPermission();
          }}
          onOpenSettings={openSettings}
        />
      )}

      {Platform.OS === 'web' ? (
        <AppText variant="body" tone="muted">
          Recording is supported on a real Android or iOS device, not in the web preview.
        </AppText>
      ) : null}

      <Button
        label={
          phase === 'recording'
            ? 'Recording…'
            : phase === 'countdown'
              ? 'Starting…'
              : 'Start Reference Recording'
        }
        disabled={!canStart}
        onPress={startCountdown}
      />
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
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingBadge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
});
