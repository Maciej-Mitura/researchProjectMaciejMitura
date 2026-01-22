import type { PoseFrame } from "@/app/components/pose/PoseCameraOverlay";
import type { ReferenceFrame } from "@/app/components/training/SceneCanvas";
import type { ComparisonResult } from "@/app/training/live-demo/page";
import type { AttemptExport, SessionExport, PoseFrameExport } from "./exportTypes";
import { getJointName, JOINT_NAME_MAP } from "./exportTypes";

export type MultiFeatureFrame = {
  wallClockMs: number;
  angles: {
    leftElbow?: number;
    rightElbow?: number;
    leftKnee?: number;
    rightKnee?: number;
    leftShoulder?: number;
    rightShoulder?: number;
  };
  leadExtension: number | null;
  rearGuardDist: number | null;
  leadArmDirAngleDeg?: number | null;
};

/**
 * Downsample frames to max 30 fps or max 120 frames.
 */
function downsampleFrames<T extends { tMs: number }>(
  frames: T[],
  maxFps: number = 30,
  maxFrames: number = 120
): T[] {
  if (frames.length <= maxFrames) return frames;

  // Calculate target interval based on maxFps
  const durationMs = frames[frames.length - 1]?.tMs - frames[0]?.tMs;
  const targetIntervalMs = 1000 / maxFps;
  const targetFrames = Math.min(maxFrames, Math.ceil(durationMs / targetIntervalMs));

  if (targetFrames >= frames.length) return frames;

  // Sample evenly
  const step = frames.length / targetFrames;
  const sampled: T[] = [];
  for (let i = 0; i < frames.length; i += step) {
    sampled.push(frames[Math.floor(i)]);
  }
  return sampled.length > 0 ? sampled : frames.slice(0, maxFrames);
}

/**
 * Convert MediaPipe landmarks to PoseFrameExport format.
 */
function landmarksToPoseFrameExport(
  frame: PoseFrame,
  mirrorX: boolean
): PoseFrameExport | null {
  if (!frame.landmarks || typeof frame.wallClockMs !== "number") return null;

  const points: Record<string, { x: number; y: number; z?: number; score?: number }> = {};

  for (const [indexStr, name] of Object.entries(JOINT_NAME_MAP)) {
    const index = parseInt(indexStr, 10);
    const landmark = frame.landmarks[index];
    if (!landmark || typeof landmark.x !== "number" || typeof landmark.y !== "number") continue;

    points[name] = {
      x: mirrorX ? -landmark.x : landmark.x,
      y: landmark.y,
      z: typeof landmark.z === "number" ? landmark.z : undefined,
      score: typeof landmark.visibility === "number" ? landmark.visibility : undefined,
    };
  }

  return {
    tMs: frame.wallClockMs,
    points,
  };
}

/**
 * Convert reference frame to PoseFrameExport format.
 */
function referenceFrameToPoseFrameExport(frame: ReferenceFrame): PoseFrameExport | null {
  if (!frame.limbPositions || typeof frame.wallClockMs !== "number") return null;

  const points: Record<string, { x: number; y: number; z?: number; score?: number }> = {};

  // Map reference limb positions to joint names
  const mappings: Array<{ key: keyof typeof frame.limbPositions; name: string }> = [
    { key: "leftShoulder", name: "left_shoulder" },
    { key: "rightShoulder", name: "right_shoulder" },
    { key: "leftElbow", name: "left_elbow" },
    { key: "rightElbow", name: "right_elbow" },
    { key: "leftWrist", name: "left_wrist" },
    { key: "rightWrist", name: "right_wrist" },
    { key: "leftHip", name: "left_hip" },
    { key: "rightHip", name: "right_hip" },
    { key: "leftKnee", name: "left_knee" },
    { key: "rightKnee", name: "right_knee" },
    { key: "leftAnkle", name: "left_ankle" },
    { key: "rightAnkle", name: "right_ankle" },
  ];

  for (const { key, name } of mappings) {
    const pos = frame.limbPositions[key];
    if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
      points[name] = {
        x: pos.x,
        y: pos.y,
        z: typeof pos.z === "number" ? pos.z : undefined,
      };
    }
  }

  return {
    tMs: frame.wallClockMs,
    points,
  };
}

/**
 * Build AttemptExport from attempt data and result.
 */
export function buildAttemptExport(
  attemptIndex: number,
  techniqueId: string,
  mirrored: boolean,
  cameraFrames: PoseFrame[],
  refFrames: ReferenceFrame[],
  result: ComparisonResult | null,
  activeWindow: { startIdx: number; endIdx: number; startMs: number | null; endMs: number | null } | null,
  cameraSeq?: MultiFeatureFrame[],
  refSeq?: MultiFeatureFrame[],
  leadSide?: "left" | "right"
): AttemptExport | null {
  if (!activeWindow || activeWindow.startIdx < 0 || activeWindow.endIdx < 0) return null;

  // Extract active window frames
  const activeCameraFrames = cameraFrames.slice(activeWindow.startIdx, activeWindow.endIdx + 1);
  const activeRefFrames = refFrames.filter(
    (f) =>
      typeof f.wallClockMs === "number" &&
      (activeWindow.startMs == null || f.wallClockMs >= activeWindow.startMs - 200) &&
      (activeWindow.endMs == null || f.wallClockMs <= activeWindow.endMs + 200)
  );

  // Convert to export format
  const cameraExports: PoseFrameExport[] = activeCameraFrames
    .map((f) => landmarksToPoseFrameExport(f, mirrored))
    .filter((f): f is PoseFrameExport => f != null);

  const refExports: PoseFrameExport[] = activeRefFrames
    .map((f) => referenceFrameToPoseFrameExport(f))
    .filter((f): f is PoseFrameExport => f != null);

  // Downsample
  const cameraExportsDownsampled = downsampleFrames(cameraExports);
  const refExportsDownsampled = downsampleFrames(refExports);

  // Estimate fps from frame timestamps
  const fps =
    cameraExportsDownsampled.length >= 2
      ? Math.round(
          (1000 * (cameraExportsDownsampled.length - 1)) /
            (cameraExportsDownsampled[cameraExportsDownsampled.length - 1]?.tMs -
              cameraExportsDownsampled[0]?.tMs)
        ) || 15
      : 15;

  // Extract features per frame from camera sequence (if available)
  const featuresPerFrame: Array<{
    tMs: number;
    leadExt: number;
    leadElbowDeg: number;
    rearGuard: number;
  }> = [];

  if (cameraSeq && leadSide) {
    const leadElbowKey = leadSide === "left" ? "leftElbow" : "rightElbow";
    for (const frame of cameraSeq) {
      const leadExt = frame.leadExtension;
      const leadElbow = frame.angles[leadElbowKey];
      const rearGuard = frame.rearGuardDist;

      if (
        typeof frame.wallClockMs === "number" &&
        typeof leadExt === "number" &&
        Number.isFinite(leadExt) &&
        typeof leadElbow === "number" &&
        Number.isFinite(leadElbow) &&
        typeof rearGuard === "number" &&
        Number.isFinite(rearGuard)
      ) {
        featuresPerFrame.push({
          tMs: frame.wallClockMs,
          leadExt,
          leadElbowDeg: leadElbow,
          rearGuard,
        });
      }
    }
  }

  // Build aggregates
  const perJointMaeDeg: Record<string, number | null> = {};
  const perJointSignedDeg: Record<string, number | null> = {};

  if (result) {
    // Map angle keys to joint names
    const angleKeyToJoint: Record<string, string> = {
      leftElbow: "left_elbow",
      rightElbow: "right_elbow",
      leftKnee: "left_knee",
      rightKnee: "right_knee",
      leftShoulder: "left_shoulder",
      rightShoulder: "right_shoulder",
    };

    for (const row of result.rows) {
      const jointName = angleKeyToJoint[row.key] ?? row.key;
      perJointMaeDeg[jointName] = row.deltaDeg;
      perJointSignedDeg[jointName] = row.signedErrorDeg;
    }
  }

  return {
    attemptIndex,
    techniqueId,
    mirrored,
    fps,
    activeWindow: {
      startIdx: activeWindow.startIdx,
      endIdx: activeWindow.endIdx,
      startMs: activeWindow.startMs ?? 0,
      endMs: activeWindow.endMs ?? 0,
    },
    cameraFrames: cameraExportsDownsampled,
    referenceFrames: refExportsDownsampled,
    featuresPerFrame: featuresPerFrame.length > 0 ? featuresPerFrame : undefined,
    aggregates: {
      score0to100: result?.score0to100 ?? null,
      perJointMaeDeg,
      perJointSignedDeg: Object.keys(perJointSignedDeg).length > 0 ? perJointSignedDeg : undefined,
      dtw: {
        pathLen: result?.dtw?.pathLength ?? 0,
        avgCost: result?.dtw?.avgCost ?? null,
      },
      gates: {
        extDelta: result?.debug?.extDelta ?? 0,
        vPeak: 0, // Not used for fixed-duration attempts
        validFrameRatio: result?.validation?.validityRatio ?? 0,
      },
    },
  };
}

/**
 * Build SessionExport from all attempts.
 */
export function buildSessionExport(
  techniqueId: string,
  attempts: Array<{
    attemptIndex: number;
    cameraFrames: PoseFrame[];
    refFrames: ReferenceFrame[];
    result: ComparisonResult | null;
    valid: boolean;
    cameraSeq?: MultiFeatureFrame[];
    refSeq?: MultiFeatureFrame[];
    leadSide?: "left" | "right";
  }>,
  mirrored: boolean
): SessionExport {
  const attemptExports: AttemptExport[] = [];

  for (const attempt of attempts) {
    const activeWindow = attempt.result?.debug
      ? {
          startIdx: attempt.result.debug.activeWindowStartIdx ?? 0,
          endIdx: attempt.result.debug.activeWindowEndIdx ?? attempt.cameraFrames.length - 1,
          startMs: attempt.result.debug.activeWindowStartMs ?? null,
          endMs: attempt.result.debug.activeWindowEndMs ?? null,
        }
      : null;

    const exportData = buildAttemptExport(
      attempt.attemptIndex,
      techniqueId,
      mirrored,
      attempt.cameraFrames,
      attempt.refFrames,
      attempt.result,
      activeWindow,
      attempt.cameraSeq,
      attempt.refSeq,
      attempt.leadSide
    );

    if (exportData) {
      attemptExports.push(exportData);
    }
  }

  const validAttempts = attemptExports.filter((a) => a.aggregates.score0to100 != null);
  const scores = validAttempts
    .map((a) => a.aggregates.score0to100)
    .filter((s): s is number => typeof s === "number" && Number.isFinite(s));

  return {
    createdAtIso: new Date().toISOString(),
    techniqueId,
    attempts: attemptExports,
    summary: {
      overallScore: scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      validAttemptCount: validAttempts.length,
      totalAttemptCount: attemptExports.length,
      averageScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    },
  };
}

/**
 * Download JSON file.
 */
export function downloadJSON(data: unknown, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Convert SessionExport to CSV format (joints data).
 */
export function exportToCSVJoints(session: SessionExport): string {
  const rows: string[] = [];
  rows.push("tMs,jointName,x,y,z,score,source,attemptIndex");

  for (const attempt of session.attempts) {
    // Camera frames
    for (const frame of attempt.cameraFrames) {
      for (const [jointName, point] of Object.entries(frame.points)) {
        rows.push(
          `${frame.tMs},${jointName},${point.x},${point.y},${point.z ?? ""},${point.score ?? ""},camera,${attempt.attemptIndex}`
        );
      }
    }

    // Reference frames
    for (const frame of attempt.referenceFrames) {
      for (const [jointName, point] of Object.entries(frame.points)) {
        rows.push(
          `${frame.tMs},${jointName},${point.x},${point.y},${point.z ?? ""},${point.score ?? ""},reference,${attempt.attemptIndex}`
        );
      }
    }
  }

  return rows.join("\n");
}

/**
 * Convert SessionExport to CSV format (features data).
 */
export function exportToCSVFeatures(session: SessionExport): string {
  const rows: string[] = [];
  rows.push("tMs,leadExt,leadElbowDeg,rearGuard,attemptIndex,source");

  for (const attempt of session.attempts) {
    if (attempt.featuresPerFrame) {
      for (const feature of attempt.featuresPerFrame) {
        rows.push(
          `${feature.tMs},${feature.leadExt},${feature.leadElbowDeg},${feature.rearGuard},${attempt.attemptIndex},camera`
        );
      }
    }
  }

  return rows.join("\n");
}

/**
 * Download CSV file.
 */
export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
