import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { startReferenceCapture } from '@/features/reference/captureSession';
import { addTechniqueDurationHref } from '@/utils/routes';
import { spacing } from '@/theme/spacing';

const MAX_NAME = 80;
const MAX_DESCRIPTION = 280;

export function AddTechniqueInfoScreen() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onContinue = useCallback(() => {
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setError('Enter a technique name.');
      return;
    }
    if (trimmedName.length > MAX_NAME) {
      setError(`Name must be at most ${MAX_NAME} characters.`);
      return;
    }
    startReferenceCapture(trimmedName, description.trim());
    router.push(addTechniqueDurationHref);
  }, [description, name]);

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="caption" tone="accent">
          Add technique
        </AppText>
        <AppText variant="title">Technique information</AppText>
        <AppText variant="body" tone="muted">
          Name the movement. Avoid built-in names such as Jab or MMA Kick.
        </AppText>
      </View>

      <TextField
        label="Technique name"
        value={name}
        onChangeText={(value) => {
          setName(value);
          setError(null);
        }}
        placeholder="Rear Roundhouse Kick"
        autoCapitalize="words"
        maxLength={MAX_NAME}
      />

      <TextField
        label="Description (optional)"
        value={description}
        onChangeText={setDescription}
        placeholder="Short note about this reference"
        multiline
        maxLength={MAX_DESCRIPTION}
        style={styles.multiline}
      />

      {error ? (
        <AppText variant="body" tone="warning">
          {error}
        </AppText>
      ) : null}

      <Button label="Continue" onPress={onContinue} />
      <Button label="Cancel" variant="ghost" onPress={() => router.replace('/techniques')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm,
  },
  multiline: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
});
