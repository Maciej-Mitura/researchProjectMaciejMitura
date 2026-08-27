import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { spacing } from '@/theme/spacing';
import type { AnalysisDetails } from '@/features/validation/types';
import { NORMALIZED_SAMPLE_COUNT, QUICK_METHOD_LABEL } from '@/features/validation/types';

function formatMs(value: number | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} s`;
  }
  return `${value} ms`;
}

function formatDuration(value: number | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  return `${(value / 1000).toFixed(2)} s`;
}

function formatCoverage(value: number | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  return `${Math.round(value * 100)}%`;
}

export function AnalysisDetailsCard({
  details,
  title = 'Analysis details',
  collapsible = true,
  defaultExpanded = false,
}: {
  details: AnalysisDetails;
  title?: string;
  collapsible?: boolean;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const visible = !collapsible || expanded;
  const samples = details.normalizedSampleCount ?? NORMALIZED_SAMPLE_COUNT;
  const method = details.quickMethod ?? QUICK_METHOD_LABEL;
  const hasComputerVision =
    details.referenceDurationMs != null ||
    details.userDurationMs != null ||
    details.poseCoverage != null ||
    details.normalizedSampleCount != null ||
    details.quickLatencyMs != null ||
    details.userMovementRegionCount != null ||
    details.referenceMovementRegionCount != null;
  const hasDetailedAi =
    Boolean(details.provider) ||
    Boolean(details.aiModel) ||
    details.fallbackUsed != null ||
    details.aiLatencyMs != null ||
    details.fullAnalysisLatencyMs != null ||
    details.aiComparisonDurationMs != null ||
    details.previewMatchesGemini != null;

  return (
    <Card>
      {collapsible ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Hide analysis details' : 'Show analysis details'}
          onPress={() => setExpanded((value) => !value)}>
          <AppText variant="caption" tone="accent">
            {visible ? `Hide ${title}` : title}
          </AppText>
        </Pressable>
      ) : (
        <AppText variant="caption">{title}</AppText>
      )}
      {visible ? (
        <>
          {hasComputerVision ? (
            <AppText variant="caption" tone="muted">
              Computer Vision
            </AppText>
          ) : null}
          <Row label="Method" value={method} />
          <Row label="Normalized samples" value={`${samples}`} />
          {details.referenceMovementRegionCount != null ? (
            <Row label="Reference movement regions" value={`${details.referenceMovementRegionCount}`} />
          ) : null}
          {details.userMovementRegionCount != null ? (
            <Row label="User movement regions" value={`${details.userMovementRegionCount}`} />
          ) : null}
          {formatDuration(details.referenceDurationMs) ? (
            <Row label="Active reference duration" value={formatDuration(details.referenceDurationMs) ?? ''} />
          ) : null}
          {formatDuration(details.userDurationMs) ? (
            <Row label="Active user duration" value={formatDuration(details.userDurationMs) ?? ''} />
          ) : null}
          {formatCoverage(details.poseCoverage) ? (
            <Row label="Pose coverage" value={formatCoverage(details.poseCoverage) ?? ''} />
          ) : null}
          {formatMs(details.quickLatencyMs) ? (
            <Row label="Processing latency" value={formatMs(details.quickLatencyMs) ?? ''} />
          ) : null}
          {hasDetailedAi ? (
            <AppText variant="caption" tone="muted">
              Detailed AI
            </AppText>
          ) : null}
          {details.provider ? <Row label="Provider" value={details.provider} /> : null}
          {details.aiModel ? <Row label="Actual model" value={details.aiModel} /> : null}
          {details.fallbackUsed != null ? (
            <Row label="Fallback used" value={details.fallbackUsed ? 'yes' : 'no'} />
          ) : null}
          {formatMs(details.aiLatencyMs) ? (
            <Row label="Gemini latency" value={formatMs(details.aiLatencyMs) ?? ''} />
          ) : null}
          {formatMs(details.fullAnalysisLatencyMs) ? (
            <Row label="Total latency" value={formatMs(details.fullAnalysisLatencyMs) ?? ''} />
          ) : null}
          {formatDuration(details.aiComparisonDurationMs) ? (
            <Row
              label="AI comparison duration"
              value={formatDuration(details.aiComparisonDurationMs) ?? ''}
            />
          ) : null}
          {details.previewMatchesGemini != null ? (
            <Row
              label="Preview matches Gemini"
              value={details.previewMatchesGemini ? 'yes' : 'no'}
            />
          ) : null}
          <AppText variant="body" tone="muted">
            Timing is collected for research documentation. Matching duration is not proof of
            matching technique.
          </AppText>
        </>
      ) : (
        <AppText variant="body" tone="muted">
          Pipeline measurements and model metadata. Not a technique score.
        </AppText>
      )}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <AppText variant="body" tone="muted">
        {label}
      </AppText>
      <AppText variant="body" style={styles.value}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  value: {
    flexShrink: 1,
    textAlign: 'right',
  },
});
