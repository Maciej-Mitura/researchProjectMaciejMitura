import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { spacing } from '@/theme/spacing';

type StatProps = {
  label: string;
  value: string;
  large?: boolean;
};

export function Stat({ label, value, large = false }: StatProps) {
  return (
    <View style={styles.wrap}>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <AppText variant={large ? 'stat' : 'title'}>{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.xs,
  },
});
