import { palette, type ThemeColors } from '@/theme/colors';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useAppTheme(): ThemeColors {
  const scheme = useColorScheme();
  return scheme === 'dark' ? palette.dark : palette.light;
}

export function useIsDarkMode(): boolean {
  return useColorScheme() === 'dark';
}
