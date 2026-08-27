import AsyncStorage from '@react-native-async-storage/async-storage';

import { AnalysisClientError } from '@/features/analysis/api/errors';
import {
  DEFAULT_PRIVACY_ACKNOWLEDGEMENTS,
  parseAcknowledgements,
  serializeAcknowledgements,
  withCameraAcknowledged,
  withExternalAiAcknowledged,
  type PrivacyAcknowledgements,
} from '@/features/privacy/acknowledgements';
import { canCreateGeminiJob } from '@/features/privacy/gates';

export const PRIVACY_ACKNOWLEDGEMENTS_STORAGE_KEY = 'mmaTrainer.privacyAcknowledgements.v1';

let cache: PrivacyAcknowledgements | null = null;
let loadPromise: Promise<PrivacyAcknowledgements> | null = null;

export async function loadPrivacyAcknowledgements(): Promise<PrivacyAcknowledgements> {
  if (cache) {
    return cache;
  }
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(PRIVACY_ACKNOWLEDGEMENTS_STORAGE_KEY);
        cache = parseAcknowledgements(raw);
      } catch {
        cache = { ...DEFAULT_PRIVACY_ACKNOWLEDGEMENTS };
      }
      return cache;
    })();
  }
  const loaded = await loadPromise;
  return loaded;
}

export function getCachedPrivacyAcknowledgements(): PrivacyAcknowledgements | null {
  return cache;
}

export async function savePrivacyAcknowledgements(
  next: PrivacyAcknowledgements,
): Promise<PrivacyAcknowledgements> {
  cache = next;
  loadPromise = Promise.resolve(next);
  try {
    await AsyncStorage.setItem(PRIVACY_ACKNOWLEDGEMENTS_STORAGE_KEY, serializeAcknowledgements(next));
  } catch {
    // Keep the in-memory acknowledgement so the current session can continue.
  }
  return next;
}

export async function acknowledgeCameraPrivacy(): Promise<PrivacyAcknowledgements> {
  const current = await loadPrivacyAcknowledgements();
  return savePrivacyAcknowledgements(withCameraAcknowledged(current));
}

export async function acknowledgeExternalAi(): Promise<PrivacyAcknowledgements> {
  const current = await loadPrivacyAcknowledgements();
  return savePrivacyAcknowledgements(withExternalAiAcknowledged(current));
}

export async function resetPrivacyAcknowledgements(): Promise<PrivacyAcknowledgements> {
  return savePrivacyAcknowledgements({ ...DEFAULT_PRIVACY_ACKNOWLEDGEMENTS });
}

export async function isExternalAiAcknowledged(): Promise<boolean> {
  const state = await loadPrivacyAcknowledgements();
  return canCreateGeminiJob(state);
}

/**
 * Hard frontend guard: do not create a Gemini job before external-AI acknowledgement.
 * This is application UX protection, not a legal consent-management system.
 */
export async function assertExternalAiAcknowledged(): Promise<void> {
  const acknowledged = await isExternalAiAcknowledged();
  if (!acknowledged) {
    throw new AnalysisClientError(
      'privacy_not_acknowledged',
      'Detailed AI Analysis needs a separate acknowledgement before sending video to Google Gemini.',
    );
  }
}
