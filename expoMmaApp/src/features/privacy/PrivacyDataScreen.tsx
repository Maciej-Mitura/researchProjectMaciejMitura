import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import {
  PRIVACY_SCREEN_TITLE,
  PRIVACY_SECTIONS,
  RESET_ACKNOWLEDGEMENTS_LABEL,
  RESET_ACKNOWLEDGEMENTS_NOTICE,
  REVIEW_PRIVACY_LABEL,
} from '@/features/privacy/copy';
import { usePrivacyAcknowledgements } from '@/features/privacy/PrivacyAcknowledgementsContext';
import { spacing } from '@/theme/spacing';

export function PrivacyDataScreen() {
  const { acknowledgements, resetAcknowledgements, ready } = usePrivacyAcknowledgements();
  const [resetNotice, setResetNotice] = useState<string | null>(null);

  async function onReset() {
    await resetAcknowledgements();
    setResetNotice(RESET_ACKNOWLEDGEMENTS_NOTICE);
  }

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="caption" tone="accent">
          Privacy information
        </AppText>
        <AppText variant="title">{PRIVACY_SCREEN_TITLE}</AppText>
        <AppText variant="body" tone="muted">
          How MMA Trainer records, processes, stores, and deletes movement data. This is
          GDPR-oriented privacy and data-processing transparency for a research prototype. It is
          not a certified GDPR compliance statement.
        </AppText>
      </View>

      {PRIVACY_SECTIONS.map((section) => (
        <Card key={section.title}>
          <AppText variant="caption" tone="accent">
            {section.title}
          </AppText>
          <AppText variant="body">{section.body}</AppText>
        </Card>
      ))}

      <Card>
        <AppText variant="caption">{REVIEW_PRIVACY_LABEL}</AppText>
        <AppText variant="body" tone="muted">
          {ready
            ? `Camera & movement data: ${acknowledgements.cameraPrivacyAcknowledged ? 'acknowledged' : 'not yet acknowledged'}`
            : 'Loading acknowledgement state…'}
        </AppText>
        <AppText variant="body" tone="muted">
          {ready
            ? `External AI processing: ${acknowledgements.externalAiAcknowledged ? 'acknowledged' : 'not yet acknowledged'}`
            : 'Loading acknowledgement state…'}
        </AppText>
      </Card>

      {resetNotice ? (
        <AppText variant="body" tone="success">
          {resetNotice}
        </AppText>
      ) : null}

      <Button
        label={RESET_ACKNOWLEDGEMENTS_LABEL}
        variant="secondary"
        accessibilityLabel="Reset privacy acknowledgements without deleting recorded techniques"
        onPress={() => {
          void onReset();
        }}
      />
      <Button label="Back" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm,
  },
});
