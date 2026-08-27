import { type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { spacing } from '@/theme/spacing';
import { useAppTheme } from '@/theme/useAppTheme';

type ScreenProps = {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  style?: ViewStyle;
};

export function Screen({
  children,
  scroll = true,
  padded = true,
  style,
}: ScreenProps) {
  const theme = useAppTheme();
  const contentStyle = [
    styles.content,
    padded ? styles.padded : undefined,
    { backgroundColor: theme.background },
    style,
  ];

  if (!scroll) {
    return (
      <SafeAreaView edges={['bottom']} style={[styles.flex, { backgroundColor: theme.background }]}>
        <View style={[styles.flex, contentStyle]}>{children}</View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['bottom']} style={[styles.flex, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={contentStyle}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    gap: spacing.lg,
  },
  padded: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
});
