import { Link, Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { spacing } from '@/theme/spacing';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <Screen>
        <View style={styles.block}>
          <AppText variant="title">Screen not found</AppText>
          <AppText variant="body" tone="muted">
            This route is not part of the MMA Trainer flow.
          </AppText>
          <Link href="/" style={styles.link}>
            <AppText variant="bodyStrong" tone="accent">
              Back to home
            </AppText>
          </Link>
        </View>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing.md,
    paddingTop: spacing.xxl,
  },
  link: {
    paddingVertical: spacing.sm,
  },
});
