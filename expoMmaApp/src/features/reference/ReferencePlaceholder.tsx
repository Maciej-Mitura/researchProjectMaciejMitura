import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { spacing } from '@/theme/spacing';
import { useAppTheme } from '@/theme/useAppTheme';

type ReferencePlaceholderProps = {
  techniqueName: string;
};

/** Built-in catalog techniques have no recorded human reference in V2. */
export function ReferencePlaceholder({ techniqueName }: ReferencePlaceholderProps) {
  const theme = useAppTheme();

  return (
    <View
      style={[
        styles.box,
        {
          backgroundColor: theme.surfaceMuted,
        },
      ]}>
      <AppText variant="caption" tone="muted">
        Catalog technique
      </AppText>
      <AppText variant="subtitle">{techniqueName}</AppText>
      <AppText variant="body" tone="muted">
        No recorded human reference
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
});
