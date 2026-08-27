import { Platform, type TextStyle } from 'react-native';

const nativeFont: TextStyle = Platform.select({
  ios: {},
  android: {
    fontFamily: 'sans-serif',
  },
  default: {
    fontFamily: 'system-ui',
  },
}) ?? { fontFamily: 'system-ui' };

export const typography = {
  display: {
    ...nativeFont,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700' as const,
    letterSpacing: -0.4,
  },
  title: {
    ...nativeFont,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700' as const,
    letterSpacing: -0.2,
  },
  subtitle: {
    ...nativeFont,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600' as const,
  },
  body: {
    ...nativeFont,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '400' as const,
  },
  bodyStrong: {
    ...nativeFont,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600' as const,
  },
  caption: {
    ...nativeFont,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600' as const,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
  },
  stat: {
    ...nativeFont,
    fontSize: 48,
    lineHeight: 52,
    fontWeight: '700' as const,
    letterSpacing: -0.8,
  },
};
