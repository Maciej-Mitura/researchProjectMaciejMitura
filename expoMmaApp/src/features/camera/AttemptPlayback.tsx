import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

import { AppText } from '@/components/AppText';
import { useAppTheme } from '@/theme/useAppTheme';

type AttemptPlaybackProps = {
  uri: string;
};

export function AttemptPlayback({ uri }: AttemptPlaybackProps) {
  const theme = useAppTheme();
  const [error, setError] = useState<string | null>(null);
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
  });

  useEffect(() => {
    const subscription = player.addListener('statusChange', (payload) => {
      if (payload.status === 'error') {
        const message = payload.error?.message ?? 'The recorded clip could not be played.';
        console.warn('[AttemptPlayback] player error', payload.error);
        setError(message);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [player]);

  if (error) {
    return (
      <View style={[styles.fill, styles.center, { backgroundColor: theme.surfaceMuted }]}>
        <AppText variant="body" tone="warning">
          This recording could not be played. Retry the attempt.
        </AppText>
      </View>
    );
  }

  return (
    <VideoView
      player={player}
      style={styles.fill}
      contentFit="contain"
      nativeControls
    />
  );
}

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
