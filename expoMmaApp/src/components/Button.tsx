import { Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { radii } from '@/theme/radii';
import { spacing } from '@/theme/spacing';
import { useAppTheme } from '@/theme/useAppTheme';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: ViewStyle;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  accessibilityLabel,
  style,
}: ButtonProps) {
  const theme = useAppTheme();

  const backgroundColor =
    variant === 'primary'
      ? theme.accent
      : variant === 'danger'
        ? theme.warning
        : variant === 'secondary'
          ? theme.surfaceMuted
          : 'transparent';

  const textTone = variant === 'ghost' ? 'accent' : 'default';
  const textColor = variant === 'primary' || variant === 'danger' ? theme.accentText : undefined;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor,
          borderColor: variant === 'secondary' ? theme.border : 'transparent',
          borderWidth: variant === 'secondary' ? 1 : 0,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
        },
        style,
      ]}>
      <AppText variant="bodyStrong" tone={textTone} style={textColor ? { color: textColor } : undefined}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
});
