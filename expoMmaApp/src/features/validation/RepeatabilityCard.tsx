import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import type { RepeatabilityResult } from '@/features/validation/types';
import { spacing } from '@/theme/spacing';

export function RepeatabilityCard({ result }: { result: RepeatabilityResult }) {
  const stats = result.overall;
  return (
    <Card>
      <AppText variant="caption">Prototype stability check</AppText>
      <AppText variant="body" tone="muted">
        {result.reusedExistingAiVideo && result.identicalAssetEachRun
          ? `Reused ${result.assetFilename} (${result.assetSha256.slice(0, 8)}…).`
          : 'The prepared AI video could not be confirmed as identical.'}
      </AppText>
      {stats ? (
        <AppText variant="body">
          {`Overall min ${stats.minimum ?? '—'} · max ${stats.maximum ?? '—'} · mean ${stats.mean ?? '—'} · range ${stats.scoreRange ?? '—'}`}
        </AppText>
      ) : null}
      {result.runs.map((run) => (
        <View key={run.index} style={styles.run}>
          <AppText variant="body" tone="muted">
            {`Run ${run.index}: ${run.overallScore ?? '—'} / 100 · ${run.model ?? '—'} · ${run.latencyMs ?? '—'} ms`}
          </AppText>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  run: {
    gap: spacing.xs,
  },
});
