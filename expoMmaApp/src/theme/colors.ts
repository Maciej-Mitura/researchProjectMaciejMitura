export const palette = {
  light: {
    background: '#F4F6F8',
    surface: '#FFFFFF',
    surfaceMuted: '#E9EEF3',
    text: '#0B1220',
    textMuted: '#5C6778',
    border: '#D7DEE7',
    accent: '#E85D04',
    accentText: '#FFFFFF',
    success: '#1B7F5A',
    warning: '#C2410C',
    overlay: 'rgba(11, 18, 32, 0.72)',
  },
  dark: {
    background: '#0B0F14',
    surface: '#151B24',
    surfaceMuted: '#1D2530',
    text: '#F4F7FB',
    textMuted: '#9AA5B5',
    border: '#2A3544',
    accent: '#FF6B1A',
    accentText: '#0B0F14',
    success: '#3DDC97',
    warning: '#FF9F46',
    overlay: 'rgba(5, 8, 12, 0.78)',
  },
} as const;

export type ColorSchemeName = keyof typeof palette;
export type ThemeColors = (typeof palette)[ColorSchemeName];
