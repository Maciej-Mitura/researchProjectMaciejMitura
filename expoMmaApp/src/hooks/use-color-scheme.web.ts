import { useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';

function subscribe(onStoreChange: () => void): () => void {
  const subscription = Appearance.addChangeListener(onStoreChange);
  return () => subscription.remove();
}

function getSnapshot(): 'light' | 'dark' {
  return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
}

function getServerSnapshot(): 'light' | 'dark' {
  return 'light';
}

/**
 * Web color scheme hook using an external store so static rendering
 * can snapshot 'light' on the server and read the real scheme on the client.
 */
export function useColorScheme(): 'light' | 'dark' {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
