import { DarkTheme, DefaultTheme } from 'expo-router';

import { palette } from '@/theme/colors';

export const lightNavigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: palette.light.background,
    card: palette.light.background,
    primary: palette.light.accent,
    text: palette.light.text,
    border: palette.light.border,
    notification: palette.light.accent,
  },
};

export const darkNavigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: palette.dark.background,
    card: palette.dark.background,
    primary: palette.dark.accent,
    text: palette.dark.text,
    border: palette.dark.border,
    notification: palette.dark.accent,
  },
};
