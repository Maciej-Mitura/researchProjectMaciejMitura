import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { radii } from '@/theme/radii';
import { spacing } from '@/theme/spacing';
import { useAppTheme } from '@/theme/useAppTheme';

type CameraPlaceholderProps = {
  label?: string;
};

/** Positioning illustration only. Live camera exists on the Training screen. */
export function CameraPlaceholder({ label = 'Camera preview' }: CameraPlaceholderProps) {
  const theme = useAppTheme();

  return (
    <View style={[styles.box, { backgroundColor: theme.surfaceMuted }]}>
      <View style={[styles.figureHead, { borderColor: theme.textMuted }]} />
      <View style={[styles.figureBody, { backgroundColor: theme.textMuted }]} />
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  figureHead: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
  },
  figureBody: {
    width: 18,
    height: 72,
    borderRadius: radii.sm,
    opacity: 0.7,
  },
});
