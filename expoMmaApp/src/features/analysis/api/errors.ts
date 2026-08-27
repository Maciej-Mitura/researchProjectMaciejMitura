import type {
  AnalysisErrorCode,
  AnalysisFailure,
  AnalyzeAttemptResponse,
} from '@/features/analysis/types';
import type { AnalyzeGenericAttemptResponse } from '@/features/comparison/types';

export class AnalysisClientError extends Error {
  readonly code: AnalysisErrorCode;
  readonly status: number | null;
  readonly analysis: AnalyzeAttemptResponse | null;
  readonly comparison: AnalyzeGenericAttemptResponse | null;

  constructor(
    code: AnalysisErrorCode,
    message: string,
    status: number | null = null,
    analysis: AnalyzeAttemptResponse | null = null,
    comparison: AnalyzeGenericAttemptResponse | null = null,
  ) {
    super(message);
    this.name = 'AnalysisClientError';
    this.code = code;
    this.status = status;
    this.analysis = analysis;
    this.comparison = comparison;
  }

  toFailure(): AnalysisFailure {
    return {
      code: this.code,
      message: this.message,
      status: this.status,
    };
  }
}

export function toAnalysisClientError(error: unknown): AnalysisClientError {
  if (error instanceof AnalysisClientError) {
    return error;
  }

  if (isAbortError(error)) {
    return new AnalysisClientError(
      'timeout',
      'Analysis took too long. Check that the backend is running and try again.',
    );
  }

  if (isUploadConstructionError(error)) {
    return new AnalysisClientError(
      'upload_failed',
      'The recorded video could not be uploaded. Please try recording again.',
    );
  }

  if (isMalformedApiUrlError(error)) {
    return new AnalysisClientError(
      'missing_api_url',
      'Analysis server address is missing http://. Set EXPO_PUBLIC_API_BASE_URL to http://YOUR_LAN_IP:8000 and restart Expo.',
    );
  }

  if (isNetworkError(error)) {
    return new AnalysisClientError(
      'unreachable',
      'Could not reach the analysis server. Make sure your phone and computer are on the same network and the backend is running.',
    );
  }

  return new AnalysisClientError(
    'upload_failed',
    'The analysis request failed before the server could process the video. Please try again.',
  );
}

export function errorFromHttpStatus(status: number, detail: string | null): AnalysisClientError {
  if (status === 400) {
    return new AnalysisClientError(
      'http_400',
      detail ?? 'The video could not be accepted. Try recording again.',
      status,
    );
  }

  if (status === 413) {
    return new AnalysisClientError(
      'http_413',
      detail ?? 'The video file is too large to upload.',
      status,
    );
  }

  if (status === 422) {
    return new AnalysisClientError(
      'http_422',
      detail ?? 'This technique cannot be analyzed yet.',
      status,
    );
  }

  if (status >= 500) {
    return new AnalysisClientError(
      'http_500',
      detail ?? 'The analysis server had an error. Try again.',
      status,
    );
  }

  return new AnalysisClientError(
    'http_other',
    detail ?? `The analysis server returned HTTP ${status}.`,
    status,
  );
}

export function readFastApiDetail(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('detail' in body)) {
    return null;
  }

  const detail = (body as { detail: unknown }).detail;
  if (typeof detail === 'string' && detail.length > 0) {
    return detail;
  }

  return null;
}

export function shouldOfferAnalysisServerCheck(code: AnalysisErrorCode | null): boolean {
  return code === 'unreachable' || code === 'missing_api_url';
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const name = 'name' in error && typeof error.name === 'string' ? error.name : '';
  return name === 'AbortError' || name === 'TimeoutError';
}

function isUploadConstructionError(error: unknown): boolean {
  const message = rawErrorMessage(error).toLowerCase();
  if (message.length === 0) {
    return false;
  }

  return (
    message.includes('formdatapart') ||
    message.includes('form-data') ||
    (message.includes('formdata') && message.includes('unsupported'))
  );
}

function isMalformedApiUrlError(error: unknown): boolean {
  const message = rawErrorMessage(error).toLowerCase();
  if (message.length === 0) {
    return false;
  }

  return (
    message.includes('no protocol') ||
    message.includes('malformedurl') ||
    message.includes('malformed url')
  );
}

function isNetworkError(error: unknown): boolean {
  const message = rawErrorMessage(error).toLowerCase();
  if (message.length === 0) {
    return false;
  }

  return (
    message.includes('network request failed') ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('econnreset') ||
    message.includes('connection refused') ||
    message.includes('could not connect')
  );
}

function rawErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return '';
}
