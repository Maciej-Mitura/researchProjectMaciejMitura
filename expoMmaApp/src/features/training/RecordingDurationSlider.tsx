import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import {
  GENERIC_ATTEMPT_DURATION_MAX_SECONDS,
  GENERIC_ATTEMPT_DURATION_MIN_SECONDS,
} from '@/features/training/constants';
import { radii } from '@/theme/radii';
import { spacing } from '@/theme/spacing';
import { useAppTheme } from '@/theme/useAppTheme';

type RecordingDurationSliderProps = {
  value: number;
  onChange: (seconds: number) => void;
  disabled?: boolean;
};

function clampDuration(seconds: number): number {
  return Math.min(
    GENERIC_ATTEMPT_DURATION_MAX_SECONDS,
    Math.max(GENERIC_ATTEMPT_DURATION_MIN_SECONDS, Math.round(seconds)),
  );
}

export function RecordingDurationSlider({
  value,
  onChange,
  disabled = false,
}: RecordingDurationSliderProps) {
  const theme = useAppTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const duration = clampDuration(value);
  const range = GENERIC_ATTEMPT_DURATION_MAX_SECONDS - GENERIC_ATTEMPT_DURATION_MIN_SECONDS;
  const progress = (duration - GENERIC_ATTEMPT_DURATION_MIN_SECONDS) / range;

  const padding = 11;

  const setFromLocationX = (locationX: number) => {
    if (disabled || trackWidth <= 0) {
      return;
    }
    const usable = Math.max(1, trackWidth - padding * 2);
    const ratio = Math.min(1, Math.max(0, (locationX - padding) / usable));
    onChange(clampDuration(GENERIC_ATTEMPT_DURATION_MIN_SECONDS + ratio * range));
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <AppText variant="caption" tone="muted">
          Recording length
        </AppText>
        <AppText variant="bodyStrong">{`${duration}s`}</AppText>
      </View>
      <AppText variant="body" tone="muted">
        Drag to set recording length. Default is 3 seconds.
      </AppText>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Recording length in seconds"
        accessibilityValue={{
          min: GENERIC_ATTEMPT_DURATION_MIN_SECONDS,
          max: GENERIC_ATTEMPT_DURATION_MAX_SECONDS,
          now: duration,
          text: `${duration} seconds`,
        }}
        accessibilityState={{ disabled }}
        onAccessibilityAction={(event) => {
          if (disabled) {
            return;
          }
          if (event.nativeEvent.actionName === 'increment') {
            onChange(clampDuration(duration + 1));
          }
          if (event.nativeEvent.actionName === 'decrement') {
            onChange(clampDuration(duration - 1));
          }
        }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => !disabled}
        onMoveShouldSetResponder={() => !disabled}
        onResponderGrant={(event) => setFromLocationX(event.nativeEvent.locationX)}
        onResponderMove={(event) => setFromLocationX(event.nativeEvent.locationX)}
        style={[styles.trackHit, { opacity: disabled ? 0.45 : 1 }]}>
        <View style={[styles.track, { backgroundColor: theme.surfaceMuted }]}>
          <View
            style={[
              styles.fill,
              {
                width: `${progress * 100}%`,
                backgroundColor: theme.accent,
              },
            ]}
          />
          <View
            pointerEvents="none"
            style={[
              styles.thumb,
              {
                left: `${progress * 100}%`,
                backgroundColor: theme.accent,
                borderColor: theme.accentText,
              },
            ]}
          />
        </View>
      </View>
      <View style={styles.rangeRow}>
        <AppText variant="caption" tone="muted">
          {`${GENERIC_ATTEMPT_DURATION_MIN_SECONDS}s`}
        </AppText>
        <AppText variant="caption" tone="muted">
          {`${GENERIC_ATTEMPT_DURATION_MAX_SECONDS}s`}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  trackHit: {
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: 11,
  },
  track: {
    height: 8,
    borderRadius: radii.pill,
    justifyContent: 'center',
  },
  fill: {
    height: 8,
    borderRadius: radii.pill,
  },
  thumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    marginLeft: -11,
    borderRadius: radii.pill,
    borderWidth: 2,
  },
  rangeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
