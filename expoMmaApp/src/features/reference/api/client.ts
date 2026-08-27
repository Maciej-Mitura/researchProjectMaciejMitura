import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';

import { getApiBaseUrl } from '@/features/analysis/api/config';
import { readFastApiDetail } from '@/features/analysis/api/errors';
import {
  REFERENCE_CONFIRM_TIMEOUT_MS,
  REFERENCE_DRAFT_TIMEOUT_MS,
  REFERENCE_LIST_TIMEOUT_MS,
} from '@/features/reference/constants';
import {
  errorFromHttpStatus,
  ReferenceClientError,
  toReferenceClientError,
} from '@/features/reference/api/errors';
import {
  parseConfirmResponse,
  parseRecordedTechniqueList,
  parseReferenceDraftResponse,
} from '@/features/reference/api/parse';
import type {
  ConfirmReferenceResponse,
  RecordedTechniqueSummary,
  ReferenceDraftResponse,
} from '@/features/reference/types';

export async function fetchRecordedTechniques(): Promise<RecordedTechniqueSummary[]> {
  const baseUrl = getApiBaseUrl();
  const response = await fetchWithTimeout(`${baseUrl}/api/reference-techniques`, {
    method: 'GET',
    timeoutMs: REFERENCE_LIST_TIMEOUT_MS,
  });
  const body: unknown = await readJsonBody(response);
  if (!response.ok) {
    throw errorFromHttpStatus(response.status, readFastApiDetail(body));
  }
  return parseRecordedTechniqueList(body);
}

export async function createReferenceDraft(input: {
  name: string;
  description: string;
  videoUri: string;
  recordingDurationSeconds: number;
}): Promise<ReferenceDraftResponse> {
  try {
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/api/reference-techniques/drafts`;
    const formData = createReferenceUploadForm(input);
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      body: formData,
      timeoutMs: REFERENCE_DRAFT_TIMEOUT_MS,
    });
    const body: unknown = await readJsonBody(response);
    if (!response.ok) {
      throw errorFromHttpStatus(response.status, readFastApiDetail(body));
    }
    const parsed = parseReferenceDraftResponse(body);
    if (!parsed.analysisValid) {
      throw new ReferenceClientError(
        'analysis_rejected',
        parsed.failureMessage ??
          'The reference recording could not be measured. This is not a technique score.',
        response.status,
        parsed,
      );
    }
    return parsed;
  } catch (error) {
    if (error instanceof ReferenceClientError) {
      throw error;
    }
    throw toReferenceClientError(error);
  }
}

export async function confirmReferenceDraft(draftId: string): Promise<ConfirmReferenceResponse> {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/api/reference-techniques/drafts/${encodeURIComponent(draftId)}/confirm`;
  try {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      timeoutMs: REFERENCE_CONFIRM_TIMEOUT_MS,
    });
    const body: unknown = await readJsonBody(response);
    if (!response.ok) {
      throw errorFromHttpStatus(response.status, readFastApiDetail(body));
    }
    return parseConfirmResponse(body);
  } catch (error) {
    throw toReferenceClientError(error);
  }
}

export async function discardReferenceDraft(draftId: string): Promise<void> {
  try {
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/api/reference-techniques/drafts/${encodeURIComponent(draftId)}`;
    await fetchWithTimeout(url, {
      method: 'DELETE',
      timeoutMs: REFERENCE_LIST_TIMEOUT_MS,
    });
  } catch {
    // Retake should still continue if the temp draft cannot be deleted.
  }
}

export async function deleteRecordedTechnique(slug: string): Promise<void> {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/api/reference-techniques/${encodeURIComponent(slug)}`;
  try {
    const response = await fetchWithTimeout(url, {
      method: 'DELETE',
      timeoutMs: REFERENCE_LIST_TIMEOUT_MS,
    });
    const body: unknown = await readJsonBody(response);
    if (!response.ok) {
      throw errorFromHttpStatus(response.status, readFastApiDetail(body));
    }
  } catch (error) {
    throw toReferenceClientError(error);
  }
}

function createReferenceUploadForm(input: {
  name: string;
  description: string;
  videoUri: string;
  recordingDurationSeconds: number;
}): FormData {
  const videoFile = new File(input.videoUri);
  if (!videoFile.exists) {
    throw new ReferenceClientError(
      'upload_failed',
      'The recorded video file was not found on this device. Please record again.',
    );
  }

  const formData = new FormData();
  formData.append('name', input.name);
  if (input.description.trim().length > 0) {
    formData.append('description', input.description.trim());
  }
  formData.append('recordingDurationSeconds', String(input.recordingDurationSeconds));

  const filename = videoFile.name.trim();
  if (filename.length > 0) {
    formData.append('video', videoFile, filename);
  } else {
    formData.append('video', videoFile);
  }
  return formData;
}

async function fetchWithTimeout(
  url: string,
  options: { method: string; body?: FormData; timeoutMs: number },
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    return await expoFetch(url, {
      method: options.method,
      body: options.body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonBody(response: { text: () => Promise<string>; status: number }): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ReferenceClientError(
      'malformed',
      'The analysis server returned an unexpected response.',
      response.status,
    );
  }
}
