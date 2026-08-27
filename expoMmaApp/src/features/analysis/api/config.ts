import { AnalysisClientError } from '@/features/analysis/api/errors';

export function getApiBaseUrl(): string {
  const raw = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new AnalysisClientError(
      'missing_api_url',
      'Analysis server address is not configured. Set EXPO_PUBLIC_API_BASE_URL to http://YOUR_LAN_IP:8000 (include http://, not localhost) and restart Expo.',
    );
  }

  return normalizeApiBaseUrl(raw);
}

export function resolveApiUrl(pathOrUrl: string, baseUrl: string = getApiBaseUrl()): string {
  const trimmed = pathOrUrl.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

function normalizeApiBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  // expo/fetch requires a scheme. `.env` often has `192.168.x.x:8000` without http://.
  return `http://${trimmed}`;
}
