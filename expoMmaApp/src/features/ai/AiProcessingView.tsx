import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { AI_PROCESSING_DESCRIPTION, AI_PROCESSING_TITLE } from '@/features/ai/constants';
import type { AiAnalysisJob, AiJobChecklistItem } from '@/features/ai/types';
import { spacing } from '@/theme/spacing';
import { useAppTheme } from '@/theme/useAppTheme';

type AiProcessingViewProps = {
  job: AiAnalysisJob | null;
};

export function AiProcessingView({ job }: AiProcessingViewProps) {
  const theme = useAppTheme();
  const progress = job ? Math.max(0, Math.min(100, job.progress)) : 0;
  const elapsed = ((job?.elapsedMs ?? 0) / 1000).toFixed(1);
  const checklist = job?.checklist ?? [];

  return (
    <View style={styles.wrap}>
      <AppText variant="caption" tone="accent">
        {AI_PROCESSING_TITLE}
      </AppText>
      <AppText variant="caption" tone="muted">
        Google Gemini
      </AppText>
      <Card>
        <AppText variant="title">{`${progress}%`}</AppText>
        <View style={[styles.track, { backgroundColor: theme.surfaceMuted }]}>
          <View
            style={[
              styles.fill,
              { width: `${progress}%`, backgroundColor: theme.accent },
            ]}
          />
        </View>
        <AppText variant="body">{job?.message ?? 'Starting analysis…'}</AppText>
        <AppText variant="caption" tone="muted">
          {`Elapsed: ${elapsed} s`}
        </AppText>
        {job?.fallbackUsed ? (
          <AppText variant="body" tone="warning">
            {job.modelLabel
              ? `Trying backup model: ${job.modelLabel}…`
              : 'Trying backup model…'}
          </AppText>
        ) : null}
        <AppText variant="caption" tone="muted">
          {job?.progressCaption || AI_PROCESSING_DESCRIPTION}
        </AppText>
        <View style={styles.steps}>
          {checklist.map((item) => (
            <ChecklistRow key={item.id} item={item} />
          ))}
        </View>
      </Card>
    </View>
  );
}

function ChecklistRow({ item }: { item: AiJobChecklistItem }) {
  const marker = item.state === 'complete' ? '✓' : item.state === 'active' ? '●' : '○';
  const tone = item.state === 'complete' ? 'success' : item.state === 'active' ? 'accent' : 'muted';
  return (
    <AppText variant="body" tone={tone}>
      {`${marker} ${item.label}`}
    </AppText>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.lg,
  },
  track: {
    height: 10,
    borderRadius: 999,
    overflow: 'hidden',
  },
  fill: {
    height: 10,
    borderRadius: 999,
  },
  steps: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
