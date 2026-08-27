export const CAMERA_PRIVACY_ACK_KEY = 'cameraPrivacyAcknowledged';
export const EXTERNAL_AI_ACK_KEY = 'externalAiAcknowledged';

export type PrivacyAcknowledgements = {
  cameraPrivacyAcknowledged: boolean;
  externalAiAcknowledged: boolean;
};

export const DEFAULT_PRIVACY_ACKNOWLEDGEMENTS: PrivacyAcknowledgements = {
  cameraPrivacyAcknowledged: false,
  externalAiAcknowledged: false,
};

export function parseAcknowledgements(raw: string | null): PrivacyAcknowledgements {
  if (raw == null || raw.trim().length === 0) {
    return { ...DEFAULT_PRIVACY_ACKNOWLEDGEMENTS };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return { ...DEFAULT_PRIVACY_ACKNOWLEDGEMENTS };
    }
    const record = parsed as Record<string, unknown>;
    return {
      cameraPrivacyAcknowledged: record[CAMERA_PRIVACY_ACK_KEY] === true,
      externalAiAcknowledged: record[EXTERNAL_AI_ACK_KEY] === true,
    };
  } catch {
    return { ...DEFAULT_PRIVACY_ACKNOWLEDGEMENTS };
  }
}

export function serializeAcknowledgements(state: PrivacyAcknowledgements): string {
  return JSON.stringify({
    [CAMERA_PRIVACY_ACK_KEY]: state.cameraPrivacyAcknowledged,
    [EXTERNAL_AI_ACK_KEY]: state.externalAiAcknowledged,
  });
}

export function withCameraAcknowledged(
  state: PrivacyAcknowledgements,
): PrivacyAcknowledgements {
  return { ...state, cameraPrivacyAcknowledged: true };
}

export function withExternalAiAcknowledged(
  state: PrivacyAcknowledgements,
): PrivacyAcknowledgements {
  return { ...state, externalAiAcknowledged: true };
}
