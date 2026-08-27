import { Platform } from 'react-native';
import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { PrivacyAcknowledgementsProvider } from '@/features/privacy/PrivacyAcknowledgementsContext';
import { TechniqueLibraryProvider } from '@/features/techniques/TechniqueLibraryContext';
import { darkNavigationTheme, lightNavigationTheme } from '@/theme/navigationTheme';
import { useIsDarkMode } from '@/theme/useAppTheme';

export default function RootLayout() {
  const isDark = useIsDarkMode();

  return (
    <PrivacyAcknowledgementsProvider>
      <TechniqueLibraryProvider>
        <ThemeProvider value={isDark ? darkNavigationTheme : lightNavigationTheme}>
          <StatusBar style={isDark ? 'light' : 'dark'} />
          <Stack
            screenOptions={{
              headerShadowVisible: false,
              headerTitleStyle: {
                fontWeight: '600',
                fontFamily: Platform.OS === 'android' ? 'sans-serif-medium' : undefined,
              },
            }}>
            <Stack.Screen name="index" options={{ title: 'MMA Trainer' }} />
            <Stack.Screen name="techniques" options={{ title: 'Techniques' }} />
            <Stack.Screen name="privacy" options={{ title: 'Privacy & Data' }} />
            <Stack.Screen name="validation/index" options={{ title: 'Research Validation' }} />
            <Stack.Screen name="validation/result" options={{ title: 'Validation Result' }} />
            <Stack.Screen name="validation/summary" options={{ title: 'Saved Results' }} />
            <Stack.Screen name="add-technique" options={{ headerShown: false }} />
            <Stack.Screen name="technique/[techniqueId]" options={{ title: 'Technique' }} />
            <Stack.Screen name="get-ready/[techniqueId]" options={{ title: 'Get Ready' }} />
            <Stack.Screen name="training/[techniqueId]" options={{ title: 'Training' }} />
            <Stack.Screen
              name="analysis/[techniqueId]"
              options={{ title: 'Experimental Keyframe Review' }}
            />
            <Stack.Screen
              name="comparison/[techniqueId]"
              options={{ title: 'Computer Vision Comparison' }}
            />
            <Stack.Screen
              name="choose-analysis/[techniqueId]"
              options={{ title: 'Choose Analysis' }}
            />
            <Stack.Screen name="ai-results/[techniqueId]" options={{ title: 'Detailed AI Analysis' }} />
            <Stack.Screen
              name="comparison-unavailable/[techniqueId]"
              options={{ title: 'Built-in Technique' }}
            />
            <Stack.Screen name="results/[techniqueId]" options={{ title: 'Legacy Results' }} />
          </Stack>
        </ThemeProvider>
      </TechniqueLibraryProvider>
    </PrivacyAcknowledgementsProvider>
  );
}
