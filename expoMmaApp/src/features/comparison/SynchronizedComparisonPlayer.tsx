import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

import { AppText } from '@/components/AppText';
import { MediaFrame } from '@/components/MediaFrame';
import { COMPARISON_PLAYBACK_RATES, type ComparisonPlaybackRate } from '@/features/comparison/types';
import { radii } from '@/theme/radii';
import { spacing } from '@/theme/spacing';
import { useAppTheme } from '@/theme/useAppTheme';

export const COMPARISON_VIDEO_ASPECT_RATIO = 9 / 8;

type SynchronizedComparisonPlayerProps = {
  uri: string;
  poseUri?: string | null;
  poseAvailable?: boolean;
};

export function SynchronizedComparisonPlayer({
  uri,
  poseUri,
  poseAvailable: _poseAvailable = true,
}: SynchronizedComparisonPlayerProps) {
  const [showPose, setShowPose] = useState(false);
  const overlayReady = Boolean(poseUri);
  const activeUri = showPose && poseUri ? poseUri : uri;

  return (
    <View style={styles.wrap}>
      <ComparisonVideo key={activeUri} uri={activeUri} />
      {overlayReady ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowPose((value) => !value)}
          style={styles.poseToggle}>
          <AppText variant="bodyStrong" tone="accent">
            {showPose ? 'Hide pose' : 'Show pose'}
          </AppText>
        </Pressable>
      ) : (
        <AppText variant="body" tone="muted">
          Pose overlay unavailable
        </AppText>
      )}
    </View>
  );
}

function ComparisonVideo({ uri }: { uri: string }) {
  const theme = useAppTheme();
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState<ComparisonPlaybackRate>(1);
  const [barWidth, setBarWidth] = useState(1);

  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    instance.muted = true;
    instance.timeUpdateEventInterval = 0.1;
    instance.playbackRate = 1;
  });

  useEffect(() => {
    const status = player.addListener('statusChange', (payload) => {
      if (payload.status === 'error') {
        setError('The comparison video could not be played.');
      }
      if (payload.status === 'readyToPlay') {
        setDuration(player.duration);
      }
    });
    const playingChange = player.addListener('playingChange', (payload) => {
      setPlaying(payload.isPlaying);
    });
    const time = player.addListener('timeUpdate', (payload) => {
      setCurrentTime(payload.currentTime);
      if (player.duration > 0) {
        setDuration(player.duration);
      }
    });
    const ended = player.addListener('playToEnd', () => {
      setPlaying(false);
    });
    return () => {
      status.remove();
      playingChange.remove();
      time.remove();
      ended.remove();
    };
  }, [player]);

  const progress = useMemo(() => {
    if (duration <= 0) {
      return 0;
    }
    return Math.min(1, Math.max(0, currentTime / duration));
  }, [currentTime, duration]);

  const seekToRatio = (ratio: number) => {
    if (duration <= 0) {
      return;
    }
    const target = Math.min(duration, Math.max(0, ratio * duration));
    player.seekBy(target - player.currentTime);
  };

  if (error) {
    return (
      <MediaFrame aspectRatio={COMPARISON_VIDEO_ASPECT_RATIO}>
        <View style={[styles.center, { backgroundColor: theme.surfaceMuted }]}>
          <AppText variant="body" tone="warning">
            The comparison video could not be played.
          </AppText>
        </View>
      </MediaFrame>
    );
  }

  return (
    <View style={styles.playerBlock}>
      <MediaFrame aspectRatio={COMPARISON_VIDEO_ASPECT_RATIO}>
        <VideoView player={player} style={styles.fill} contentFit="contain" nativeControls={false} />
      </MediaFrame>

      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel="Seek comparison video"
        onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
        onPress={(event) => seekToRatio(event.nativeEvent.locationX / Math.max(1, barWidth))}
        style={[styles.seekTrack, { backgroundColor: theme.surfaceMuted }]}>
        <View
          style={[
            styles.seekFill,
            { width: `${progress * 100}%`, backgroundColor: theme.accent },
          ]}
        />
      </Pressable>

      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (playing) {
              player.pause();
            } else {
              if (duration > 0 && currentTime >= duration - 0.05) {
                player.seekBy(-player.currentTime);
              }
              player.play();
            }
          }}
          style={[styles.controlButton, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
          <AppText variant="bodyStrong">{playing ? 'Pause' : 'Play'}</AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            player.seekBy(-player.currentTime);
            player.play();
          }}
          style={[styles.controlButton, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
          <AppText variant="bodyStrong">Replay</AppText>
        </Pressable>
      </View>

      <View style={styles.speeds}>
        {COMPARISON_PLAYBACK_RATES.map((value) => {
          const selected = rate === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              onPress={() => {
                setRate(value);
                player.playbackRate = value;
              }}
              style={[
                styles.speedChip,
                {
                  backgroundColor: selected ? theme.accent : theme.surfaceMuted,
                  borderColor: theme.border,
                },
              ]}>
              <AppText
                variant="caption"
                style={selected ? { color: theme.accentText } : undefined}>
                {formatRate(value)}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function formatRate(value: ComparisonPlaybackRate): string {
  if (value === 1) {
    return '1×';
  }
  return `${value}×`;
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
  },
  playerBlock: {
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
  poseToggle: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },
  seekTrack: {
    height: 10,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  seekFill: {
    height: '100%',
  },
  controls: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  controlButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speeds: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  speedChip: {
    minHeight: 36,
    minWidth: 56,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
