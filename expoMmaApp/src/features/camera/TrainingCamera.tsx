import {
  forwardRef,
  useImperativeHandle,
  useRef,
  type ForwardedRef,
} from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { CameraView } from 'expo-camera';

import { AppText } from '@/components/AppText';
import { useAppTheme } from '@/theme/useAppTheme';

export type TrainingCameraHandle = {
  startMutedRecording: (maxDurationSeconds: number) => Promise<string>;
  stopRecording: () => void;
};

type TrainingCameraProps = {
  onReadyChange?: (ready: boolean) => void;
  onMountError?: (message: string) => void;
};

async function recordMutedVideo(
  camera: CameraView,
  maxDurationSeconds: number,
): Promise<string> {
  const fallbackStop = setTimeout(() => {
    camera.stopRecording();
  }, maxDurationSeconds * 1000 + 400);

  try {
    const result = await camera.recordAsync({
      maxDuration: maxDurationSeconds,
    });

    if (!result?.uri) {
      throw new Error('Recording finished without a video file.');
    }

    return result.uri;
  } finally {
    clearTimeout(fallbackStop);
  }
}

export const TrainingCamera = forwardRef(function TrainingCamera(
  { onReadyChange, onMountError }: TrainingCameraProps,
  ref: ForwardedRef<TrainingCameraHandle>,
) {
  const theme = useAppTheme();
  const cameraRef = useRef<CameraView>(null);
  const recordingLock = useRef(false);
  const readyRef = useRef(false);

  useImperativeHandle(ref, () => ({
    async startMutedRecording(maxDurationSeconds: number) {
      if (Platform.OS === 'web') {
        throw new Error('Video recording is not available in the web preview.');
      }

      const camera = cameraRef.current;
      if (!camera || !readyRef.current) {
        throw new Error('Camera is not ready yet.');
      }

      if (recordingLock.current) {
        throw new Error('A recording is already in progress.');
      }

      recordingLock.current = true;
      try {
        return await recordMutedVideo(camera, maxDurationSeconds);
      } finally {
        recordingLock.current = false;
      }
    },
    stopRecording() {
      try {
        cameraRef.current?.stopRecording();
      } catch (error) {
        console.warn('[TrainingCamera] stopRecording failed', error);
      }
    },
  }));

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.fill, styles.center, { backgroundColor: theme.surfaceMuted }]}>
        <AppText variant="body" tone="muted">
          Live camera recording is available on Android and iOS.
        </AppText>
      </View>
    );
  }

  return (
    <CameraView
      ref={cameraRef}
      style={styles.fill}
      facing="front"
      mode="video"
      mute
      mirror
      onCameraReady={() => {
        readyRef.current = true;
        onReadyChange?.(true);
      }}
      onMountError={(event) => {
        const message = event.message || 'Camera failed to start.';
        console.warn('[TrainingCamera] mount error', message);
        readyRef.current = false;
        onReadyChange?.(false);
        onMountError?.(message);
      }}
    />
  );
});

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
});
