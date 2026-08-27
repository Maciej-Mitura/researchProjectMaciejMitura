import { Text, type TextProps } from 'react-native';

import { typography } from '@/theme/typography';
import { useAppTheme } from '@/theme/useAppTheme';

type AppTextVariant = keyof typeof typography;
type AppTextTone = 'default' | 'muted' | 'accent' | 'success' | 'warning';

type AppTextProps = TextProps & {
  variant?: AppTextVariant;
  tone?: AppTextTone;
};

export function AppText({
  variant = 'body',
  tone = 'default',
  style,
  ...rest
}: AppTextProps) {
  const theme = useAppTheme();
  const color =
    tone === 'muted'
      ? theme.textMuted
      : tone === 'accent'
        ? theme.accent
        : tone === 'success'
          ? theme.success
          : tone === 'warning'
            ? theme.warning
            : theme.text;

  return <Text style={[typography[variant], { color }, style]} {...rest} />;
}
