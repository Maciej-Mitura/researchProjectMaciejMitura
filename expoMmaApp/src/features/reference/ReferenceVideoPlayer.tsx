import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

import { AppText } from '@/components/AppText';
import { MediaFrame } from '@/components/MediaFrame';
import { recordedReferenceVideoUrl } from '@/features/comparison/api/analyzeGenericAttempt';
import { REFERENCE_MEDIA_ASPECT_RATIO } from '@/features/training/constants';
import { spacing } from '@/theme/spacing';
import { useAppTheme } from '@/theme/useAppTheme';

type ReferenceVideoPlayerProps = {
  slug: string;
};

export function ReferenceVideoPlayer({ slug }: ReferenceVideoPlayerProps) {
  const uri = useMemo(() => {
    try {
      return recordedReferenceVideoUrl(slug);
    } catch {
      return null;
    }
  }, [slug]);

  return (
    <View style={styles.wrap}>
      <AppText variant="caption" tone="muted">
        Reference Technique
      </AppText>
      {uri ? <RemoteReferencePlayer uri={uri} /> : <ReferenceVideoUnavailable />}
      <AppText variant="body" tone="muted">
        Watch the movement before practising.
      </AppText>
    </View>
  );
}

function RemoteReferencePlayer({ uri }: { uri: string }) {
  const theme = useAppTheme();
  const [error, setError] = useState<string | null>(null);
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
  });

  useEffect(() => {
    const subscription = player.addListener('statusChange', (payload) => {
      if (payload.status === 'error') {
        const message = 'The reference video could not be loaded.';
        console.warn('[ReferenceVideoPlayer] player error', payload.error);
        setError(message);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [player]);

  return (
    <MediaFrame aspectRatio={REFERENCE_MEDIA_ASPECT_RATIO}>
      {error ? (
        <View style={[styles.center, { backgroundColor: theme.surfaceMuted }]}>
          <AppText variant="body" tone="warning">
            The reference video could not be loaded. Check that the analysis server is running.
          </AppText>
        </View>
      ) : (
        <VideoView player={player} style={styles.fill} contentFit="contain" nativeControls />
      )}
    </MediaFrame>
  );
}

function ReferenceVideoUnavailable() {
  const theme = useAppTheme();
  return (
    <MediaFrame aspectRatio={REFERENCE_MEDIA_ASPECT_RATIO}>
      <View style={[styles.center, { backgroundColor: theme.surfaceMuted }]}>
        <AppText variant="body" tone="warning">
          The reference video could not be loaded. Check that the analysis server is running.
        </AppText>
      </View>
    </MediaFrame>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  fill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
});
