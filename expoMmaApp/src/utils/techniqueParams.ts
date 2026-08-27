import { useLocalSearchParams } from 'expo-router';

export function useTechniqueIdParam(): string | null {
  const { techniqueId } = useLocalSearchParams<{ techniqueId?: string | string[] }>();

  if (typeof techniqueId === 'string' && techniqueId.length > 0) {
    return techniqueId;
  }

  if (Array.isArray(techniqueId) && techniqueId[0]) {
    return techniqueId[0];
  }

  return null;
}
