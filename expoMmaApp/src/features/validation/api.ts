import { fetch as expoFetch } from 'expo/fetch';

import { getApiBaseUrl } from '@/features/analysis/api/config';
import { AnalysisClientError, readFastApiDetail, toAnalysisClientError } from '@/features/analysis/api/errors';
import { parseAnalyzeGenericAttemptResponse } from '@/features/comparison/api/parse';
import type {
  RepeatabilityResult,
  SelfCompareResponse,
  ValidationRecord,
  ValidationRecordCreate,
  ValidationSummary,
} from '@/features/validation/types';

const TIMEOUT_MS = 180_000;

export async function requestSelfComparison(slug: string): Promise<SelfCompareResponse> {
  return postJson(`/api/validation/self-compare/${encodeURIComponent(slug)}`);
}

export async function requestDeterministicRepeat(slug: string): Promise<SelfCompareResponse> {
  return postJson(`/api/validation/deterministic-repeat/${encodeURIComponent(slug)}`);
}

export async function saveValidationRecord(payload: ValidationRecordCreate): Promise<ValidationRecord> {
  return postJson('/api/validation/records', payload);
}

export async function fetchValidationRecords(): Promise<ValidationRecord[]> {
  return getJson('/api/validation/records');
}

export async function fetchValidationSummary(): Promise<ValidationSummary> {
  return getJson('/api/validation/summary');
}

export async function requestGeminiRepeatability(
  analysisId: string,
  runCount: 1 | 3,
): Promise<RepeatabilityResult> {
  return postJson('/api/validation/gemini-repeatability', { analysisId, runCount });
}

export function validationExportJsonUrl(): string {
  return `${getApiBaseUrl()}/api/validation/export.json`;
}

export function validationExportCsvUrl(): string {
  return `${getApiBaseUrl()}/api/validation/export.csv`;
}

export async function fetchValidationExportJson(): Promise<unknown> {
  return getJson('/api/validation/export.json');
}

export async function fetchValidationExportCsv(): Promise<string> {
  const baseUrl = getApiBaseUrl();
  const response = await expoFetch(`${baseUrl}/api/validation/export.csv`);
  if (!response.ok) {
    throw new AnalysisClientError('export_failed', 'Validation CSV export failed.', response.status);
  }
  return response.text();
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await expoFetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: body == null ? undefined : { 'Content-Type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const parsed: unknown = await readJson(response);
    if (!response.ok) {
      throw new AnalysisClientError(
        'validation_failed',
        readFastApiDetail(parsed) ?? 'The validation request failed.',
        response.status,
      );
    }
    if (isSelfComparePayload(parsed)) {
      const comparison = parseAnalyzeGenericAttemptResponse(parsed.comparison);
      return {
        comparison,
        deterministicRepeat: parsed.deterministicRepeat,
        processingLatency: parsed.processingLatency ?? comparison.processingLatency ?? null,
      } as T;
    }
    return parsed as T;
  } catch (error) {
    if (error instanceof AnalysisClientError) {
      throw error;
    }
    throw toAnalysisClientError(error);
  } finally {
    clearTimeout(timeout);
  }
}

async function getJson<T>(path: string): Promise<T> {
  const baseUrl = getApiBaseUrl();
  try {
    const response = await expoFetch(`${baseUrl}${path}`);
    const parsed: unknown = await readJson(response);
    if (!response.ok) {
      throw new AnalysisClientError(
        'validation_failed',
        readFastApiDetail(parsed) ?? 'The validation request failed.',
        response.status,
      );
    }
    return parsed as T;
  } catch (error) {
    if (error instanceof AnalysisClientError) {
      throw error;
    }
    throw toAnalysisClientError(error);
  }
}

async function readJson(response: { text: () => Promise<string>; status: number }): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AnalysisClientError('malformed', 'The validation server returned an unexpected response.', response.status);
  }
}

function isSelfComparePayload(value: unknown): value is {
  comparison: unknown;
  deterministicRepeat: SelfCompareResponse['deterministicRepeat'];
  processingLatency?: SelfCompareResponse['processingLatency'];
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'comparison' in value &&
    'deterministicRepeat' in value
  );
}
