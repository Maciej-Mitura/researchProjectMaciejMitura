import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';

import { ANALYZE_REQUEST_TIMEOUT_MS } from '@/features/analysis/constants';
import { getApiBaseUrl } from '@/features/analysis/api/config';
import {
  AnalysisClientError,
  errorFromHttpStatus,
  readFastApiDetail,
  toAnalysisClientError,
} from '@/features/analysis/api/errors';
import { parseAnalyzeAttemptResponse } from '@/features/analysis/api/parse';
import type { AnalyzeAttemptResponse } from '@/features/analysis/types';

type AnalyzeAttemptInput = {
  techniqueId: string;
  videoUri: string;
};

export async function analyzeAttempt({
  techniqueId,
  videoUri,
}: AnalyzeAttemptInput): Promise<AnalyzeAttemptResponse> {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/api/analyze-attempt`;

  let formData: FormData;
  try {
    formData = createVideoUploadForm(techniqueId, videoUri);
  } catch (error) {
    if (error instanceof AnalysisClientError) {
      throw error;
    }
    console.warn('[analysis] could not prepare video upload', error);
    throw new AnalysisClientError(
      'upload_failed',
      'The recorded video could not be prepared for upload. Please record again.',
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ANALYZE_REQUEST_TIMEOUT_MS);

  try {
    const response = await expoFetch(url, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    const body: unknown = await readJsonBody(response);

    if (!response.ok) {
      throw errorFromHttpStatus(response.status, readFastApiDetail(body));
    }

    const parsed = parseAnalyzeAttemptResponse(body);
    if (!parsed.analysisValid) {
      throw new AnalysisClientError(
        'analysis_rejected',
        parsed.failureMessage ??
          'The recording could not be measured. This is not a technique score.',
        response.status,
        parsed,
      );
    }

    return parsed;
  } catch (error) {
    if (error instanceof AnalysisClientError) {
      throw error;
    }
    console.warn('[analysis] upload failed', error);
    throw toAnalysisClientError(error);
  } finally {
    clearTimeout(timeout);
  }
}

function createVideoUploadForm(techniqueId: string, videoUri: string): FormData {
  const videoFile = new File(videoUri);

  if (!videoFile.exists) {
    throw new AnalysisClientError(
      'upload_failed',
      'The recorded video file was not found on this device. Please record again.',
    );
  }

  const formData = new FormData();
  formData.append('techniqueId', techniqueId);

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
