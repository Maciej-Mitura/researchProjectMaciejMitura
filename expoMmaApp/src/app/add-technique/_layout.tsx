import { Stack } from 'expo-router';
import { Platform } from 'react-native';

export default function AddTechniqueLayout() {
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerTitleStyle: {
          fontWeight: '600',
          fontFamily: Platform.OS === 'android' ? 'sans-serif-medium' : undefined,
        },
      }}>
      <Stack.Screen name="index" options={{ title: 'Add Technique' }} />
      <Stack.Screen name="duration" options={{ title: 'Recording Length' }} />
      <Stack.Screen name="record" options={{ title: 'Record Reference' }} />
      <Stack.Screen name="review" options={{ title: 'Review Reference' }} />
      <Stack.Screen name="keyframes" options={{ title: 'Reference Keyframes' }} />
    </Stack>
  );
}
