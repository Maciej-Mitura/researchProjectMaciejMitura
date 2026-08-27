import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { AnalysisClientError } from '@/features/analysis/api/errors';
import { fetchValidationExportCsv, fetchValidationExportJson, fetchValidationSummary } from '@/features/validation/api';
import { scenarioDisplayLabel } from '@/features/validation/presentation';
import type { ValidationRecord, ValidationSummary } from '@/features/validation/types';
import { spacing } from '@/theme/spacing';
import { validationHref } from '@/utils/routes';

export function ValidationSummaryScreen() {
  const [summary, setSummary] = useState<ValidationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      setSummary(await fetchValidationSummary());
    } catch (caught) {
      const client =
        caught instanceof AnalysisClientError ? caught : new AnalysisClientError('validation_failed', String(caught));
      setError(client.message);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void reload();
    }, 0);
    return () => clearTimeout(timer);
  }, [reload]);

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="caption" tone="accent">
          Research Validation
        </AppText>
        <AppText variant="title">Saved validation results</AppText>
        <AppText variant="body" tone="muted">
          Compact record of labelled prototype checks. These counts are not statistical conclusions.
        </AppText>
      </View>

      {summary ? (
        <>
          <Card>
            <AppText variant="body">{`${summary.runCount} saved results`}</AppText>
            <AppText variant="body" tone="muted">
              {`${summary.invalidCount} invalid measurement outcomes`}
            </AppText>
          </Card>
          {summary.records.map((record) => (
            <SavedResultCard key={record.id} record={record} />
          ))}
          {summary.records.length === 0 ? (
            <AppText variant="body" tone="muted">
              No validation results have been saved yet.
            </AppText>
          ) : null}
        </>
      ) : (
        <AppText variant="body" tone="muted">
          Loading saved validation records…
        </AppText>
      )}

      {error ? (
        <AppText variant="body" tone="warning">
          {error}
        </AppText>
      ) : null}
      {notice ? (
        <AppText variant="body" tone="success">
          {notice}
        </AppText>
      ) : null}

      <Button
        label="Export results"
        variant="secondary"
        onPress={() => {
          void (async () => {
            try {
              const json = await fetchValidationExportJson();
              await fetchValidationExportCsv();
              const count =
                json && typeof json === 'object' && 'recordCount' in json
                  ? Number((json as { recordCount: number }).recordCount)
                  : 0;
              setNotice(`Exported ${count} records (JSON + CSV).`);
            } catch (caught) {
              setError(caught instanceof AnalysisClientError ? caught.message : String(caught));
            }
          })();
        }}
      />
      <Button label="Refresh" variant="ghost" onPress={() => void reload()} />
      <Button label="Back to tests" variant="ghost" onPress={() => router.replace(validationHref)} />
    </Screen>
  );
}

function SavedResultCard({ record }: { record: ValidationRecord }) {
  const validLabel = record.comparisonValid ? 'Valid' : 'Invalid measurement';
  return (
    <Card>
      <AppText variant="bodyStrong">{record.techniqueName}</AppText>
      <AppText variant="body">{scenarioDisplayLabel(record.scenarioType)}</AppText>
      {record.comparisonValid ? (
        <AppText variant="body" tone="muted">
          {`Quick: ${record.quickOverall ?? '—'}   AI: ${record.geminiOverall ?? '—'}`}
        </AppText>
      ) : (
        <AppText variant="body" tone="muted">
          {record.invalidReason ?? 'Invalid measurement'}
        </AppText>
      )}
      <AppText variant="caption" tone={record.comparisonValid ? 'success' : 'warning'}>
        {validLabel}
      </AppText>
      {record.notes ? (
        <AppText variant="body" tone="muted">
          {record.notes}
        </AppText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm,
  },
});
