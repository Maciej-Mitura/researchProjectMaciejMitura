import { TextInput, StyleSheet, View, type TextInputProps } from 'react-native';

import { AppText } from '@/components/AppText';
import { radii } from '@/theme/radii';
import { spacing } from '@/theme/spacing';
import { useAppTheme } from '@/theme/useAppTheme';

type TextFieldProps = TextInputProps & {
  label: string;
  hint?: string;
};

export function TextField({ label, hint, style, ...rest }: TextFieldProps) {
  const theme = useAppTheme();

  return (
    <View style={styles.wrap}>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <TextInput
        {...rest}
        placeholderTextColor={theme.textMuted}
        style={[
          styles.input,
          {
            color: theme.text,
            backgroundColor: theme.surface,
            borderColor: theme.border,
          },
          style,
        ]}
      />
      {hint ? (
        <AppText variant="body" tone="muted">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 16,
  },
});
