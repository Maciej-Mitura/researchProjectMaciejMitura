import type {
  ConfirmReferenceResponse,
  MovementWindow,
  RecordedTechniqueSummary,
  ReferenceDebug,
  ReferenceDraftResponse,
  ReferenceKeyframe,
} from '@/features/reference/types';
import { ReferenceClientError } from '@/features/reference/api/errors';
import type { VideoMetadata } from '@/features/analysis/types';

export function parseRecordedTechniqueList(value: unknown): RecordedTechniqueSummary[] {
  if (!Array.isArray(value)) {
    throw malformed();
  }
  return value.map(parseRecordedTechniqueSummary);
}

export function parseRecordedTechniqueSummary(value: unknown): RecordedTechniqueSummary {
  if (!isRecord(value)) {
    throw malformed();
  }
  return {
    id: requireString(value, 'id'),
    slug: requireString(value, 'slug'),
    name: requireString(value, 'name'),
    description: optionalString(value.description),
    source: 'recorded',
    referenceStatus: 'available',
    createdAt: requireString(value, 'createdAt'),
    referenceStrategy: requireString(value, 'referenceStrategy'),
    keyframeCount: requireNumber(value, 'keyframeCount'),
    recordingDurationSeconds: optionalNumber(value.recordingDurationSeconds),
  };
}

export function parseConfirmResponse(value: unknown): ConfirmReferenceResponse {
  if (!isRecord(value) || !('technique' in value)) {
    throw malformed();
  }
  return { technique: parseRecordedTechniqueSummary(value.technique) };
}

export function parseReferenceDraftResponse(value: unknown): ReferenceDraftResponse {
  if (!isRecord(value)) {
    throw malformed();
  }
  return {
    draftId: requireString(value, 'draftId'),
    name: requireString(value, 'name'),
    description: optionalString(value.description),
    slug: requireString(value, 'slug'),
    analysisValid: requireBoolean(value, 'analysisValid'),
    failureReason: optionalString(value.failureReason),
    failureMessage: optionalString(value.failureMessage),
    video: parseVideo(value.video),
    poseCoverage: optionalNumber(value.poseCoverage),
    majorLandmarkCoverage: optionalNumber(value.majorLandmarkCoverage),
    movementWindow: parseWindow(value.movementWindow),
    keyframes: parseKeyframes(value.keyframes),
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

function parseWindow(value: unknown): MovementWindow | null {
  if (value == null) {
    return null;
  }
  if (!isRecord(value)) {
    throw malformed();
  }
  return {
    startMs: requireNumber(value, 'startMs'),
    endMs: requireNumber(value, 'endMs'),
    durationMs: requireNumber(value, 'durationMs'),
  };
}

function parseKeyframes(value: unknown): ReferenceKeyframe[] | null {
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
      filename: requireString(item, 'filename'),
      url: optionalString(item.url),
    };
  });
}

function parseDebug(value: unknown): ReferenceDebug | null {
  if (value == null) {
    return null;
  }
  if (!isRecord(value)) {
    throw malformed();
  }
  return {
    strategy: requireString(value, 'strategy'),
    baseline: optionalNumber(value.baseline),
    peakMotion: optionalNumber(value.peakMotion),
    motionDelta: optionalNumber(value.motionDelta),
    smoothingMethod: requireString(value, 'smoothingMethod'),
    smoothingWindow: requireNumber(value, 'smoothingWindow'),
    fpsFallbackUsed: requireBoolean(value, 'fpsFallbackUsed'),
    majorLandmarkCoverage: optionalNumber(value.majorLandmarkCoverage),
    draftDir: optionalString(value.draftDir),
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

function malformed(): ReferenceClientError {
  return new ReferenceClientError(
    'malformed',
    'The analysis server returned an unexpected response.',
  );
}
