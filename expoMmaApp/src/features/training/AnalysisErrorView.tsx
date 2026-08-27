import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { checkAnalysisServer } from '@/features/analysis/api/health';
import { AnalysisClientError, shouldOfferAnalysisServerCheck } from '@/features/analysis/api/errors';
import { analysisErrorPresentation } from '@/features/analysis/errorPresentation';
import type { AnalysisErrorCode } from '@/features/analysis/types';
import { spacing } from '@/theme/spacing';

type AnalysisErrorViewProps = {
  message: string;
  errorCode?: AnalysisErrorCode | null;
  hint?: string;
  onRetry: () => void;
  onBack: () => void;
};

export function AnalysisErrorView({
  message,
  errorCode = null,
  hint = 'This is a measurement problem, not a technique score.',
  onRetry,
  onBack,
}: AnalysisErrorViewProps) {
  const [healthLine, setHealthLine] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const showServerCheck = shouldOfferAnalysisServerCheck(errorCode);
  const presentation = analysisErrorPresentation(errorCode, hint);

  const onCheckServer = async () => {
    setChecking(true);
    setHealthLine(null);
    try {
      const result = await checkAnalysisServer();
      setHealthLine(
        result.reachable ? 'Analysis server is reachable.' : `Cannot reach server. ${result.message}`,
      );
    } catch (error) {
      const text =
        error instanceof AnalysisClientError
          ? error.message
          : 'Could not complete the health check.';
      setHealthLine(text);
    } finally {
      setChecking(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Card>
        <AppText variant="caption" tone="warning">
          Analysis
        </AppText>
        <AppText variant="title">{presentation.title}</AppText>
        <AppText variant="body" tone="muted">
          {message}
        </AppText>
        <AppText variant="body" tone="muted">
          {presentation.hint}
        </AppText>
        {__DEV__ && errorCode ? (
          <AppText variant="caption" tone="muted">
            {`Diagnostic code: ${errorCode}`}
          </AppText>
        ) : null}
        {healthLine ? (
          <AppText variant="body" tone={healthLine.startsWith('Analysis server is reachable') ? 'success' : 'warning'}>
            {healthLine}
          </AppText>
        ) : null}
      </Card>
      <View style={styles.actions}>
        <Button label="Retry Attempt" onPress={onRetry} />
        {showServerCheck ? (
          <Button
            label={checking ? 'Checking…' : 'Check Analysis Server'}
            variant="secondary"
            disabled={checking}
            onPress={() => {
              void onCheckServer();
            }}
          />
        ) : null}
        <Button label="Back" variant="ghost" onPress={onBack} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.lg,
  },
  actions: {
    gap: spacing.sm,
  },
});
