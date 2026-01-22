/**
 * Types for exporting pose data and analysis results.
 * Used for persistence, AI feedback, and visualization.
 */

export type PosePoint = {
  x: number;
  y: number;
  z?: number;
  score?: number;
};

export type PoseFrameExport = {
  tMs: number; // Timestamp in milliseconds (wall clock)
  points: Record<string, PosePoint>; // Joint name -> point, e.g. "left_wrist", "right_shoulder"
};

export type AttemptExport = {
  attemptIndex: number;
  techniqueId: string;
  mirrored: boolean;
  fps: number;
  activeWindow: {
    startIdx: number;
    endIdx: number;
    startMs: number;
    endMs: number;
  };
  cameraFrames: PoseFrameExport[]; // ONLY active window, not whole attempt
  referenceFrames: PoseFrameExport[]; // ONLY active window
  featuresPerFrame?: Array<{
    tMs: number;
    leadExt: number;
    leadElbowDeg: number;
    rearGuard: number;
  }>;
  aggregates: {
    score0to100: number | null;
    perJointMaeDeg: Record<string, number | null>;
    perJointSignedDeg?: Record<string, number | null>;
    dtw: {
      pathLen: number;
      avgCost: number | null;
    };
    gates: {
      extDelta: number;
      vPeak: number;
      validFrameRatio: number;
    };
  };
};

export type SessionExport = {
  createdAtIso: string; // ISO 8601 timestamp
  techniqueId: string;
  attempts: AttemptExport[];
  summary: {
    overallScore: number | null;
    validAttemptCount: number;
    totalAttemptCount: number;
    averageScore: number | null;
  };
};

/**
 * Standard joint name mapping for consistent export.
 * Maps MediaPipe landmark indices to semantic names.
 */
export const JOINT_NAME_MAP: Record<number, string> = {
  // Face/head
  0: "nose",
  // Upper body
  11: "left_shoulder",
  12: "right_shoulder",
  13: "left_elbow",
  14: "right_elbow",
  15: "left_wrist",
  16: "right_wrist",
  // Lower body
  23: "left_hip",
  24: "right_hip",
  25: "left_knee",
  26: "right_knee",
  27: "left_ankle",
  28: "right_ankle",
};

/**
 * Standard joint names for consistent export.
 */
export const STANDARD_JOINT_NAMES = [
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
] as const;

/**
 * Get joint name from MediaPipe landmark index.
 */
export function getJointName(index: number): string {
  return JOINT_NAME_MAP[index] ?? `landmark_${index}`;
}

/**
 * Get MediaPipe landmark index from joint name (reverse lookup).
 */
export function getJointIndex(name: string): number | null {
  const entry = Object.entries(JOINT_NAME_MAP).find(([, n]) => n === name);
  return entry ? parseInt(entry[0], 10) : null;
}
