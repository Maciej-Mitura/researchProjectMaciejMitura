import { AnalysisClientError } from '@/features/analysis/api/errors';
import type {
  AnalysisDebug,
  AnalyzeAttemptResponse,
  DetectedPhase,
  VideoMetadata,
} from '@/features/analysis/types';

export function parseAnalyzeAttemptResponse(value: unknown): AnalyzeAttemptResponse {
  if (!isRecord(value)) {
    throw malformed();
  }

  return {
    analysisId: requireString(value, 'analysisId'),
    techniqueId: requireString(value, 'techniqueId'),
    analysisValid: requireBoolean(value, 'analysisValid'),
    failureReason: optionalString(value.failureReason),
    failureMessage: optionalString(value.failureMessage),
    video: parseVideo(value.video),
    poseCoverage: optionalNumber(value.poseCoverage),
    phases: parsePhases(value.phases),
    debug: parseDebug(value.debug),
  };
}

function parseVideo(value: unknown): VideoMetadata | null {
  if (value == null) {
    return null;
  }
  if (!isRecord(value)) {
    throw malformed();
  }
  return {
    fps: requireNumber(value, 'fps'),
    durationMs: requireNumber(value, 'durationMs'),
    width: requireNumber(value, 'width'),
    height: requireNumber(value, 'height'),
    frameCount: requireNumber(value, 'frameCount'),
  };
}

function parsePhases(value: unknown): DetectedPhase[] | null {
  if (value == null) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw malformed();
  }
  return value.map((item) => {
    if (!isRecord(item)) {
      throw malformed();
    }
    return {
      phase: requireString(item, 'phase'),
      frameIndex: requireNumber(item, 'frameIndex'),
      timestampMs: requireNumber(item, 'timestampMs'),
      keyframeFilename: optionalString(item.keyframeFilename),
      keyframeUrl: optionalString(item.keyframeUrl),
    };
  });
}

function parseDebug(value: unknown): AnalysisDebug | null {
  if (value == null) {
    return null;
  }
  if (!isRecord(value)) {
    throw malformed();
  }
  return {
    leadSide: requireString(value, 'leadSide'),
    baseline: optionalNumber(value.baseline),
    peakExtension: optionalNumber(value.peakExtension),
    extensionDelta: optionalNumber(value.extensionDelta),
    smoothingMethod: requireString(value, 'smoothingMethod'),
    smoothingWindow: requireNumber(value, 'smoothingWindow'),
    fpsFallbackUsed: requireBoolean(value, 'fpsFallbackUsed'),
    keyLandmarkCoverage: optionalNumber(value.keyLandmarkCoverage),
    keyframeDir: optionalString(value.keyframeDir),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw malformed();
  }
  return value;
}

function requireBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw malformed();
  }
  return value;
}

function requireNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw malformed();
  }
  return value;
}

function optionalString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw malformed();
  }
  return value;
}

function optionalNumber(value: unknown): number | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw malformed();
  }
  return value;
}

function malformed(): AnalysisClientError {
  return new AnalysisClientError(
    'malformed',
    'The analysis server returned an unexpected response.',
  );
}
