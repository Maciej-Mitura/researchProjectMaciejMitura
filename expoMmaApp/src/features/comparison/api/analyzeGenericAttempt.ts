import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';

import { getApiBaseUrl } from '@/features/analysis/api/config';
import {
  AnalysisClientError,
  errorFromHttpStatus,
  readFastApiDetail,
  toAnalysisClientError,
} from '@/features/analysis/api/errors';
import { GENERIC_ANALYZE_TIMEOUT_MS } from '@/features/comparison/types';
import { parseAnalyzeGenericAttemptResponse } from '@/features/comparison/api/parse';
import type { AnalyzeGenericAttemptResponse } from '@/features/comparison/types';

type AnalyzeGenericAttemptInput = {
  slug: string;
  videoUri: string;
};

export async function analyzeGenericAttempt({
  slug,
  videoUri,
}: AnalyzeGenericAttemptInput): Promise<AnalyzeGenericAttemptResponse> {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/api/reference-techniques/${encodeURIComponent(slug)}/analyze-attempt`;

  let formData: FormData;
  try {
    formData = createVideoUploadForm(videoUri);
  } catch (error) {
    if (error instanceof AnalysisClientError) {
      throw error;
    }
    console.warn('[comparison] could not prepare video upload', error);
    throw new AnalysisClientError(
      'upload_failed',
      'The recorded video could not be prepared for upload. Please record again.',
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GENERIC_ANALYZE_TIMEOUT_MS);

  try {
    const response = await expoFetch(url, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    const body: unknown = await readJsonBody(response);

    if (!response.ok) {
      throw errorFromComparisonHttpStatus(response.status, readFastApiDetail(body));
    }

    const parsed = parseAnalyzeGenericAttemptResponse(body);
    if (!parsed.analysisValid) {
      throw new AnalysisClientError(
        'analysis_rejected',
        parsed.failureMessage ??
          'The recording could not be measured. This is not a technique score.',
        response.status,
        null,
        parsed,
      );
    }

    return parsed;
  } catch (error) {
    if (error instanceof AnalysisClientError) {
      throw error;
    }
    console.warn('[comparison] upload failed', error);
    throw toAnalysisClientError(error);
  } finally {
    clearTimeout(timeout);
  }
}

export function recordedReferenceVideoUrl(slug: string): string {
  return `${getApiBaseUrl()}/api/reference-techniques/${encodeURIComponent(slug)}/video`;
}

export function comparisonVideoUrl(analysisId: string, filename = 'comparison.mp4'): string {
  return `${getApiBaseUrl()}/api/comparisons/${encodeURIComponent(analysisId)}/${filename}`;
}

function errorFromComparisonHttpStatus(status: number, detail: string | null): AnalysisClientError {
  if (status === 404) {
    return new AnalysisClientError(
      'reference_missing',
      detail ?? 'This recorded reference could not be found.',
      status,
    );
  }
  if (status === 422) {
    return new AnalysisClientError(
      'reference_incomplete',
      detail ?? 'This recorded reference is incomplete and cannot be compared.',
      status,
    );
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
