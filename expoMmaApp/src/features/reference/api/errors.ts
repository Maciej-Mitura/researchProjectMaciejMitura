import { AnalysisClientError } from '@/features/analysis/api/errors';
import type { ReferenceDraftResponse, ReferenceErrorCode } from '@/features/reference/types';

export class ReferenceClientError extends Error {
  readonly code: ReferenceErrorCode;
  readonly status: number | null;
  readonly draft: ReferenceDraftResponse | null;

  constructor(
    code: ReferenceErrorCode,
    message: string,
    status: number | null = null,
    draft: ReferenceDraftResponse | null = null,
  ) {
    super(message);
    this.name = 'ReferenceClientError';
    this.code = code;
    this.status = status;
    this.draft = draft;
  }
}

export function toReferenceClientError(error: unknown): ReferenceClientError {
  if (error instanceof ReferenceClientError) {
    return error;
  }

  if (error instanceof AnalysisClientError) {
    return new ReferenceClientError(mapAnalysisCode(error.code), error.message, error.status);
  }

  if (isAbortError(error)) {
    return new ReferenceClientError(
      'timeout',
      'Reference analysis took too long. Check that the backend is running and try again.',
    );
  }

  const message = error instanceof Error ? error.message : '';
  const lower = message.toLowerCase();
  if (
    lower.includes('network request failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror')
  ) {
    return new ReferenceClientError(
      'unreachable',
      'Could not reach the analysis server. Make sure your phone and computer are on the same network and the backend is running.',
    );
  }

  return new ReferenceClientError(
    'upload_failed',
    'The reference request failed. Please try again.',
  );
}

export function errorFromHttpStatus(status: number, detail: string | null): ReferenceClientError {
  if (status === 400) {
    return new ReferenceClientError(
      'http_400',
      detail ?? 'The reference could not be accepted. Check the name and try recording again.',
      status,
    );
  }

  if (status === 403) {
    return new ReferenceClientError(
      'builtin_protected',
      detail ?? 'Built-in techniques cannot be deleted.',
      status,
    );
  }

  if (status === 404) {
    return new ReferenceClientError(
      'technique_not_found',
      detail ?? 'Recorded reference technique not found.',
      status,
    );
  }

  if (status === 409) {
    return new ReferenceClientError(
      'duplicate_technique',
      detail ?? 'A technique with this name already exists. Choose a different name.',
      status,
    );
  }

  if (status === 413) {
    return new ReferenceClientError(
      'http_413',
      detail ?? 'The video file is too large to upload.',
      status,
    );
  }

  if (status === 422) {
    return new ReferenceClientError(
      'http_422',
      detail ?? 'The server could not process this reference.',
      status,
    );
  }

  if (status >= 500) {
    return new ReferenceClientError(
      'http_500',
      detail ?? 'The analysis server had an error. Try again.',
      status,
    );
  }

  return new ReferenceClientError(
    'http_other',
    detail ?? `The analysis server returned HTTP ${status}.`,
    status,
  );
}

function mapAnalysisCode(code: AnalysisClientError['code']): ReferenceErrorCode {
  if (
    code === 'missing_api_url' ||
    code === 'unreachable' ||
    code === 'upload_failed' ||
    code === 'timeout' ||
    code === 'analysis_rejected' ||
    code === 'http_400' ||
    code === 'http_413' ||
    code === 'http_422' ||
    code === 'http_500' ||
    code === 'http_other' ||
    code === 'malformed'
  ) {
    return code;
  }
  return 'http_other';
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const name = 'name' in error && typeof error.name === 'string' ? error.name : '';
  return name === 'AbortError' || name === 'TimeoutError';
}
