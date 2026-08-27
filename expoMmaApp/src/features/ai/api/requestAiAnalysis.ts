import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';

import { getApiBaseUrl } from '@/features/analysis/api/config';
import {
  AnalysisClientError,
  errorFromHttpStatus,
  readFastApiDetail,
  toAnalysisClientError,
} from '@/features/analysis/api/errors';
import { parseDetailedAssessmentResponse } from '@/features/ai/api/parse';
import { AI_ANALYZE_TIMEOUT_MS } from '@/features/ai/constants';
import type { DetailedAssessmentResponse } from '@/features/ai/types';
import { assertExternalAiAcknowledged } from '@/features/privacy/store';

type RequestAiAnalysisInput = {
  slug: string;
  videoUri: string;
};

export async function requestAiAnalysis({
  slug,
  videoUri,
}: RequestAiAnalysisInput): Promise<DetailedAssessmentResponse> {
  await assertExternalAiAcknowledged();
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/api/reference-techniques/${encodeURIComponent(slug)}/ai-analysis`;

  let formData: FormData;
  try {
    formData = createVideoUploadForm(videoUri);
  } catch (error) {
    if (error instanceof AnalysisClientError) {
      throw error;
    }
    console.warn('[ai] could not prepare video upload', error);
    throw new AnalysisClientError(
      'upload_failed',
      'The recorded video could not be prepared for upload. Please record again.',
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_ANALYZE_TIMEOUT_MS);

  try {
    const response = await expoFetch(url, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    const body: unknown = await readJsonBody(response);

    if (!response.ok) {
      throw errorFromAiHttpStatus(response.status, readFastApiDetail(body));
    }

    return parseDetailedAssessmentResponse(body);
  } catch (error) {
    if (error instanceof AnalysisClientError) {
      throw error;
    }
    console.warn('[ai] detailed analysis failed', error);
    throw toAnalysisClientError(error);
  } finally {
    clearTimeout(timeout);
  }
}

function errorFromAiHttpStatus(status: number, detail: string | null): AnalysisClientError {
  const message = detail ?? 'Detailed AI Analysis could not be completed.';
  if (status === 401 || status === 403) {
    return new AnalysisClientError('gemini_auth', message, status);
  }
  if (status === 404) {
    return new AnalysisClientError(
      'reference_missing',
      detail ?? 'This recorded reference could not be found.',
      status,
    );
  }
  if (status === 429) {
    return new AnalysisClientError('gemini_rate_limit', message, status);
  }
  if (status === 502) {
    return new AnalysisClientError('ai_malformed', message, status);
  }
  if (status === 503) {
    const lowered = message.toLowerCase();
    if (lowered.includes('not configured')) {
      return new AnalysisClientError('gemini_not_configured', message, status);
    }
    if (lowered.includes('usage limits') || lowered.includes('quota')) {
      return new AnalysisClientError('gemini_quota', message, status);
    }
    if (lowered.includes('authenticate')) {
      return new AnalysisClientError('gemini_auth', message, status);
    }
    return new AnalysisClientError('gemini_unavailable', message, status);
  }
  if (status === 504) {
    return new AnalysisClientError('gemini_timeout', message, status);
  }
  return errorFromHttpStatus(status, detail);
}

function createVideoUploadForm(videoUri: string): FormData {
  const videoFile = new File(videoUri);

  if (!videoFile.exists) {
    throw new AnalysisClientError(
      'upload_failed',
      'The recorded video file was not found on this device. Please record again.',
    );
  }

  const formData = new FormData();
  const filename = videoFile.name.trim();
  if (filename.length > 0) {
    formData.append('video', videoFile, filename);
  } else {
    formData.append('video', videoFile);
  }
  return formData;
}

async function readJsonBody(response: { text: () => Promise<string>; status: number }): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AnalysisClientError(
      'malformed',
      'The analysis server returned an unexpected response.',
      response.status,
    );
  }
}
