"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import SceneCanvas from "@/app/components/training/SceneCanvas";
import type { ReferenceFrame } from "@/app/components/training/SceneCanvas";
import { getTechniqueById, type Technique } from "@/app/lib/techniques";
import { angleDeg3 } from "@/app/lib/scoring/geometry";
import type { PoseCameraOverlayHandle, PoseFrame } from "@/app/components/pose/PoseCameraOverlay";
import { buildSessionExport, downloadJSON, downloadCSV, exportToCSVJoints, exportToCSVFeatures } from "@/app/lib/pose/exportData";
import { buildFeedbackSummary } from "@/app/lib/pose/feedbackSummary";
import { PoseComparisonCharts } from "@/app/components/analytics/PoseComparisonCharts";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

// Keep camera/mediapipe out of SSR/bundles where possible
const PoseCameraOverlay = dynamic(() => import("@/app/components/pose/PoseCameraOverlay").then((mod) => ({ default: mod.PoseCameraOverlay })), { ssr: false });

type Phase = "idle" | "countdown" | "attempt_recording" | "results";
type CountdownStep = 3 | 2 | 1 | "GO";

// Fixed-duration attempt configuration
const ATTEMPT_DURATION_MS = 3000; // 3 seconds per attempt

const MAX_POSE_BUFFER_MS = 10_000; // keep last 10s of frames in memory
const MAX_REFERENCE_BUFFER_MS = 10_000; // keep last 10s of reference frames in memory

type MultiFeatureFrame = {
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

type AttemptData = {
  attemptIndex: number;
  cameraFrames: PoseFrame[];
  refFrames: ReferenceFrame[];
  startWallClockMs: number;
  endWallClockMs: number | null;
  result?: ComparisonResult;
  valid: boolean;
  cameraSeq?: MultiFeatureFrame[]; // Feature sequence for active window
  refSeq?: MultiFeatureFrame[]; // Reference feature sequence for active window
  leadSide?: "left" | "right"; // Lead side for this attempt
};

type AngleKey = "leftElbow" | "rightElbow" | "leftKnee" | "rightKnee" | "leftShoulder" | "rightShoulder";
type AngleSample = Partial<Record<AngleKey, number>>;

type AngleDeltaRow = {
  key: AngleKey;
  label: string;
  actualDeg: number | null;
  idealDeg: number | null;
  deltaDeg: number | null;
  signedErrorDeg: number | null;
};

type WorstJointHint = {
  key: AngleKey;
  label: string;
  avgErrorDeg: number;
  hint: string;
};

type ComparisonResult = {
  message?: string;
  score0to100: number | null;
  rows: AngleDeltaRow[];
  worstJoints: WorstJointHint[];
  frameCount: number;
  matchedCount: number;
  durationMs: number | null;
  perAttempt?: Array<{
    attemptIndex: number;
    score0to100: number | null;
    valid: boolean;
    message?: string;
    frameCount: number;
  }>;
  validation?: {
    validityRatio: number; // 0..1
    motionEnergy: number; // body-relative units/sec
  };
  featureErrors?: {
    leadElbowMaeDeg?: number | null;
    rearElbowMaeDeg?: number | null;
    elbowMaeDeg?: number | null; // Legacy (for backward compatibility)
    extensionMae: number | null;
    guardMae: number | null;
    shoulderMaeDeg: number | null;
  };
  // Feature sequences for export/visualization (stored during scoring)
  cameraSeq?: MultiFeatureFrame[];
  refSeq?: MultiFeatureFrame[];
  debug?: {
    leadSide: "left" | "right";
    cameraMirrored: boolean;
    cameraPeakExtension: number | null;
    referencePeakExtension: number | null;
    extensionThreshold?: number | null;
    extensionPass?: boolean | null;
    cameraElbow?: {
      left?: { min: number; max: number };
      right?: { min: number; max: number };
    };
    referenceElbow?: {
      left?: { min: number; max: number };
      right?: { min: number; max: number };
    };
    activeWindowStartIdx?: number | null;
    activeWindowEndIdx?: number | null;
    activeWindowDurationMs?: number | null;
    activeWindowFrameCount?: number;
    totalFrameCount?: number;
    peakVelocity?: number | null;
    activeWindowStartMs?: number | null;
    activeWindowEndMs?: number | null;
    activeWindowRefStartMs?: number | null;
    activeWindowRefEndMs?: number | null;
    extBaseline?: number | null;
    extPeak?: number | null;
    extDelta?: number | null;
    extDeltaMin?: number | null; // Adaptive threshold (max(0.12, referenceExtDelta * 0.35))
    referenceExtDelta?: number | null; // Reference extDelta computed with same baseline method
    referenceExtBaseline?: number | null; // Reference baseline (lowest 20%)
    peakIdx?: number | null;
    windowThresholdStart?: number | null; // 0.25 fraction
    windowThresholdEnd?: number | null; // 0.35 fraction
    guardCameraAvg?: number | null;
    guardRefAvg?: number | null;
    leadWristName?: string; // e.g., "left_wrist" or "right_wrist"
    leadShoulderName?: string; // e.g., "left_shoulder" or "right_shoulder"
    // Gate metrics for tuning thresholds
    gateMetrics?: {
      extDelta: number;
      vPeak: number;
      validFrameRatio: number;
      extBaseline: number;
      extPeak: number;
      extDeltaThreshold: number; // EXT_MIN_DELTA
      vPeakThreshold: number; // VEL_MIN
      validFrameRatioThreshold: number; // MIN_VALID_FRAME_RATIO
    };
  };
  penalties?: Array<{ key: string; amount: number; reason: string }>;
  dtw?: {
    enabled: boolean;
    pathLength: number;
    avgCost: number | null;
    cameraSeqLen: number;
    referenceSeqLen: number;
  };
};

const ANGLE_LABELS: Record<AngleKey, string> = {
  leftElbow: "Left elbow",
  rightElbow: "Right elbow",
  leftKnee: "Left knee",
  rightKnee: "Right knee",
  leftShoulder: "Left shoulder",
  rightShoulder: "Right shoulder",
};

// Angle calculation is centralized in `angleDeg3` (0..180, 3D).

function normalizeLandmarkPoints(
  landmarks: any,
  opts?: {
    /**
     * If the camera display is mirrored, mirror coordinates only (do NOT swap landmark indices).
     * Applied in normalized body-relative coordinates.
     */
    mirrorX?: boolean;
  }
): ((i: number) => { x: number; y: number; z: number } | null) {
  // Normalize to body-relative *3D* coordinates:
  // - translate in 3D to mid-hips
  // - scale in 3D by hip->shoulder distance (reduces distance-to-camera effects)
  // - optionally rotate about the Z axis to make shoulders horizontal in the x/y plane
  const ROTATE_SHOULDERS_HORIZONTAL = true;
  const MIRROR_X = !!opts?.mirrorX;
  const raw = (i: number) => {
    const p = landmarks?.[i];
    if (!p || typeof p.x !== "number" || typeof p.y !== "number") return null;
    return { x: p.x, y: p.y, z: typeof p.z === "number" ? p.z : 0 };
  };

  const lHip = raw(23);
  const rHip = raw(24);
  const lShoulder = raw(11);
  const rShoulder = raw(12);

  if (!lHip || !rHip || !lShoulder || !rShoulder) {
    return raw;
  }

  const hipCenter = { x: (lHip.x + rHip.x) / 2, y: (lHip.y + rHip.y) / 2, z: (lHip.z + rHip.z) / 2 };
  const shoulderCenter = { x: (lShoulder.x + rShoulder.x) / 2, y: (lShoulder.y + rShoulder.y) / 2, z: (lShoulder.z + rShoulder.z) / 2 };

  const scale = dist3(hipCenter, shoulderCenter);
  const invScale = scale > 1e-6 ? 1 / scale : 1;

  // Rotation about Z to align shoulder line horizontally in x/y.
  // This is a 3D transform (z remains unchanged by a Z-axis rotation).
  const ls0 = { x: (lShoulder.x - hipCenter.x) * invScale, y: (lShoulder.y - hipCenter.y) * invScale };
  const rs0 = { x: (rShoulder.x - hipCenter.x) * invScale, y: (rShoulder.y - hipCenter.y) * invScale };
  const dx = rs0.x - ls0.x;
  const dy = rs0.y - ls0.y;
  const rot = ROTATE_SHOULDERS_HORIZONTAL ? -Math.atan2(dy, dx) : 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);

  return (i: number) => {
    const p = raw(i);
    if (!p) return null;
    const x0 = (p.x - hipCenter.x) * invScale;
    const y0 = (p.y - hipCenter.y) * invScale;
    const z0 = (p.z - hipCenter.z) * invScale;

    const x1 = x0 * cos - y0 * sin;
    const y1 = x0 * sin + y0 * cos;
    return { x: MIRROR_X ? -x1 : x1, y: y1, z: z0 };
  };
}

function extractAnglesFromLandmarks(
  landmarks: any,
  opts?: {
    mirrorX?: boolean;
  }
): AngleSample {
  // MediaPipe Pose landmarks indices:
  // 11 LShoulder, 13 LElbow, 15 LWrist
  // 12 RShoulder, 14 RElbow, 16 RWrist
  // 23 LHip, 25 LKnee, 27 LAnkle
  // 24 RHip, 26 RKnee, 28 RAnkle
  // Shoulder angle approximation:
  // Left: LHip -> LShoulder -> LElbow
  // Right: RHip -> RShoulder -> RElbow
  const get = normalizeLandmarkPoints(landmarks, opts);

  const ls = get(11), le = get(13), lw = get(15);
  const rs = get(12), re = get(14), rw = get(16);
  const lh = get(23), lk = get(25), la = get(27);
  const rh = get(24), rk = get(26), ra = get(28);

  const out: AngleSample = {};
  if (ls && le && lw) out.leftElbow = angleDeg3(ls, le, lw);
  if (rs && re && rw) out.rightElbow = angleDeg3(rs, re, rw);
  if (lh && lk && la) out.leftKnee = angleDeg3(lh, lk, la);
  if (rh && rk && ra) out.rightKnee = angleDeg3(rh, rk, ra);
  if (lh && ls && le) out.leftShoulder = angleDeg3(lh, ls, le);
  if (rh && rs && re) out.rightShoulder = angleDeg3(rh, rs, re);

  // Filter NaNs
  (Object.keys(out) as AngleKey[]).forEach((k) => {
    const v = out[k];
    if (typeof v === "number" && !Number.isFinite(v)) {
      delete out[k];
    }
  });

  return out;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = values.reduce((acc, v) => acc + v, 0);
  return s / values.length;
}

function hintForJoint(key: AngleKey, signedErrorDeg: number): string {
  const side = key.startsWith("left") ? "left" : "right";
  const direction = signedErrorDeg < 0 ? "smaller" : "larger"; // camera - ref

  switch (key) {
    case "leftElbow":
    case "rightElbow":
      // Elbow angle: smaller => more bent; larger => more straight
      return direction === "smaller"
        ? `Extend your ${side} arm more (open the elbow).`
        : `Bend your ${side} elbow a bit more.`;

    case "leftKnee":
    case "rightKnee":
      // Knee angle: smaller => more bent; larger => more straight
      return direction === "smaller"
        ? `Straighten your ${side} leg slightly (reduce knee bend).`
        : `Bend your ${side} knee slightly more.`;

    case "leftShoulder":
    case "rightShoulder":
      // Shoulder angle here is hip->shoulder->elbow (very approximate)
      return direction === "smaller"
        ? `Lift your ${side} arm/elbow a bit more.`
        : `Lower your ${side} arm/elbow slightly.`;
  }
}

const REF_VECTOR_ORDER: AngleKey[] = ["leftElbow", "rightElbow", "leftKnee", "rightKnee", "leftShoulder", "rightShoulder"];

function anglesFromReferenceVector(vec: number[] | null | undefined): AngleSample {
  const out: AngleSample = {};
  if (!vec || vec.length < REF_VECTOR_ORDER.length) return out;
  REF_VECTOR_ORDER.forEach((k, i) => {
    const v = vec[i];
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = v;
    }
  });
  return out;
}

function closestByWallClockMs<T extends { wallClockMs: number }>(frames: T[], t: number): T | null {
  if (frames.length === 0) return null;
  let best: T = frames[0];
  let bestD = Math.abs(frames[0].wallClockMs - t);
  for (let i = 1; i < frames.length; i += 1) {
    const d = Math.abs(frames[i].wallClockMs - t);
    if (d < bestD) {
      best = frames[i];
      bestD = d;
    }
  }
  return best;
}

function dist3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function sub3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function norm3(a: { x: number; y: number; z: number }): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

function angleBetweenDeg(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number | null {
  const na = norm3(a);
  const nb = norm3(b);
  if (na <= 1e-9 || nb <= 1e-9) return null;
  const cos = Math.min(1, Math.max(-1, dot3(a, b) / (na * nb)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function computeValidityRatio(frames: PoseFrame[]): number {
  if (frames.length === 0) return 0;
  // A frame is "valid" if we have key landmarks required for normalization + angles.
  const required = [11, 12, 23, 24, 15, 16]; // shoulders, hips, wrists
  let ok = 0;
  for (const f of frames) {
    const lm = f.landmarks;
    if (!lm) continue;
    let hasAll = true;
    for (const idx of required) {
      const p = lm[idx];
      if (!p || typeof p.x !== "number" || typeof p.y !== "number") {
        hasAll = false;
        break;
      }
    }
    if (hasAll) ok += 1;
  }
  return ok / frames.length;
}

/**
 * Attempt quality gate: validates that a technique attempt has sufficient motion.
 * 
 * CRITICAL: If extDelta is small OR vPeak is small => invalid attempt => score 0 (not 35).
 * This prevents "doing nothing" from producing non-zero scores.
 * 
 * Returns { valid: boolean, message?: string, metrics: {...} }
 */
function validateAttemptQuality(
  frames: PoseFrame[],
  leadSide: "left" | "right",
  mirrorX: boolean
): {
  valid: boolean;
  message?: string;
  metrics: {
    extDelta: number;
    vPeak: number;
    validFrameRatio: number;
    extBaseline: number;
    extPeak: number;
  };
} {
  // Thresholds: if any of these fail, attempt is invalid => score 0
  // These can be tuned based on reference ranges if available, otherwise use conservative defaults
  const EXT_MIN_DELTA = 0.20; // Minimum extension peak-to-baseline delta (dimensionless, normalized by torso length)
  const VEL_MIN = 0.10; // Minimum lead-wrist speed peak (normalized units/sec)
  const MIN_VALID_FRAME_RATIO = 0.7; // Minimum valid frame ratio (0..1)

  if (frames.length < 3) {
    return {
      valid: false,
      message: "No technique attempt detected (not enough frames).",
      metrics: { extDelta: 0, vPeak: 0, validFrameRatio: 0, extBaseline: 0, extPeak: 0 },
    };
  }

  // Compute valid frame ratio
  const validFrameRatio = computeValidityRatio(frames);
  if (validFrameRatio < MIN_VALID_FRAME_RATIO) {
    return {
      valid: false,
      message: `No technique attempt detected (not enough extension/motion). Valid frames: ${(validFrameRatio * 100).toFixed(0)}%`,
      metrics: { extDelta: 0, vPeak: 0, validFrameRatio, extBaseline: 0, extPeak: 0 },
    };
  }

  // Compute lead-wrist extension signal over time: ext(t) = |wrist - shoulder| / torsoLength
  const leadWristIdx = leadSide === "left" ? 15 : 16;
  const leadShoulderIdx = leadSide === "left" ? 11 : 12;
  const extensions: number[] = [];
  const validFrames = frames.filter((f) => typeof f.wallClockMs === "number" && f.landmarks);

  for (const f of validFrames) {
    const get = normalizeLandmarkPoints(f.landmarks, { mirrorX });
    const wrist = get(leadWristIdx);
    const shoulder = get(leadShoulderIdx);
    const ls = get(11); // left shoulder
    const rs = get(12); // right shoulder
    const lh = get(23); // left hip
    const rh = get(24); // right hip;

    if (!wrist || !shoulder || !ls || !rs || !lh || !rh) continue;

    const shoulderCenter = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2, z: (ls.z + rs.z) / 2 };
    const hipCenter = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2, z: (lh.z + rh.z) / 2 };
    const torsoLength = Math.max(1e-6, dist3(hipCenter, shoulderCenter));

    const ext = dist3(wrist, shoulder) / torsoLength;
    if (Number.isFinite(ext)) extensions.push(ext);
  }

  if (extensions.length === 0) {
    return {
      valid: false,
      message: "No technique attempt detected (not enough extension/motion).",
      metrics: { extDelta: 0, vPeak: 0, validFrameRatio, extBaseline: 0, extPeak: 0 },
    };
  }

  // Compute baseline: median of LOWEST 20% of ext values over whole attempt (guard proxy)
  const extValues = [...extensions].sort((a, b) => a - b);
  const lowest20PercentCount = Math.max(1, Math.floor(extValues.length * 0.2));
  const lowest20Percent = extValues.slice(0, lowest20PercentCount);
  const extBaseline = median(lowest20Percent) ?? extensions[0] ?? 0;
  const extPeak = Math.max(...extensions);
  const extDelta = extPeak - extBaseline;

  // Compute lead-wrist speed peak: vPeak = max(|wrist(t)-wrist(t-1)|/dt)
  const leadWristIdx_actual = leadSide === "left" ? 15 : 16;
  const speeds: number[] = [];
  for (let i = 1; i < validFrames.length; i += 1) {
    const prev = validFrames[i - 1];
    const cur = validFrames[i];
    const dt = (cur.wallClockMs - prev.wallClockMs) / 1000;
    if (!Number.isFinite(dt) || dt <= 0 || dt > 1) continue;

    const prevGet = normalizeLandmarkPoints(prev.landmarks, { mirrorX });
    const curGet = normalizeLandmarkPoints(cur.landmarks, { mirrorX });
    const prevWrist = prevGet(leadWristIdx_actual);
    const curWrist = curGet(leadWristIdx_actual);

    if (prevWrist && curWrist) {
      const v = dist3(prevWrist, curWrist) / dt;
      if (Number.isFinite(v)) speeds.push(v);
    }
  }

  const vPeak = speeds.length > 0 ? Math.max(...speeds) : 0;

  // Validate thresholds
  const valid = extDelta >= EXT_MIN_DELTA && vPeak >= VEL_MIN && validFrameRatio >= MIN_VALID_FRAME_RATIO;

  return {
    valid,
    message: valid
      ? undefined
      : `No technique attempt detected (not enough extension/motion). extDelta=${extDelta.toFixed(3)} (min ${EXT_MIN_DELTA}), vPeak=${vPeak.toFixed(3)} (min ${VEL_MIN}), validRatio=${validFrameRatio.toFixed(2)} (min ${MIN_VALID_FRAME_RATIO})`,
    metrics: { extDelta, vPeak, validFrameRatio, extBaseline, extPeak },
  };
}

/**
 * Compute motion energy from normalized landmarks using wrist + ankle velocities.
 * Returns body-relative units/sec (smoothed with EMA).
 */
function computeMotionEnergyFromFrames(frames: PoseFrame[]): number {
  if (frames.length < 2) return 0;
  const valid = frames.filter((f) => typeof f.wallClockMs === "number" && f.landmarks);
  if (valid.length < 2) return 0;

  const speeds: number[] = [];
  for (let i = 1; i < valid.length; i += 1) {
    const prev = valid[i - 1];
    const cur = valid[i];
    const dt = (cur.wallClockMs - prev.wallClockMs) / 1000;
    if (!Number.isFinite(dt) || dt <= 0 || dt > 1) continue; // skip invalid or huge gaps

    const prevGet = normalizeLandmarkPoints(prev.landmarks);
    const curGet = normalizeLandmarkPoints(cur.landmarks);
    const keyPoints = [
      { prev: prevGet(15), cur: curGet(15) }, // leftWrist
      { prev: prevGet(16), cur: curGet(16) }, // rightWrist
      { prev: prevGet(27), cur: curGet(27) }, // leftAnkle
      { prev: prevGet(28), cur: curGet(28) }, // rightAnkle
    ];

    let maxV = 0;
    for (const { prev: p0, cur: p1 } of keyPoints) {
      if (p0 && p1) {
        const v = dist3(p0, p1) / dt;
        if (Number.isFinite(v)) maxV = Math.max(maxV, v);
      }
    }
    if (maxV > 0) speeds.push(maxV);
  }

  return speeds.length > 0 ? mean(speeds) ?? 0 : 0;
}

type AngleSequenceFrame = {
  wallClockMs: number;
  angles: AngleSample;
};

// MultiFeatureFrame type is now defined above with AttemptData

const DTW_TARGET_HZ = 12; // keep DTW complexity manageable
// DTW cost emphasizes jab-specific features: lead elbow + lead extension + rear guard
// Rear elbow is NOT included in DTW cost (only in scoring weights with low weight)
const DTW_WEIGHTS = {
  leadElbowDeg: 1.0, // Lead elbow angle (deg) - primary alignment feature
  extension: 30.0, // Lead extension (body-units) - critical for jab detection
  guard: 30.0, // Rear guard distance (body-units) - important for form
  armDirDeg: 0.15, // Optional: lead arm direction angle (deg)
  shoulderDeg: 0.05, // Keep shoulder proxy very low until validated
};

// Technique-specific scoring weights (for jab) - updated for fixed-duration attempts
const JAB_SCORE_WEIGHTS = {
  leadElbow: 0.35,
  leadExtension: 0.45, // Increased weight for extension
  rearGuard: 0.20, // Reduced weight for guard
  rearElbow: 0.0, // Removed for jab MVP
};

// Legacy scoring weights (fallback)
const SCORE_WEIGHTS = {
  elbow: 0.45,
  extension: 0.35,
  guard: 0.20,
};

// Error-to-score scaling (tune later). These are in the native units:
// - angles are degrees
// - extension/guard are body-relative units (after hip->shoulder scaling + rotation)
const SCORE_SCALES = {
  elbowDeg: 45, // 45° avg error -> ~0 for elbow component
  extension: 0.8, // 0.8 body-units avg error -> ~0 for extension component
  guard: 0.8, // 0.8 body-units avg error -> ~0 for guard component
  shoulderDeg: 60,
};

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function componentScoreFromError(err: number | null, scale: number): number | null {
  if (err == null || !Number.isFinite(err)) return null;
  return 100 * clamp01(1 - err / scale);
}

function baselineMean(values: Array<number | null>, frac: number): number | null {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (v.length === 0) return null;
  const n = Math.max(1, Math.floor(v.length * frac));
  const slice = v.slice(0, n);
  return mean(slice);
}

function maxValue(values: Array<number | null>): number | null {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (v.length === 0) return null;
  return Math.max(...v);
}

function maxIndex(values: Array<number | null>): number | null {
  let bestIdx: number | null = null;
  let best = -Infinity;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (v > best) {
      best = v;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function minValue(values: Array<number | null>): number | null {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (v.length === 0) return null;
  return Math.min(...v);
}

function minMax(values: Array<number | null>): { min: number; max: number; range: number } | null {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (v.length === 0) return null;
  const mn = Math.min(...v);
  const mx = Math.max(...v);
  return { min: mn, max: mx, range: mx - mn };
}

function meanOfFinite(values: Array<number | null>): number | null {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? (mean(v) ?? null) : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function downsampleByWallClock<T extends { wallClockMs: number }>(frames: T[], targetHz: number): T[] {
  if (frames.length <= 2) return frames;
  const minDt = 1000 / Math.max(1, targetHz);
  const out: T[] = [];
  let lastT = -Infinity;
  for (const f of frames) {
    if (f.wallClockMs - lastT >= minDt) {
      out.push(f);
      lastT = f.wallClockMs;
    }
  }
  return out.length >= 2 ? out : frames;
}

function determineLeadSideFromExtensions(extL: number[], extR: number[]): "left" | "right" {
  const mL = mean(extL) ?? 0;
  const mR = mean(extR) ?? 0;
  return mL >= mR ? "left" : "right";
}

function buildCameraFeatureSequence(
  frames: PoseFrame[],
  opts?: {
    leadSide?: "left" | "right";
    mirrorX?: boolean;
  }
): MultiFeatureFrame[] {
  const out: AngleSequenceFrame[] = [];
  const tmp: Array<{
    wallClockMs: number;
    angles: AngleSample;
    extL: number | null;
    extR: number | null;
    guardL: number | null;
    guardR: number | null;
    dirL: number | null;
    dirR: number | null;
  }> = [];

  for (const f of frames) {
    if (typeof f.wallClockMs !== "number") continue;
    if (!f.landmarks) continue;
    const get = normalizeLandmarkPoints(f.landmarks, { mirrorX: opts?.mirrorX });
    const ls = get(11);
    const rs = get(12);
    const lh = get(23);
    const rh = get(24);
    const lw = get(15);
    const rw = get(16);
    const le = get(13);
    const re = get(14);
    if (!ls || !rs || !lh || !rh) continue;

    const shoulderCenter = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2, z: (ls.z + rs.z) / 2 };
    const torsoLength = Math.max(1e-6, dist3({ x: 0, y: 0, z: 0 }, shoulderCenter));

    // Dimensionless extension metric: |wrist - shoulder| / torsoLength
    const extL = lw ? dist3(lw, ls) / torsoLength : null;
    const extR = rw ? dist3(rw, rs) / torsoLength : null;
    const guardL = lw ? dist3(lw, shoulderCenter) : null;
    const guardR = rw ? dist3(rw, shoulderCenter) : null;

    // Angle between arm vector and shoulder line (stable directional feature)
    const shoulderLine = sub3(rs, ls);
    const lArmEnd = lw ?? le ?? null;
    const rArmEnd = rw ?? re ?? null;
    const lArmVec = lArmEnd ? sub3(lArmEnd, ls) : null;
    const rArmVec = rArmEnd ? sub3(rArmEnd, rs) : null;
    const dirL = lArmVec ? angleBetweenDeg(lArmVec, shoulderLine) : null;
    const dirR = rArmVec ? angleBetweenDeg(rArmVec, shoulderLine) : null;

    tmp.push({
      wallClockMs: f.wallClockMs,
      angles: extractAnglesFromLandmarks(f.landmarks, { mirrorX: opts?.mirrorX }),
      extL,
      extR,
      guardL,
      guardR,
      dirL,
      dirR,
    });
  }

  const extLs = tmp.map((t) => t.extL).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const extRs = tmp.map((t) => t.extR).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const lead = opts?.leadSide ?? determineLeadSideFromExtensions(extLs, extRs);

  const seq: MultiFeatureFrame[] = tmp.map((t) => {
    const leadExt = lead === "left" ? t.extL : t.extR;
    const rearGuard = lead === "left" ? t.guardR : t.guardL;
    const leadDir = lead === "left" ? t.dirL : t.dirR;
    return {
      wallClockMs: t.wallClockMs,
      angles: t.angles,
      leadExtension: typeof leadExt === "number" && Number.isFinite(leadExt) ? leadExt : null,
      rearGuardDist: typeof rearGuard === "number" && Number.isFinite(rearGuard) ? rearGuard : null,
      leadArmDirAngleDeg: typeof leadDir === "number" && Number.isFinite(leadDir) ? leadDir : null,
    };
  });

  return downsampleByWallClock(seq, DTW_TARGET_HZ);
}

function normalizeReferencePoints(p: NonNullable<ReferenceFrame["limbPositions"]>): {
  ls: { x: number; y: number; z: number };
  rs: { x: number; y: number; z: number };
  lh: { x: number; y: number; z: number };
  rh: { x: number; y: number; z: number };
  le?: { x: number; y: number; z: number };
  re?: { x: number; y: number; z: number };
  lw?: { x: number; y: number; z: number };
  rw?: { x: number; y: number; z: number };
} | null {
  const ls = p.leftShoulder;
  const rs = p.rightShoulder;
  const lh = p.leftHip;
  const rh = p.rightHip;
  if (!ls || !rs || !lh || !rh) return null;

  // Normalize to body-relative *3D* coordinates:
  // - translate in 3D to mid-hips
  // - scale in 3D by hip->shoulder distance
  // - rotate about Z so shoulders are horizontal in x/y (z unchanged by a Z-axis rotation)
  const hipCenter = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2, z: (lh.z + rh.z) / 2 };
  const shoulderCenter = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2, z: (ls.z + rs.z) / 2 };
  const scale = dist3(hipCenter, shoulderCenter);
  const inv = scale > 1e-6 ? 1 / scale : 1;

  const ls0 = { x: (ls.x - hipCenter.x) * inv, y: (ls.y - hipCenter.y) * inv, z: (ls.z - hipCenter.z) * inv };
  const rs0 = { x: (rs.x - hipCenter.x) * inv, y: (rs.y - hipCenter.y) * inv, z: (rs.z - hipCenter.z) * inv };
  const dx = rs0.x - ls0.x;
  const dy = rs0.y - ls0.y;
  const rot = -Math.atan2(dy, dx);
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);

  const rotXY = (q: { x: number; y: number; z: number }) => {
    const x0 = (q.x - hipCenter.x) * inv;
    const y0 = (q.y - hipCenter.y) * inv;
    const z0 = (q.z - hipCenter.z) * inv;
    return { x: x0 * cos - y0 * sin, y: x0 * sin + y0 * cos, z: z0 };
  };

  return {
    ls: rotXY(ls),
    rs: rotXY(rs),
    lh: rotXY(lh),
    rh: rotXY(rh),
    le: p.leftElbow ? rotXY(p.leftElbow) : undefined,
    re: p.rightElbow ? rotXY(p.rightElbow) : undefined,
    lw: p.leftWrist ? rotXY(p.leftWrist) : undefined,
    rw: p.rightWrist ? rotXY(p.rightWrist) : undefined,
  };
}

function buildReferenceFeatureSequence(frames: ReferenceFrame[], leadSide?: "left" | "right"): MultiFeatureFrame[] {
  const tmp: Array<{
    wallClockMs: number;
    angles: AngleSample;
    extL: number | null;
    extR: number | null;
    guardL: number | null;
    guardR: number | null;
    dirL: number | null;
    dirR: number | null;
  }> = [];

  for (const f of frames) {
    if (typeof f.wallClockMs !== "number") continue;
    if (!f.featureVector || f.featureVector.length === 0) continue;
    if (!f.limbPositions) continue;
    const norm = normalizeReferencePoints(f.limbPositions);
    if (!norm) continue;

    const shoulderCenter = { x: (norm.ls.x + norm.rs.x) / 2, y: (norm.ls.y + norm.rs.y) / 2, z: (norm.ls.z + norm.rs.z) / 2 };
    const torsoLength = Math.max(1e-6, dist3({ x: 0, y: 0, z: 0 }, shoulderCenter));

    // Dimensionless extension metric: |wrist - shoulder| / torsoLength
    const extL = norm.lw ? dist3(norm.lw, norm.ls) / torsoLength : null;
    const extR = norm.rw ? dist3(norm.rw, norm.rs) / torsoLength : null;
    const guardL = norm.lw ? dist3(norm.lw, shoulderCenter) : null;
    const guardR = norm.rw ? dist3(norm.rw, shoulderCenter) : null;

    const shoulderLine = sub3(norm.rs, norm.ls);
    const lArmEnd = norm.lw ?? null;
    const rArmEnd = norm.rw ?? null;
    const lArmVec = lArmEnd ? sub3(lArmEnd, norm.ls) : null;
    const rArmVec = rArmEnd ? sub3(rArmEnd, norm.rs) : null;
    const dirL = lArmVec ? angleBetweenDeg(lArmVec, shoulderLine) : null;
    const dirR = rArmVec ? angleBetweenDeg(rArmVec, shoulderLine) : null;

    tmp.push({
      wallClockMs: f.wallClockMs,
      angles: anglesFromReferenceVector(f.featureVector),
      extL,
      extR,
      guardL,
      guardR,
      dirL,
      dirR,
    });
  }

  const extLs = tmp.map((t) => t.extL).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const extRs = tmp.map((t) => t.extR).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const lead = leadSide ?? determineLeadSideFromExtensions(extLs, extRs);

  const seq: MultiFeatureFrame[] = tmp.map((t) => {
    const leadExt = lead === "left" ? t.extL : t.extR;
    const rearGuard = lead === "left" ? t.guardR : t.guardL;
    const leadDir = lead === "left" ? t.dirL : t.dirR;
    return {
      wallClockMs: t.wallClockMs,
      angles: t.angles,
      leadExtension: typeof leadExt === "number" && Number.isFinite(leadExt) ? leadExt : null,
      rearGuardDist: typeof rearGuard === "number" && Number.isFinite(rearGuard) ? rearGuard : null,
      leadArmDirAngleDeg: typeof leadDir === "number" && Number.isFinite(leadDir) ? leadDir : null,
    };
  });

  return downsampleByWallClock(seq, DTW_TARGET_HZ);
}

function elbowFeature(angles: AngleSample): [number, number] | null {
  const l = angles.leftElbow;
  const r = angles.rightElbow;
  if (typeof l !== "number" || !Number.isFinite(l)) return null;
  if (typeof r !== "number" || !Number.isFinite(r)) return null;
  return [l, r];
}

function elbowCostDeg(a: AngleSample, b: AngleSample): number | null {
  const fa = elbowFeature(a);
  const fb = elbowFeature(b);
  if (!fa || !fb) return null;
  // Average absolute elbow error (deg) across L/R
  return (Math.abs(fa[0] - fb[0]) + Math.abs(fa[1] - fb[1])) / 2;
}

/**
 * Compute DTW cost using only lead elbow + lead extension (for jab technique).
 * @param a First frame
 * @param b Second frame
 * @param leadSide "left" or "right" to determine which elbow is lead
 */
function dtwCostMulti(a: MultiFeatureFrame, b: MultiFeatureFrame, leadSide?: "left" | "right"): number | null {
  // Use only lead elbow (not rear elbow) for DTW alignment
  const leadElbowKey: AngleKey = leadSide === "left" ? "leftElbow" : leadSide === "right" ? "rightElbow" : "leftElbow";
  const leadElbowA = a.angles[leadElbowKey];
  const leadElbowB = b.angles[leadElbowKey];
  if (typeof leadElbowA !== "number" || typeof leadElbowB !== "number" || !Number.isFinite(leadElbowA) || !Number.isFinite(leadElbowB)) {
    return null;
  }
  const leadElbowCost = Math.abs(leadElbowA - leadElbowB);

  const extA = a.leadExtension;
  const extB = b.leadExtension;
  if (typeof extA !== "number" || typeof extB !== "number" || !Number.isFinite(extA) || !Number.isFinite(extB)) {
    return null;
  }

  const guardA = a.rearGuardDist;
  const guardB = b.rearGuardDist;
  if (typeof guardA !== "number" || typeof guardB !== "number" || !Number.isFinite(guardA) || !Number.isFinite(guardB)) {
    return null;
  }

  const dirA = a.leadArmDirAngleDeg;
  const dirB = b.leadArmDirAngleDeg;
  const armDirCost = typeof dirA === "number" && typeof dirB === "number" ? Math.abs(dirA - dirB) : 0;

  const shouldersA = [a.angles.leftShoulder, a.angles.rightShoulder];
  const shouldersB = [b.angles.leftShoulder, b.angles.rightShoulder];
  const sA0 = shouldersA[0], sA1 = shouldersA[1], sB0 = shouldersB[0], sB1 = shouldersB[1];
  const shoulderCost =
    typeof sA0 === "number" && typeof sA1 === "number" && typeof sB0 === "number" && typeof sB1 === "number"
      ? (Math.abs(sA0 - sB0) + Math.abs(sA1 - sB1)) / 2
      : 0;

  return (
    DTW_WEIGHTS.leadElbowDeg * leadElbowCost +
    DTW_WEIGHTS.extension * Math.abs(extA - extB) +
    DTW_WEIGHTS.guard * Math.abs(guardA - guardB) +
    DTW_WEIGHTS.armDirDeg * armDirCost +
    DTW_WEIGHTS.shoulderDeg * shoulderCost
  );
}

function dtwAlignMulti(cameraSeq: MultiFeatureFrame[], refSeq: MultiFeatureFrame[], leadSide?: "left" | "right"): { path: Array<[number, number]>; avgCost: number } | null {
  const n = cameraSeq.length;
  const m = refSeq.length;
  if (n === 0 || m === 0) return null;

  // If endpoints don't have required features, DTW becomes unstable; bail out.
  if (dtwCostMulti(cameraSeq[0], refSeq[0], leadSide) == null || dtwCostMulti(cameraSeq[n - 1], refSeq[m - 1], leadSide) == null) {
    return null;
  }

  const INF = 1e18;
  const window = Math.max(15, Math.abs(n - m) + 15); // Sakoe–Chiba band

  const dp: Float64Array[] = Array.from({ length: n }, () => {
    const row = new Float64Array(m);
    row.fill(INF);
    return row;
  });
  const prev: Int8Array[] = Array.from({ length: n }, () => {
    const row = new Int8Array(m);
    row.fill(-1);
    return row;
  });

  const cost00 = dtwCostMulti(cameraSeq[0], refSeq[0], leadSide);
  if (cost00 == null) return null;
  dp[0][0] = cost00;
  prev[0][0] = 0;

  for (let i = 0; i < n; i += 1) {
    const jStart = Math.max(0, i - window);
    const jEnd = Math.min(m - 1, i + window);
    for (let j = jStart; j <= jEnd; j += 1) {
      if (i === 0 && j === 0) continue;
      const c = dtwCostMulti(cameraSeq[i], refSeq[j], leadSide);
      if (c == null) continue;

      let best = INF;
      let dir: 0 | 1 | 2 | -1 = -1; // 0 diag, 1 up, 2 left

      if (i > 0 && j > 0 && dp[i - 1][j - 1] < best) {
        best = dp[i - 1][j - 1];
        dir = 0;
      }
      if (i > 0 && dp[i - 1][j] < best) {
        best = dp[i - 1][j];
        dir = 1;
      }
      if (j > 0 && dp[i][j - 1] < best) {
        best = dp[i][j - 1];
        dir = 2;
      }

      if (dir === -1 || best >= INF / 2) continue;
      dp[i][j] = c + best;
      prev[i][j] = dir;
    }
  }

  if (dp[n - 1][m - 1] >= INF / 2) return null;

  // Backtrack path
  const path: Array<[number, number]> = [];
  let i = n - 1;
  let j = m - 1;
  while (true) {
    path.push([i, j]);
    if (i === 0 && j === 0) break;
    const dir = prev[i][j];
    if (dir === 0) {
      i -= 1;
      j -= 1;
    } else if (dir === 1) {
      i -= 1;
    } else if (dir === 2) {
      j -= 1;
    } else {
      return null;
    }
  }
  path.reverse();

  const avgCost = dp[n - 1][m - 1] / Math.max(1, path.length);
  return { path, avgCost };
}

function detectMovementOnsetMsFromPoseFrames(frames: PoseFrame[]): number | null {
  // Uses wrists/ankles velocity in body-relative coordinates to find first movement onset.
  const valid = frames.filter((f) => typeof f.wallClockMs === "number" && f.landmarks);
  if (valid.length < 3) return null;

  const keyIdx = [15, 16, 27, 28]; // LWrist, RWrist, LAnkle, RAnkle

  const series: Array<{ t: number; motion: number }> = [];
  for (let i = 1; i < valid.length; i += 1) {
    const prev = valid[i - 1];
    const cur = valid[i];
    const dt = (cur.wallClockMs - prev.wallClockMs) / 1000;
    if (!Number.isFinite(dt) || dt <= 0) continue;

    const prevGet = normalizeLandmarkPoints(prev.landmarks);
    const curGet = normalizeLandmarkPoints(cur.landmarks);

    let maxV = 0;
    for (const idx of keyIdx) {
      const a = prevGet(idx);
      const b = curGet(idx);
      if (!a || !b) continue;
      const v = dist3(a, b) / dt;
      if (v > maxV) maxV = v;
    }

    series.push({ t: cur.wallClockMs, motion: maxV });
  }

  if (series.length < 3) return null;

  // Baseline: first ~500ms of motion values
  const baselineEnd = series[0].t + 500;
  const baseline = series.filter((s) => s.t <= baselineEnd).map((s) => s.motion);
  const mean0 = baseline.length ? baseline.reduce((a, b) => a + b, 0) / baseline.length : 0;
  const var0 = baseline.length ? baseline.reduce((acc, v) => acc + (v - mean0) * (v - mean0), 0) / baseline.length : 0;
  const std0 = Math.sqrt(var0);
  const threshold = Math.max(0.15, mean0 + 3 * std0); // body-relative units/sec

  // Require 2 consecutive above-threshold samples to reduce false triggers
  for (let i = 1; i < series.length; i += 1) {
    if (series[i - 1].motion > threshold && series[i].motion > threshold) {
      return series[i - 1].t;
    }
  }

  return null;
}

function detectMovementOnsetMsFromReferenceFrames(frames: ReferenceFrame[]): number | null {
  // Uses limbPositions velocity (world space) to find first movement onset.
  const valid = frames.filter((f) => typeof f.wallClockMs === "number" && f.limbPositions);
  if (valid.length < 3) return null;

  const series: Array<{ t: number; motion: number }> = [];
  for (let i = 1; i < valid.length; i += 1) {
    const prev = valid[i - 1];
    const cur = valid[i];
    const dt = (cur.wallClockMs - prev.wallClockMs) / 1000;
    if (!Number.isFinite(dt) || dt <= 0) continue;

    const keys: Array<keyof NonNullable<ReferenceFrame["limbPositions"]>> = ["leftWrist", "rightWrist", "leftAnkle", "rightAnkle"];
    let maxV = 0;
    for (const k of keys) {
      const p0 = prev.limbPositions?.[k];
      const p1 = cur.limbPositions?.[k];
      if (!p0 || !p1) continue;
      const v = dist3(p0, p1) / dt;
      if (v > maxV) maxV = v;
    }

    series.push({ t: cur.wallClockMs, motion: maxV });
  }

  if (series.length < 3) return null;

  const baselineEnd = series[0].t + 500;
  const baseline = series.filter((s) => s.t <= baselineEnd).map((s) => s.motion);
  const mean0 = baseline.length ? baseline.reduce((a, b) => a + b, 0) / baseline.length : 0;
  const var0 = baseline.length ? baseline.reduce((acc, v) => acc + (v - mean0) * (v - mean0), 0) / baseline.length : 0;
  const std0 = Math.sqrt(var0);
  // World-units/sec threshold: use baseline-adaptive only + tiny floor
  const threshold = Math.max(1e-4, mean0 + 3 * std0);

  for (let i = 1; i < series.length; i += 1) {
    if (series[i - 1].motion > threshold && series[i].motion > threshold) {
      return series[i - 1].t;
    }
  }

  return null;
}

/**
 * Find active movement window: frames where lead wrist velocity > 0.6 * peakVelocity.
 * Returns [startIdx, endIdx] inclusive, or null if no valid window.
 */
/**
 * Extract active motion window from fixed-duration attempt based on extension signal.
 * 
 * Algorithm:
 * 1. Compute extension signal ext(t) = |leadWrist - leadShoulder| / torsoLength
 * 2. Baseline = median(ext) over first 0.4s
 * 3. Peak = max(ext); delta = peak - baseline
 * 4. Find t_peak index
 * 5. startIdx = last index before peak where ext <= baseline + 0.25*delta
 * 6. endIdx = first index after peak where ext <= baseline + 0.35*delta
 * 7. Add padding: startIdx -= round(0.15s*fps), endIdx += round(0.20s*fps)
 */
function extractActiveMotionWindow(
  frames: PoseFrame[],
  leadSide: "left" | "right",
  mirrorX: boolean
): {
  startIdx: number;
  endIdx: number;
  extBaseline: number;
  extPeak: number;
  extDelta: number;
  peakIdx: number;
  cameraStartMs: number | null;
  cameraEndMs: number | null;
} | null {
  if (frames.length < 3) return null;
  
  const leadWristIdx = leadSide === "left" ? 15 : 16;
  const leadShoulderIdx = leadSide === "left" ? 11 : 12;
  const validFrames = frames.filter((f) => typeof f.wallClockMs === "number" && f.landmarks);
  if (validFrames.length < 3) return null;

  // Compute extension signal: ext(t) = |wrist - shoulder| / torsoLength
  // Use running median for torsoLength stability
  const torsoLengths: number[] = [];
  const extensions: Array<{ ext: number; frameIdx: number; wallClockMs: number }> = [];
  for (let i = 0; i < validFrames.length; i += 1) {
    const f = validFrames[i];
    const get = normalizeLandmarkPoints(f.landmarks, { mirrorX });
    const wrist = get(leadWristIdx);
    const shoulder = get(leadShoulderIdx);
    const ls = get(11);
    const rs = get(12);
    const lh = get(23);
    const rh = get(24);

    if (!wrist || !shoulder || !ls || !rs || !lh || !rh) continue;

    const shoulderCenter = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2, z: (ls.z + rs.z) / 2 };
    const hipCenter = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2, z: (lh.z + rh.z) / 2 };
    const torsoLenFrame = dist3(hipCenter, shoulderCenter);
    
    // Only add to running median if landmark confidence is reasonable (visibility check)
    const wristVis = f.landmarks?.[leadWristIdx]?.visibility ?? 1.0;
    const shoulderVis = f.landmarks?.[leadShoulderIdx]?.visibility ?? 1.0;
    const lsVis = f.landmarks?.[11]?.visibility ?? 1.0;
    const rsVis = f.landmarks?.[12]?.visibility ?? 1.0;
    const lhVis = f.landmarks?.[23]?.visibility ?? 1.0;
    const rhVis = f.landmarks?.[24]?.visibility ?? 1.0;
    const minVis = Math.min(wristVis, shoulderVis, lsVis, rsVis, lhVis, rhVis);
    
    if (Number.isFinite(torsoLenFrame) && torsoLenFrame > 1e-6 && minVis >= 0.3) {
      torsoLengths.push(torsoLenFrame);
    }
    
    // Use running median of last N frames for stability (N = min(10, available))
    const N = 10;
    const recentTorsoLengths = torsoLengths.slice(-N);
    const stableTorsoLength = recentTorsoLengths.length > 0 
      ? (median(recentTorsoLengths) ?? mean(recentTorsoLengths) ?? torsoLenFrame)
      : torsoLenFrame;
    const torsoLength = Math.max(1e-6, stableTorsoLength);

    const ext = dist3(wrist, shoulder) / torsoLength;
    if (Number.isFinite(ext)) {
      // Find original frame index in frames array
      const origIdx = frames.findIndex((orig) => orig.wallClockMs === f.wallClockMs);
      if (origIdx >= 0) {
        extensions.push({ ext, frameIdx: origIdx, wallClockMs: f.wallClockMs });
      }
    }
  }

  if (extensions.length === 0) return null;

  // Compute baseline: median of LOWEST 20% of ext values over whole attempt (guard proxy)
  const extValues = extensions.map((e) => e.ext).sort((a, b) => a - b);
  const lowest20PercentCount = Math.max(1, Math.floor(extValues.length * 0.2));
  const lowest20Percent = extValues.slice(0, lowest20PercentCount);
  const extBaseline = median(lowest20Percent) ?? extValues[0] ?? 0;
  
  // Find peak and peak index
  let extPeak = -Infinity;
  let peakIdx = -1;
  for (let i = 0; i < extensions.length; i += 1) {
    if (extensions[i].ext > extPeak) {
      extPeak = extensions[i].ext;
      peakIdx = extensions[i].frameIdx;
    }
  }
  
  if (peakIdx === -1) return null;
  
  const extDelta = extPeak - extBaseline;
  if (extDelta <= 0) return null;

  // Find startIdx: last index before peak where ext <= baseline + 0.25*delta
  let startIdx = -1;
  for (let i = 0; i < extensions.length; i += 1) {
    const e = extensions[i];
    if (e.frameIdx < peakIdx && e.ext <= extBaseline + 0.25 * extDelta) {
      startIdx = e.frameIdx;
    } else if (e.frameIdx >= peakIdx) {
      break;
    }
  }
  
  // Find endIdx: first index after peak where ext <= baseline + 0.35*delta
  let endIdx = -1;
  for (let i = extensions.length - 1; i >= 0; i -= 1) {
    const e = extensions[i];
    if (e.frameIdx > peakIdx && e.ext <= extBaseline + 0.35 * extDelta) {
      endIdx = e.frameIdx;
    } else if (e.frameIdx <= peakIdx) {
      break;
    }
  }

  if (startIdx === -1) startIdx = 0; // Fallback to start
  if (endIdx === -1) endIdx = frames.length - 1; // Fallback to end

  // Add padding: startIdx -= round(0.15s*fps), endIdx += round(0.20s*fps)
  // Estimate fps from frame timestamps
  const avgDt = validFrames.length >= 2
    ? (validFrames[validFrames.length - 1].wallClockMs - validFrames[0].wallClockMs) / (validFrames.length - 1)
    : 1000 / 15; // Default 15fps
  const fps = avgDt > 0 ? 1000 / avgDt : 15;
  const paddingStartFrames = Math.round(0.15 * fps);
  const paddingEndFrames = Math.round(0.20 * fps);
  
  startIdx = Math.max(0, startIdx - paddingStartFrames);
  endIdx = Math.min(frames.length - 1, endIdx + paddingEndFrames);

  const cameraStartMs = frames[startIdx]?.wallClockMs ?? null;
  const cameraEndMs = frames[endIdx]?.wallClockMs ?? null;

  return {
    startIdx,
    endIdx,
    extBaseline,
    extPeak,
    extDelta,
    peakIdx,
    cameraStartMs,
    cameraEndMs,
  };
}

/**
 * Validate reference skeleton mapping by checking segment lengths.
 * Returns { valid: boolean, message?: string, boneNames?: Record<string, string> }
 */
function validateReferenceSkeleton(refFrames: ReferenceFrame[]): {
  valid: boolean;
  message?: string;
  boneNames?: Record<string, string>;
} {
  const validFrames = refFrames.filter((f) => f.referenceValid && f.limbPositions);
  if (validFrames.length === 0) {
    return { valid: false, message: "No valid reference frames with limb positions" };
  }
  
  // Required segments: shoulder->elbow, elbow->wrist for both arms
  const segments: Array<{ name: string; start: string; end: string }> = [
    { name: "leftShoulderToElbow", start: "leftShoulder", end: "leftElbow" },
    { name: "leftElbowToWrist", start: "leftElbow", end: "leftWrist" },
    { name: "rightShoulderToElbow", start: "rightShoulder", end: "rightElbow" },
    { name: "rightElbowToWrist", start: "rightElbow", end: "rightWrist" },
  ];
  
  const segmentLengths: Record<string, number[]> = {};
  for (const seg of segments) {
    segmentLengths[seg.name] = [];
  }
  
  for (const frame of validFrames) {
    const lp = frame.limbPositions;
    if (!lp) continue;
    
    for (const seg of segments) {
      const start = lp[seg.start as keyof typeof lp];
      const end = lp[seg.end as keyof typeof lp];
      if (start && end) {
        const len = dist3(start, end);
        if (Number.isFinite(len) && len > 0) {
          segmentLengths[seg.name].push(len);
        }
      }
    }
  }
  
  // Check for near-zero, NaN, or wildly inconsistent lengths
  for (const seg of segments) {
    const lengths = segmentLengths[seg.name];
    if (lengths.length === 0) {
      return { valid: false, message: `Reference rig mapping invalid: missing segment ${seg.name}` };
    }
    
    const avg = mean(lengths) ?? 0;
    const min = Math.min(...lengths);
    const max = Math.max(...lengths);
    
    // Check for near-zero
    if (avg < 1e-3) {
      return { valid: false, message: `Reference rig mapping invalid: segment ${seg.name} is near zero` };
    }
    
    // Check for inconsistency (more than 50% variation)
    if (max > 0 && (max - min) / max > 0.5) {
      return { valid: false, message: `Reference rig mapping invalid: segment ${seg.name} is inconsistent (${min.toFixed(3)}-${max.toFixed(3)})` };
    }
  }
  
  return { valid: true };
}

/**
 * Score a single attempt given camera and reference frames.
 * Returns a ComparisonResult or null if attempt is invalid.
 */
function scoreSingleAttempt(
  cameraFrames: PoseFrame[],
  refFrames: ReferenceFrame[],
  leadSide: "left" | "right",
  mirrorX: boolean,
  logOneFramePoints: boolean
): ComparisonResult | null {
  // Validate reference skeleton mapping first
  const refValidation = validateReferenceSkeleton(refFrames);
  if (!refValidation.valid) {
    return {
      message: refValidation.message || "Reference rig mapping invalid; cannot evaluate.",
      score0to100: null,
      rows: [],
      worstJoints: [],
      frameCount: cameraFrames.length,
      matchedCount: 0,
      durationMs: null,
      validation: { validityRatio: 0, motionEnergy: 0 },
      debug: {
        leadSide,
        cameraMirrored: mirrorX,
        cameraPeakExtension: null,
        referencePeakExtension: null,
        extensionThreshold: null,
        extensionPass: null,
        cameraElbow: undefined,
        referenceElbow: undefined,
      },
      penalties: [],
      featureErrors: undefined,
      dtw: { enabled: true, pathLength: 0, avgCost: null, cameraSeqLen: 0, referenceSeqLen: 0 },
    };
  }

  // Extract active motion window from fixed-duration attempt
  const activeWindow = extractActiveMotionWindow(cameraFrames, leadSide, mirrorX);
  if (!activeWindow) {
    return {
      message: "No active motion window detected",
      score0to100: 0,
      rows: [],
      worstJoints: [],
      frameCount: cameraFrames.length,
      matchedCount: 0,
      durationMs: null,
      validation: { validityRatio: 0, motionEnergy: 0 },
      debug: {
        leadSide,
        cameraMirrored: mirrorX,
        cameraPeakExtension: null,
        referencePeakExtension: null,
        extensionThreshold: null,
        extensionPass: null,
        cameraElbow: undefined,
        referenceElbow: undefined,
        activeWindowStartIdx: null,
        activeWindowEndIdx: null,
        activeWindowDurationMs: null,
        activeWindowFrameCount: 0,
        totalFrameCount: cameraFrames.length,
        peakVelocity: null,
      },
      dtw: { enabled: true, pathLength: 0, avgCost: null, cameraSeqLen: 0, referenceSeqLen: 0 },
    };
  }

  // Slice active frames first (needed for vPeak computation)
  const activeFrames = cameraFrames.slice(activeWindow.startIdx, activeWindow.endIdx + 1);
  
  // Compute vPeak for fallback gate
  const VPEAK_MIN = 0.10; // Minimum lead-wrist speed peak
  const VPEAK_STRONG = 2 * VPEAK_MIN; // Fallback for fast reps (0.20)
  let vPeak: number | null = null;
  
  const validFramesForSpeed = activeFrames.filter((f) => typeof f.wallClockMs === "number" && f.landmarks);
  const speeds: number[] = [];
  for (let i = 1; i < validFramesForSpeed.length; i += 1) {
    const prev = validFramesForSpeed[i - 1];
    const cur = validFramesForSpeed[i];
    const dt = (cur.wallClockMs - prev.wallClockMs) / 1000;
    if (!Number.isFinite(dt) || dt <= 0 || dt > 1) continue;

    const prevGet = normalizeLandmarkPoints(prev.landmarks, { mirrorX });
    const curGet = normalizeLandmarkPoints(cur.landmarks, { mirrorX });
    const leadWristIdx = leadSide === "left" ? 15 : 16;
    const prevWrist = prevGet(leadWristIdx);
    const curWrist = curGet(leadWristIdx);

    if (prevWrist && curWrist) {
      const v = dist3(prevWrist, curWrist) / dt;
      if (Number.isFinite(v)) speeds.push(v);
    }
  }
  vPeak = speeds.length > 0 ? Math.max(...speeds) : 0;
  
  // Initial check with fixed threshold (will be updated after refSeq is built)
  // This allows early rejection of clearly invalid attempts
  let extDeltaMin = 0.20; // Temporary, will be updated after refSeq
  let referenceExtDelta: number | null = null;
  let referenceExtBaseline: number | null = null;
  let referenceExtPeak: number | null = null;
  
  // Attempt is valid if:
  //   (extDelta >= extDeltaMin AND vPeak >= VPEAK_MIN)
  //   OR (vPeak >= VPEAK_STRONG)  // fallback for fast reps
  const vPeakPass = vPeak >= VPEAK_MIN;
  const vPeakStrongPass = vPeak >= VPEAK_STRONG;
  const extDeltaPassInitial = activeWindow.extDelta >= extDeltaMin;
  const attemptValidInitial = (extDeltaPassInitial && vPeakPass) || vPeakStrongPass;
  
  // Early rejection if clearly invalid (but we'll re-check after building refSeq)
  if (!attemptValidInitial && !vPeakStrongPass) {
    return {
      message: `No technique attempt detected (not enough extension/motion). extDelta=${activeWindow.extDelta.toFixed(3)} (min ${extDeltaMin.toFixed(3)}), vPeak=${vPeak?.toFixed(3) ?? "N/A"} (min ${VPEAK_MIN})`,
      score0to100: 0,
      rows: [],
      worstJoints: [],
      frameCount: cameraFrames.length,
      matchedCount: 0,
      durationMs: activeWindow.cameraEndMs && activeWindow.cameraStartMs ? activeWindow.cameraEndMs - activeWindow.cameraStartMs : null,
      validation: { validityRatio: 0, motionEnergy: 0 },
      debug: {
        leadSide,
        cameraMirrored: mirrorX,
        cameraPeakExtension: activeWindow.extPeak,
        referencePeakExtension: referenceExtPeak,
        extensionThreshold: extDeltaMin,
        extensionPass: extDeltaPass,
        cameraElbow: undefined,
        referenceElbow: undefined,
        activeWindowStartIdx: activeWindow.startIdx,
        activeWindowEndIdx: activeWindow.endIdx,
        activeWindowDurationMs: activeWindow.cameraEndMs && activeWindow.cameraStartMs ? activeWindow.cameraEndMs - activeWindow.cameraStartMs : null,
        activeWindowFrameCount: activeWindow.endIdx - activeWindow.startIdx + 1,
        totalFrameCount: cameraFrames.length,
        peakVelocity: vPeak,
        activeWindowStartMs: activeWindow.cameraStartMs,
        activeWindowEndMs: activeWindow.cameraEndMs,
        activeWindowRefStartMs: null,
        activeWindowRefEndMs: null,
        extBaseline: activeWindow.extBaseline,
        extPeak: activeWindow.extPeak,
        extDelta: activeWindow.extDelta,
        extDeltaMin: extDeltaMin,
        referenceExtDelta: referenceExtDelta,
        referenceExtBaseline: referenceExtBaseline,
        peakIdx: activeWindow.peakIdx,
        windowThresholdStart: 0.25,
        windowThresholdEnd: 0.35,
        guardCameraAvg: null,
        guardRefAvg: null,
        leadWristName: leadSide === "left" ? "left_wrist" : "right_wrist",
        leadShoulderName: leadSide === "left" ? "left_shoulder" : "right_shoulder",
      },
      dtw: { enabled: true, pathLength: 0, avgCost: null, cameraSeqLen: 0, referenceSeqLen: 0 },
    };
  }

  const windowDurationMs = activeWindow.cameraEndMs && activeWindow.cameraStartMs
    ? activeWindow.cameraEndMs - activeWindow.cameraStartMs
    : null;

  // Build feature sequence from active window only
  const cameraSeq = buildCameraFeatureSequence(activeFrames, { leadSide, mirrorX });
  const cameraPeakExtension = maxValue(cameraSeq.map((f) => f.leadExtension));
  const durationMs = windowDurationMs;

  // Compute guard averages for debug
  const guardCameraSeries = cameraSeq.map((f) => f.rearGuardDist).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const guardCameraAvg = guardCameraSeries.length > 0 ? mean(guardCameraSeries) : null;

  // Filter reference frames to match active window timing (with small padding)
  const refFramesAll = refFrames.filter(
    (f) =>
      typeof f.wallClockMs === "number" &&
      f.referenceValid &&
      (activeWindow.cameraStartMs == null || f.wallClockMs >= activeWindow.cameraStartMs - 200) &&
      (activeWindow.cameraEndMs == null || f.wallClockMs <= activeWindow.cameraEndMs + 200)
  );
  const anyReferenceValid = refFramesAll.some((f) => f.referenceValid);
  if (!anyReferenceValid) {
    const missing = refFramesAll.find((f) => f.referenceMissingJoints && f.referenceMissingJoints.length > 0)?.referenceMissingJoints;
    return {
      message: "Reference skeleton mapping failed",
      score0to100: null,
      rows: [],
      worstJoints: [],
      frameCount: cameraFrames.length,
      matchedCount: 0,
      durationMs,
      validation: {
        validityRatio: computeValidityRatio(activeFrames),
        motionEnergy: 0, // Not used for fixed-duration attempts
      },
      debug: {
        leadSide,
        cameraMirrored: mirrorX,
        cameraPeakExtension,
        referencePeakExtension: null,
        extensionThreshold: null,
        extensionPass: null,
        cameraElbow: undefined,
        referenceElbow: undefined,
      },
      penalties: [],
      featureErrors: undefined,
      dtw: { enabled: true, pathLength: 0, avgCost: null, cameraSeqLen: cameraSeq.length, referenceSeqLen: 0 },
    };
  }

  const refSeq = buildReferenceFeatureSequence(refFramesAll, leadSide);
  const referencePeakExtension = maxValue(refSeq.map((f) => f.leadExtension));
  
  // Now compute reference extDelta for adaptive threshold (after refSeq is built)
  const refExtValues = refSeq.map((f) => f.leadExtension).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (refExtValues.length > 0) {
    const sortedRefExt = [...refExtValues].sort((a, b) => a - b);
    const lowest20PercentCount = Math.max(1, Math.floor(sortedRefExt.length * 0.2));
    const lowest20Percent = sortedRefExt.slice(0, lowest20PercentCount);
    referenceExtBaseline = median(lowest20Percent) ?? sortedRefExt[0] ?? null;
    referenceExtPeak = Math.max(...refExtValues);
    if (referenceExtBaseline != null && referenceExtPeak != null) {
      referenceExtDelta = referenceExtPeak - referenceExtBaseline;
    }
  }
  
  // Update adaptive threshold: extDeltaMin = max(0.12, referenceExtDelta * 0.35)
  if (referenceExtDelta != null) {
    extDeltaMin = Math.max(0.12, referenceExtDelta * 0.35);
  }
  
  // Final validation check with adaptive threshold
  const extDeltaPass = activeWindow.extDelta >= extDeltaMin;
  const attemptValid = (extDeltaPass && vPeakPass) || vPeakStrongPass;
  
  if (!attemptValid) {
    // Return invalid attempt with updated threshold info
    return {
      message: `No technique attempt detected (not enough extension/motion). extDelta=${activeWindow.extDelta.toFixed(3)} (min ${extDeltaMin.toFixed(3)}), vPeak=${vPeak?.toFixed(3) ?? "N/A"} (min ${VPEAK_MIN})`,
      score0to100: 0,
      rows: [],
      worstJoints: [],
      frameCount: cameraFrames.length,
      matchedCount: 0,
      durationMs: activeWindow.cameraEndMs && activeWindow.cameraStartMs ? activeWindow.cameraEndMs - activeWindow.cameraStartMs : null,
      validation: { validityRatio: 0, motionEnergy: 0 },
      debug: {
        leadSide,
        cameraMirrored: mirrorX,
        cameraPeakExtension: activeWindow.extPeak,
        referencePeakExtension: referenceExtPeak,
        extensionThreshold: extDeltaMin,
        extensionPass: extDeltaPass,
        cameraElbow: undefined,
        referenceElbow: undefined,
        activeWindowStartIdx: activeWindow.startIdx,
        activeWindowEndIdx: activeWindow.endIdx,
        activeWindowDurationMs: activeWindow.cameraEndMs && activeWindow.cameraStartMs ? activeWindow.cameraEndMs - activeWindow.cameraStartMs : null,
        activeWindowFrameCount: activeWindow.endIdx - activeWindow.startIdx + 1,
        totalFrameCount: cameraFrames.length,
        peakVelocity: vPeak,
        activeWindowStartMs: activeWindow.cameraStartMs,
        activeWindowEndMs: activeWindow.cameraEndMs,
        activeWindowRefStartMs: null,
        activeWindowRefEndMs: null,
        extBaseline: activeWindow.extBaseline,
        extPeak: activeWindow.extPeak,
        extDelta: activeWindow.extDelta,
        extDeltaMin: extDeltaMin,
        referenceExtDelta: referenceExtDelta,
        referenceExtBaseline: referenceExtBaseline,
        peakIdx: activeWindow.peakIdx,
        windowThresholdStart: 0.25,
        windowThresholdEnd: 0.35,
        guardCameraAvg: null,
        guardRefAvg: null,
        leadWristName: leadSide === "left" ? "left_wrist" : "right_wrist",
        leadShoulderName: leadSide === "left" ? "left_shoulder" : "right_shoulder",
      },
      dtw: { enabled: true, pathLength: 0, avgCost: null, cameraSeqLen: 0, referenceSeqLen: 0 },
    };
  }
  const cameraElbowL = minMax(cameraSeq.map((f) => (f.angles.leftElbow ?? null) as number | null));
  const cameraElbowR = minMax(cameraSeq.map((f) => (f.angles.rightElbow ?? null) as number | null));
  const referenceElbowL = minMax(refSeq.map((f) => (f.angles.leftElbow ?? null) as number | null));
  const referenceElbowR = minMax(refSeq.map((f) => (f.angles.rightElbow ?? null) as number | null));

  const dtw = dtwAlignMulti(cameraSeq, refSeq, leadSide);
  const angleKeys: AngleKey[] = ["leftElbow", "rightElbow", "leftKnee", "rightKnee", "leftShoulder", "rightShoulder"];

  const cameraValues: Record<AngleKey, number[]> = Object.fromEntries(angleKeys.map((k) => [k, []])) as Record<AngleKey, number[]>;
  const refValues: Record<AngleKey, number[]> = Object.fromEntries(angleKeys.map((k) => [k, []])) as Record<AngleKey, number[]>;
  const absErrors: Record<AngleKey, number[]> = Object.fromEntries(angleKeys.map((k) => [k, []])) as Record<AngleKey, number[]>;
  const signedErrors: Record<AngleKey, number[]> = Object.fromEntries(angleKeys.map((k) => [k, []])) as Record<AngleKey, number[]>;

  let matchedCount = 0;
  let dtwAvgCost: number | null = null;
  const extensionErrors: number[] = [];
  const guardErrors: number[] = [];
  const shoulderErrorsDeg: number[] = [];
  const leadElbowKey: AngleKey = leadSide === "left" ? "leftElbow" : "rightElbow";
  const rearElbowKey: AngleKey = leadSide === "left" ? "rightElbow" : "leftElbow";

  if (dtw) {
    matchedCount = dtw.path.length;
    dtwAvgCost = dtw.avgCost;
    for (const [i, j] of dtw.path) {
      const cam = cameraSeq[i];
      const ref = refSeq[j];
      const camAngles = cam?.angles;
      const refAngles = ref?.angles;
      if (!cam || !ref || !camAngles || !refAngles) continue;
      for (const k of angleKeys) {
        const c = camAngles[k];
        const r = refAngles[k];
        if (typeof c !== "number" || !Number.isFinite(c)) continue;
        if (typeof r !== "number" || !Number.isFinite(r)) continue;
        cameraValues[k].push(c);
        refValues[k].push(r);
        absErrors[k].push(Math.abs(c - r));
        signedErrors[k].push(c - r);
      }
      if (typeof cam.leadExtension === "number" && typeof ref.leadExtension === "number") {
        extensionErrors.push(Math.abs(cam.leadExtension - ref.leadExtension));
      }
      if (typeof cam.rearGuardDist === "number" && typeof ref.rearGuardDist === "number") {
        guardErrors.push(Math.abs(cam.rearGuardDist - ref.rearGuardDist));
      }
      const s0c = camAngles.leftShoulder;
      const s1c = camAngles.rightShoulder;
      const s0r = refAngles.leftShoulder;
      const s1r = refAngles.rightShoulder;
      if (typeof s0c === "number" && typeof s1c === "number" && typeof s0r === "number" && typeof s1r === "number") {
        shoulderErrorsDeg.push((Math.abs(s0c - s0r) + Math.abs(s1c - s1r)) / 2);
      }
    }
  } else {
    const validFrames = activeFrames.filter((f) => typeof f.wallClockMs === "number");
    const camOnsetMs = detectMovementOnsetMsFromPoseFrames(activeFrames);
    const refOnsetMs = detectMovementOnsetMsFromReferenceFrames(refFramesAll);
    for (const camFrame of validFrames) {
      const tAbs = camFrame.wallClockMs;
      const tAlignedAbs = camOnsetMs != null && refOnsetMs != null ? refOnsetMs + (tAbs - camOnsetMs) : tAbs;
      const refFrame = closestByWallClockMs(refFramesAll, tAlignedAbs);
      if (!refFrame) continue;
      matchedCount += 1;
      if (!camFrame.landmarks) continue;
      if (!refFrame.featureVector || refFrame.featureVector.length === 0) continue;
      const camAngles = extractAnglesFromLandmarks(camFrame.landmarks, { mirrorX });
      const refAngles = anglesFromReferenceVector(refFrame.featureVector);
      for (const k of angleKeys) {
        const c = camAngles[k];
        const r = refAngles[k];
        if (typeof c !== "number" || !Number.isFinite(c)) continue;
        if (typeof r !== "number" || !Number.isFinite(r)) continue;
        cameraValues[k].push(c);
        refValues[k].push(r);
        absErrors[k].push(Math.abs(c - r));
        signedErrors[k].push(c - r);
      }
    }
  }

  const rows: AngleDeltaRow[] = angleKeys.map((k) => {
    const actual = mean(cameraValues[k]);
    const ideal = mean(refValues[k]);
    const delta = mean(absErrors[k]);
    const signedError = mean(signedErrors[k]);
    return { key: k, label: ANGLE_LABELS[k], actualDeg: actual, idealDeg: ideal, deltaDeg: delta, signedErrorDeg: signedError };
  });

  // Compute per-feature errors (technique-specific: separate lead vs rear elbow)
  const leadElbowErrors: number[] = [];
  const rearElbowErrors: number[] = [];
  
  if (dtw) {
    for (const [i, j] of dtw.path) {
      const cam = cameraSeq[i];
      const ref = refSeq[j];
      const camAngles = cam?.angles;
      const refAngles = ref?.angles;
      if (!cam || !ref || !camAngles || !refAngles) continue;
      
      const leadElbowA = camAngles[leadElbowKey];
      const leadElbowB = refAngles[leadElbowKey];
      if (typeof leadElbowA === "number" && typeof leadElbowB === "number" && Number.isFinite(leadElbowA) && Number.isFinite(leadElbowB)) {
        leadElbowErrors.push(Math.abs(leadElbowA - leadElbowB));
      }
      
      const rearElbowA = camAngles[rearElbowKey];
      const rearElbowB = refAngles[rearElbowKey];
      if (typeof rearElbowA === "number" && typeof rearElbowB === "number" && Number.isFinite(rearElbowA) && Number.isFinite(rearElbowB)) {
        rearElbowErrors.push(Math.abs(rearElbowA - rearElbowB));
      }
    }
  } else {
    // Fallback: compute from matched pairs
    for (let i = 0; i < cameraValues[leadElbowKey].length; i += 1) {
      const leadA = cameraValues[leadElbowKey][i];
      const leadB = refValues[leadElbowKey][i];
      if (typeof leadA === "number" && typeof leadB === "number" && Number.isFinite(leadA) && Number.isFinite(leadB)) {
        leadElbowErrors.push(Math.abs(leadA - leadB));
      }
      
      const rearA = cameraValues[rearElbowKey][i];
      const rearB = refValues[rearElbowKey][i];
      if (typeof rearA === "number" && typeof rearB === "number" && Number.isFinite(rearA) && Number.isFinite(rearB)) {
        rearElbowErrors.push(Math.abs(rearA - rearB));
      }
    }
  }

  const leadElbowMae = mean(leadElbowErrors);
  const rearElbowMae = mean(rearElbowErrors);
  const extensionMae = mean(extensionErrors);
  const guardMae = mean(guardErrors);
  const shoulderMaeDeg = mean(shoulderErrorsDeg);
  
  // Technique-specific scoring (jab weights)
  const leadElbowScore = componentScoreFromError(leadElbowMae, SCORE_SCALES.elbowDeg);
  const rearElbowScore = componentScoreFromError(rearElbowMae, SCORE_SCALES.elbowDeg);
  const extensionScore = componentScoreFromError(extensionMae, SCORE_SCALES.extension);
  const guardScore = componentScoreFromError(guardMae, SCORE_SCALES.guard);
  
  const parts: Array<{ w: number; s: number | null }> = [
    { w: JAB_SCORE_WEIGHTS.leadElbow, s: leadElbowScore },
    { w: JAB_SCORE_WEIGHTS.leadExtension, s: extensionScore },
    { w: JAB_SCORE_WEIGHTS.rearGuard, s: guardScore },
    { w: JAB_SCORE_WEIGHTS.rearElbow, s: rearElbowScore }, // Minimal weight
  ];
  const wSum = parts.filter((p) => typeof p.s === "number").reduce((acc, p) => acc + p.w, 0);
  const baseScore = wSum > 0 ? parts.filter((p) => typeof p.s === "number").reduce((acc, p) => acc + p.w * (p.s as number), 0) / wSum : null;

  const penalties: Array<{ key: string; amount: number; reason: string }> = [];
  const camLeadExtSeries = cameraSeq.map((f) => f.leadExtension);
  const refLeadExtSeries = refSeq.map((f) => f.leadExtension);
  const camLeadBase = baselineMean(camLeadExtSeries, 0.2);
  const refLeadBase = baselineMean(refLeadExtSeries, 0.2);
  const camLeadPeak = maxValue(camLeadExtSeries);
  const refLeadPeak = maxValue(refLeadExtSeries);
  const EXTENSION_PEAK_RATIO = 0.75;
  const extensionThreshold = refLeadPeak != null ? EXTENSION_PEAK_RATIO * refLeadPeak : null;
  const extensionPass =
    typeof camLeadPeak === "number" &&
    Number.isFinite(camLeadPeak) &&
    typeof extensionThreshold === "number" &&
    Number.isFinite(extensionThreshold) &&
    camLeadPeak >= extensionThreshold;
  const extensionPeakExists = extensionPass;

  let recoilDetected = false;
  const refExcursion = refLeadPeak != null && refLeadBase != null ? refLeadPeak - refLeadBase : null;
  if (extensionPeakExists && refExcursion != null && camLeadBase != null) {
    const peakIdx = maxIndex(camLeadExtSeries);
    if (peakIdx != null) {
      const tPeak = cameraSeq[peakIdx]?.wallClockMs;
      if (typeof tPeak === "number" && Number.isFinite(tPeak)) {
        const tEnd = tPeak + 1500;
        const recoilTarget = camLeadBase + 0.2 * refExcursion;
        for (let i = peakIdx; i < cameraSeq.length; i += 1) {
          const t = cameraSeq[i]?.wallClockMs;
          if (typeof t !== "number" || !Number.isFinite(t)) continue;
          if (t > tEnd) break;
          const v = cameraSeq[i]?.leadExtension;
          if (typeof v === "number" && Number.isFinite(v) && v <= recoilTarget) {
            recoilDetected = true;
            break;
          }
        }
      }
    }
  }

  const jabDetected = extensionPeakExists && recoilDetected;
  if (!extensionPeakExists) {
    penalties.push({ key: "insufficient_peak_extension", amount: 60, reason: "Insufficient lead-hand extension (jab not fully thrown)" });
  }

  const camGuardSeries = cameraSeq.map((f) => f.rearGuardDist);
  const refGuardSeries = refSeq.map((f) => f.rearGuardDist);
  const camGuardBase = baselineMean(camGuardSeries, 0.2);
  const camGuardPeak = maxValue(camGuardSeries);
  const refGuardBase = baselineMean(refGuardSeries, 0.2);
  const refGuardPeak = maxValue(refGuardSeries);
  const camGuardDrop = camGuardPeak != null && camGuardBase != null ? camGuardPeak - camGuardBase : null;
  const refGuardDrop = refGuardPeak != null && refGuardBase != null ? refGuardPeak - refGuardBase : null;
  const GUARD_DROP_TOLERANCE_RATIO = 0.2;
  if (camGuardDrop != null && refGuardDrop != null && camGuardDrop > (1 + GUARD_DROP_TOLERANCE_RATIO) * refGuardDrop) {
    penalties.push({ key: "guard_drop", amount: 25, reason: "Rear-hand guard dropped too much" });
  }

  const refStepCosts: number[] = [];
  for (let i = 1; i < refSeq.length; i += 1) {
    const c = dtwCostMulti(refSeq[i - 1], refSeq[i], leadSide);
    if (typeof c === "number" && Number.isFinite(c)) refStepCosts.push(c);
  }
  const refStepCost = mean(refStepCosts) ?? null;
  const dtwCostLow = dtwAvgCost != null && Number.isFinite(dtwAvgCost) && (refStepCost == null || dtwAvgCost <= 1.2 * refStepCost);
  const ELBOW_TOLERANCE_DEG = 15;
  // leadElbowKey already defined earlier in function
  const refLeadElbowSeries = refSeq.map((f) => f.angles[leadElbowKey] ?? null);
  const camLeadElbowSeries = cameraSeq.map((f) => f.angles[leadElbowKey] ?? null);
  const refLeadElbowMM = minMax(refLeadElbowSeries);
  const camLeadElbowMM = minMax(camLeadElbowSeries);
  const elbowMatchesReference = refLeadElbowMM != null && camLeadElbowMM != null ? camLeadElbowMM.max >= refLeadElbowMM.max - ELBOW_TOLERANCE_DEG : true;
  const hasInsufficientExtensionPenalty = penalties.some((p) => p.key === "insufficient_peak_extension");
  if (!jabDetected && !((dtwCostLow && extensionPeakExists) || baseScore == null) && hasInsufficientExtensionPenalty && !elbowMatchesReference) {
    penalties.push({ key: "not_jab_like", amount: 40, reason: "Movement does not resemble a jab pattern" });
  }
  if (baseScore == null && !jabDetected) {
    penalties.push({ key: "not_jab_like", amount: 40, reason: "Movement does not resemble a jab pattern" });
  }

  const penaltyTotal = penalties.reduce((acc, p) => acc + p.amount, 0);
  const penaltyTotalCapped = Math.min(50, penaltyTotal);
  const rawScore = baseScore == null ? 0 : Math.round(baseScore - penaltyTotalCapped);
  const dtwPathLen = dtw?.path.length ?? 0;
  const scoreGuarded = baseScore != null && dtwPathLen > 10 && extensionPeakExists ? Math.max(1, rawScore) : rawScore;
  const score = Math.max(0, Math.min(100, scoreGuarded));

  const worstJoints: WorstJointHint[] = rows
    .filter((r) => typeof r.deltaDeg === "number" && Number.isFinite(r.deltaDeg) && typeof r.signedErrorDeg === "number" && Number.isFinite(r.signedErrorDeg))
    .sort((a, b) => (b.deltaDeg as number) - (a.deltaDeg as number))
    .slice(0, 2)
    .map((r) => ({ key: r.key, label: r.label, avgErrorDeg: r.deltaDeg as number, hint: hintForJoint(r.key, r.signedErrorDeg as number) }));

  // Store sequences in result for export (attach to result object)
  const result: ComparisonResult = {
    score0to100: score,
    rows,
    worstJoints,
    frameCount: activeFrames.length, // Use active window frame count
    matchedCount,
    durationMs: windowDurationMs ?? durationMs, // Use window duration
    validation: {
      validityRatio: computeValidityRatio(activeFrames),
      motionEnergy: 0, // Not used for fixed-duration attempts
    },
    debug: {
      leadSide,
      cameraMirrored: mirrorX,
      cameraPeakExtension,
      referencePeakExtension,
      extensionThreshold,
      extensionPass,
      cameraElbow: {
        left: cameraElbowL ? { min: cameraElbowL.min, max: cameraElbowL.max } : undefined,
        right: cameraElbowR ? { min: cameraElbowR.min, max: cameraElbowR.max } : undefined,
      },
      referenceElbow: {
        left: referenceElbowL ? { min: referenceElbowL.min, max: referenceElbowL.max } : undefined,
        right: referenceElbowR ? { min: referenceElbowR.min, max: referenceElbowR.max } : undefined,
      },
      // Active window info
      activeWindowStartIdx: activeWindow.startIdx,
      activeWindowEndIdx: activeWindow.endIdx,
      activeWindowDurationMs: windowDurationMs,
      activeWindowFrameCount: activeFrames.length,
      totalFrameCount: cameraFrames.length,
      peakVelocity: vPeak,
      activeWindowStartMs: activeWindow.cameraStartMs,
      activeWindowEndMs: activeWindow.cameraEndMs,
      activeWindowRefStartMs: refFramesAll.length > 0 ? (refFramesAll[0]?.wallClockMs ?? null) : null,
      activeWindowRefEndMs: refFramesAll.length > 0 ? (refFramesAll[refFramesAll.length - 1]?.wallClockMs ?? null) : null,
      extBaseline: activeWindow.extBaseline,
      extPeak: activeWindow.extPeak,
      extDelta: activeWindow.extDelta,
      extDeltaMin: extDeltaMin,
      referenceExtDelta: referenceExtDelta,
      referenceExtBaseline: referenceExtBaseline,
      peakIdx: activeWindow.peakIdx,
      windowThresholdStart: 0.25, // baseline + 0.25*delta
      windowThresholdEnd: 0.35, // baseline + 0.35*delta
      guardCameraAvg,
      guardRefAvg: refSeq.length > 0 ? mean(refSeq.map((f) => f.rearGuardDist).filter((v): v is number => typeof v === "number" && Number.isFinite(v))) : null,
      peakVelocity: vPeak,
      leadWristName: leadSide === "left" ? "left_wrist" : "right_wrist",
      leadShoulderName: leadSide === "left" ? "left_shoulder" : "right_shoulder",
      peakVelocity: vPeak,
      leadWristName: leadSide === "left" ? "left_wrist" : "right_wrist",
      leadShoulderName: leadSide === "left" ? "left_shoulder" : "right_shoulder",
    },
    featureErrors: {
      leadElbowMaeDeg: leadElbowMae,
      rearElbowMaeDeg: rearElbowMae,
      extensionMae,
      guardMae,
      shoulderMaeDeg,
    },
    penalties,
    dtw: { enabled: true, pathLength: dtw?.path.length ?? 0, avgCost: dtwAvgCost, cameraSeqLen: cameraSeq.length, referenceSeqLen: refSeq.length },
    // Store sequences for export/visualization
    cameraSeq,
    refSeq,
  };
  return result;
}

export default function LiveDemoPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const techniqueId = searchParams.get("techniqueId");
  const technique: Technique | null = useMemo(() => (techniqueId ? getTechniqueById(techniqueId) : null), [techniqueId]);
  const cameraMirrored = true;
  const [logOneFramePoints, setLogOneFramePoints] = useState(false);

  // Keep lead side consistent across camera + reference for the chosen technique.
  const leadSideRef = useRef<"left" | "right">("left");
  useEffect(() => {
    leadSideRef.current = technique?.leadSide ?? "left";
  }, [technique?.leadSide]);

  const [phase, setPhase] = useState<Phase>("idle");
  const [countdownStep, setCountdownStep] = useState<CountdownStep | null>(null);
  const [attemptIndex, setAttemptIndex] = useState(0); // 0 = not started, 1..3 = current attempt
  const [attemptRemainingMs, setAttemptRemainingMs] = useState<number | null>(null);
  const attemptTimerRef = useRef<number | null>(null);
  const [poseReady, setPoseReady] = useState(false);
  const poseReadyRef = useRef(false);
  const phaseRef = useRef<Phase>("idle");
  const attemptIndexRef = useRef(0);
  const poseCameraOverlayRef = useRef<PoseCameraOverlayHandle>(null);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const ignoreNextOnStopRef = useRef(false);
  const [aiFeedback, setAiFeedback] = useState<any | null>(null);
  const [aiFeedbackLoading, setAiFeedbackLoading] = useState(false);

  // Per-attempt frame buffers (3 attempts max)
  const attemptsRef = useRef<AttemptData[]>([
    { attemptIndex: 1, cameraFrames: [], refFrames: [], startWallClockMs: 0, endWallClockMs: null, valid: true },
    { attemptIndex: 2, cameraFrames: [], refFrames: [], startWallClockMs: 0, endWallClockMs: null, valid: true },
    { attemptIndex: 3, cameraFrames: [], refFrames: [], startWallClockMs: 0, endWallClockMs: null, valid: true },
  ]);


  // Legacy refs for backward compatibility (will be removed after full migration)
  const poseFramesRef = useRef<PoseFrame[]>([]);
  const referenceFramesRef = useRef<ReferenceFrame[]>([]);
  const cameraFramesRef = poseFramesRef;
  const refFramesRef = referenceFramesRef;

  const statusText = useMemo(() => {
    if (phase === "idle") return "Idle";
    if (phase === "countdown") return attemptIndex > 0 ? `Attempt ${attemptIndex}/3 - Starting...` : "Starting...";
    if (phase === "attempt_recording") return `Attempt ${attemptIndex}/3 - Recording (${attemptRemainingMs != null ? (attemptRemainingMs / 1000).toFixed(1) : "3.0"}s)`;
    if (phase === "results") return "Results";
    return "Recording";
  }, [phase, attemptIndex, attemptRemainingMs]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    attemptIndexRef.current = attemptIndex;
  }, [attemptIndex]);

  // Fixed-duration attempt timer: 3 seconds per attempt
  useEffect(() => {
    if (phase !== "attempt_recording") {
      // Clean up timer when not recording
      if (attemptTimerRef.current != null) {
        clearTimeout(attemptTimerRef.current);
        attemptTimerRef.current = null;
      }
      setAttemptRemainingMs(null);
      return;
    }

    const currentAttemptIdx = attemptIndexRef.current;
    if (currentAttemptIdx < 1 || currentAttemptIdx > 3) return;

    const attempt = attemptsRef.current[currentAttemptIdx - 1];
    const startTime = attempt.startWallClockMs || Date.now();
    attempt.startWallClockMs = startTime;

    // Update remaining time every 100ms
    const updateInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, ATTEMPT_DURATION_MS - elapsed);
      setAttemptRemainingMs(remaining);

      if (remaining <= 0) {
        // Attempt complete: finalize and advance
        attempt.endWallClockMs = Date.now();
        clearInterval(updateInterval);
        attemptTimerRef.current = null;

        if (currentAttemptIdx < 3) {
          setAttemptIndex(currentAttemptIdx + 1);
          setPhase("countdown");
        } else {
          // All 3 attempts complete: compute results
          setPhase("results");
        }
      }
    }, 100);

    // Set timeout for attempt completion
    attemptTimerRef.current = window.setTimeout(() => {
      clearInterval(updateInterval);
      attemptTimerRef.current = null;
      const now = Date.now();
      attempt.endWallClockMs = now;
      setAttemptRemainingMs(0);

      if (currentAttemptIdx < 3) {
        setAttemptIndex(currentAttemptIdx + 1);
        setPhase("countdown");
      } else {
        setPhase("results");
      }
    }, ATTEMPT_DURATION_MS);

    return () => {
      if (attemptTimerRef.current != null) {
        clearTimeout(attemptTimerRef.current);
        attemptTimerRef.current = null;
      }
      clearInterval(updateInterval);
    };
  }, [phase, attemptIndex]);

  // Initialize attempt when starting recording
  useEffect(() => {
    if (phase === "attempt_recording" && attemptIndex >= 1) {
      const attempt = attemptsRef.current[attemptIndex - 1];
      attempt.startWallClockMs = Date.now();
      attempt.endWallClockMs = null;
      attempt.cameraFrames = [];
      attempt.refFrames = [];
    }
  }, [phase, attemptIndex]);

  const handlePoseFrame = useCallback((frame: PoseFrame) => {
    // Mark "pose ready" once (no per-frame React state updates)
    if (!poseReadyRef.current && frame.landmarks) {
      poseReadyRef.current = true;
      setPoseReady(true);
    }

    const currentPhase = phaseRef.current;
    const currentAttemptIdx = attemptIndexRef.current;

    // Buffer frames during attempt_recording
    if (currentPhase === "attempt_recording") {
      if (currentAttemptIdx >= 1 && currentAttemptIdx <= 3) {
        const attempt = attemptsRef.current[currentAttemptIdx - 1];
        attempt.cameraFrames.push(frame);
      }
      // Also keep legacy buffer for backward compatibility
      poseFramesRef.current.push(frame);
    }


    // Trim legacy buffer
    const newestTs = frame.wallClockMs ?? Date.now();
    const cutoff = newestTs - MAX_POSE_BUFFER_MS;
    while (poseFramesRef.current.length > 0) {
      const oldest = poseFramesRef.current[0];
      const oldestTs = oldest.wallClockMs ?? 0;
      if (oldestTs >= cutoff) break;
      poseFramesRef.current.shift();
    }
  }, []);

  const handleReferenceFrame = useCallback((frame: ReferenceFrame) => {
    const currentPhase = phaseRef.current;
    const currentAttemptIdx = attemptIndexRef.current;

    // Buffer reference frames during attempt_recording
    if (currentPhase === "attempt_recording") {
      if (currentAttemptIdx >= 1 && currentAttemptIdx <= 3) {
        const attempt = attemptsRef.current[currentAttemptIdx - 1];
        attempt.refFrames.push(frame);
      }
      // Also keep legacy buffer
      referenceFramesRef.current.push(frame);
    }

    // Trim legacy buffer
    const newestTs = frame.wallClockMs ?? Date.now();
    const cutoff = newestTs - MAX_REFERENCE_BUFFER_MS;
    while (referenceFramesRef.current.length > 0) {
      const oldestTs = referenceFramesRef.current[0].wallClockMs ?? 0;
      if (oldestTs >= cutoff) break;
      referenceFramesRef.current.shift();
    }
  }, []);

  // Clear previous recording frames when starting a new run
  useEffect(() => {
    if (phase === "countdown" && attemptIndex === 1) {
      // Reset all attempts
      attemptsRef.current.forEach((a) => {
        a.cameraFrames = [];
        a.refFrames = [];
        a.startWallClockMs = 0;
        a.endWallClockMs = null;
        a.result = undefined;
        a.valid = true;
      });
      poseFramesRef.current = [];
      referenceFramesRef.current = [];
      setComparison(null);
    }
  }, [phase, attemptIndex]);

  // Compute comparison when all 3 attempts complete
  useEffect(() => {
    if (phase !== "results") return;

    const leadSide = leadSideRef.current;
    const mirrorX = cameraMirrored;

    // Score each attempt
    const perAttemptResults: Array<{ attemptIndex: number; score0to100: number | null; valid: boolean; message?: string; frameCount: number }> = [];
    const allAttemptResults: ComparisonResult[] = [];

    for (let i = 0; i < 3; i += 1) {
      const attempt = attemptsRef.current[i];
      const cameraFrames = attempt.cameraFrames;
      const refFrames = attempt.refFrames;

      if (cameraFrames.length === 0 && refFrames.length === 0) {
        // Empty attempt: mark invalid
        perAttemptResults.push({ attemptIndex: i + 1, score0to100: null, valid: false, message: "No frames captured", frameCount: 0 });
        attempt.valid = false;
        continue;
      }

      const result = scoreSingleAttempt(cameraFrames, refFrames, leadSide, mirrorX, logOneFramePoints);
      if (result == null) {
        perAttemptResults.push({ attemptIndex: i + 1, score0to100: null, valid: false, message: "Scoring failed", frameCount: cameraFrames.length });
        attempt.valid = false;
        continue;
      }

      // Store feature sequences for export (extracted during scoring)
      // These will be populated by scoreSingleAttempt if available
      attempt.result = result;
      attempt.leadSide = leadSide;
      // Store feature sequences for export
      attempt.cameraSeq = result.cameraSeq;
      attempt.refSeq = result.refSeq;
      const isValid = result.message == null || result.message === ""; // Valid if no error message
      attempt.valid = isValid;
      perAttemptResults.push({
        attemptIndex: i + 1,
        score0to100: result.score0to100,
        valid: isValid,
        message: result.message,
        frameCount: result.frameCount,
      });
      allAttemptResults.push(result);
    }

    // Aggregate results across valid attempts
    const validResults = allAttemptResults.filter((r) => r.message == null || r.message === "");
    if (validResults.length === 0) {
      setComparison({
        message: "No valid attempts detected. Please try again.",
        score0to100: null,
        rows: [],
        worstJoints: [],
        frameCount: perAttemptResults.reduce((acc, p) => acc + p.frameCount, 0),
        matchedCount: 0,
        durationMs: null,
        perAttempt: perAttemptResults,
      });
      return;
    }

    // Check if we have at least 2 valid attempts
    if (validResults.length < 2) {
      setComparison({
        message: "Not enough valid attempts (need at least 2). Please try again.",
        score0to100: null,
        rows: [],
        worstJoints: [],
        frameCount: perAttemptResults.reduce((acc, p) => acc + p.frameCount, 0),
        matchedCount: 0,
        durationMs: null,
        perAttempt: perAttemptResults,
      });
      return;
    }

    // Aggregate scores (average)
    const scores = validResults.map((r) => r.score0to100).filter((s): s is number => typeof s === "number" && Number.isFinite(s));
    const avgScore = scores.length > 0 ? Math.round(mean(scores) ?? 0) : null;

    // Aggregate per-joint errors (average across attempts)
    const angleKeys: AngleKey[] = ["leftElbow", "rightElbow", "leftKnee", "rightKnee", "leftShoulder", "rightShoulder"];
    const aggregatedRows: AngleDeltaRow[] = angleKeys.map((k) => {
      const actuals = validResults.map((r) => r.rows.find((row) => row.key === k)?.actualDeg).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      const ideals = validResults.map((r) => r.rows.find((row) => row.key === k)?.idealDeg).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      const deltas = validResults.map((r) => r.rows.find((row) => row.key === k)?.deltaDeg).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      const signedErrors = validResults.map((r) => r.rows.find((row) => row.key === k)?.signedErrorDeg).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      return {
        key: k,
        label: ANGLE_LABELS[k],
        actualDeg: mean(actuals),
        idealDeg: mean(ideals),
        deltaDeg: mean(deltas),
        signedErrorDeg: mean(signedErrors),
      };
    });

    // Aggregate worst joints (pick from first valid result for now, or could merge)
    const worstJoints = validResults[0]?.worstJoints ?? [];

    // Aggregate feature errors
    const leadElbowMaes = validResults.map((r) => r.featureErrors?.leadElbowMaeDeg).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const rearElbowMaes = validResults.map((r) => r.featureErrors?.rearElbowMaeDeg).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const elbowMaes = validResults.map((r) => r.featureErrors?.elbowMaeDeg ?? r.featureErrors?.leadElbowMaeDeg).filter((v): v is number => typeof v === "number" && Number.isFinite(v)); // Legacy fallback
    const extensionMaes = validResults.map((r) => r.featureErrors?.extensionMae).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const guardMaes = validResults.map((r) => r.featureErrors?.guardMae).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const shoulderMaes = validResults.map((r) => r.featureErrors?.shoulderMaeDeg).filter((v): v is number => typeof v === "number" && Number.isFinite(v));

    // Use first valid result's debug info (or could aggregate)
    const firstValidDebug = validResults[0]?.debug;

    setComparison({
      score0to100: avgScore,
      rows: aggregatedRows,
      worstJoints,
      frameCount: perAttemptResults.reduce((acc, p) => acc + p.frameCount, 0),
      matchedCount: validResults.reduce((acc, r) => acc + (r.matchedCount ?? 0), 0),
      durationMs: validResults.reduce((acc, r) => acc + (r.durationMs ?? 0), 0),
      perAttempt: perAttemptResults,
      featureErrors: {
        leadElbowMaeDeg: mean(leadElbowMaes),
        rearElbowMaeDeg: mean(rearElbowMaes),
        elbowMaeDeg: mean(elbowMaes), // Legacy for backward compatibility
        extensionMae: mean(extensionMaes),
        guardMae: mean(guardMaes),
        shoulderMaeDeg: mean(shoulderMaes),
      },
      debug: firstValidDebug,
      dtw: validResults[0]?.dtw,
      // Store sequences from first valid result for visualization
      cameraSeq: validResults[0]?.cameraSeq,
      refSeq: validResults[0]?.refSeq,
    });
  }, [phase, logOneFramePoints, cameraMirrored]);

  // Countdown state machine: countdown -> attempt_recording
  useEffect(() => {
    if (phase !== "countdown") return;

    let cancelled = false;
    setCountdownStep(3);

    const t1 = window.setTimeout(() => {
      if (cancelled) return;
      setCountdownStep(2);
    }, 1000);

    const t2 = window.setTimeout(() => {
      if (cancelled) return;
      setCountdownStep(1);
    }, 2000);

    const t3 = window.setTimeout(() => {
      if (cancelled) return;
      setCountdownStep("GO");
    }, 3000);

    const t4 = window.setTimeout(() => {
      if (cancelled) return;
      setCountdownStep(null);
      setPhase("attempt_recording");
    }, 3600);

    return () => {
      cancelled = true;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);
    };
  }, [phase]);

  const handleBack = () => {
    if (phase === "countdown") return;
    if (techniqueId) {
      router.push(`/get-ready?techniqueId=${techniqueId}`);
      return;
    }
    router.push("/training-setup");
  };

  const handlePrimaryAction = () => {
    if (phase === "idle") {
      setAttemptIndex(1);
      setPhase("countdown");
      return;
    }
    if (phase === "countdown") {
      setCountdownStep(null);
      setAttemptIndex(0);
      setPhase("idle");
      // Reset attempts
      attemptsRef.current.forEach((a) => {
        a.cameraFrames = [];
        a.refFrames = [];
        a.startWallClockMs = 0;
        a.endWallClockMs = null;
        a.result = undefined;
        a.valid = true;
      });
      return;
    }
    if (phase === "attempt_recording") {
      // Manual stop: finalize current attempt and advance
      const currentAttemptIdx = attemptIndexRef.current;
      if (currentAttemptIdx >= 1 && currentAttemptIdx <= 3) {
        const attempt = attemptsRef.current[currentAttemptIdx - 1];
        attempt.endWallClockMs = Date.now();
      }
      if (currentAttemptIdx < 3) {
        setAttemptIndex(currentAttemptIdx + 1);
        setPhase("countdown");
      } else {
        setPhase("results");
      }
      if (attemptTimerRef.current != null) {
        clearTimeout(attemptTimerRef.current);
        attemptTimerRef.current = null;
      }
      setAttemptRemainingMs(null);
      return;
    }
    // results
    setAttemptIndex(0);
    setPhase("idle");
    attemptsRef.current.forEach((a) => {
      a.cameraFrames = [];
      a.refFrames = [];
      a.startWallClockMs = 0;
      a.endWallClockMs = null;
      a.result = undefined;
      a.valid = true;
    });
  };

  const primaryLabel = useMemo(() => {
    if (phase === "idle") return "Start";
    if (phase === "countdown") return "Cancel";
    if (phase === "attempt_recording") return "Skip";
    return "Restart";
  }, [phase]);

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl relative">
      <div className={`space-y-4 ${phase === "countdown" ? "pointer-events-none select-none" : ""}`}>
        <Button variant="ghost" onClick={handleBack} className="mb-2" disabled={phase === "countdown"}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>

        {/* Header row */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <Button variant="default" onClick={handlePrimaryAction} className="min-w-[140px]" disabled={false}>
                  {primaryLabel}
                </Button>
                <div className="text-sm text-muted-foreground">
                  Status: <span className="text-foreground font-medium">{statusText}</span>
                  {phase === "results" ? (
                    <span className="ml-2">
                      · Frames: <span className="text-foreground font-medium">{comparison?.frameCount ?? 0}</span>
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                {technique ? (
                  <>
                    Technique: <span className="text-foreground font-medium">{technique.name}</span>
                  </>
                ) : (
                  "Technique: (none selected)"
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Split layout */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Left: Babylon animation */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold">Reference Animation</h2>
              </div>
              <div className="relative w-full aspect-square bg-muted rounded-lg overflow-hidden">
                <SceneCanvas
                  className="w-full h-full"
                  technique={technique}
                  referenceFps={15}
                  onReferenceFrame={phase === "attempt_recording" ? handleReferenceFrame : undefined}
                />
              </div>
            </CardContent>
          </Card>

          {/* Right: Camera + skeleton */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold">Live Pose</h2>
                {!poseReady ? (
                  <span className="text-xs text-muted-foreground">Loading pose…</span>
                ) : (
                  <span className="text-xs text-muted-foreground">Pose ready</span>
                )}
              </div>

              <PoseCameraOverlay
                ref={poseCameraOverlayRef}
                showVideo={true}
                mirrored={cameraMirrored}
                inferenceFps={15}
                onPoseFrame={handlePoseFrame}
              />

              {/* Attempt progress indicator */}
              {attemptIndex > 0 && attemptIndex <= 3 && (
                <div className="mt-3 rounded-lg border bg-card p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-semibold text-foreground">Attempt {attemptIndex}/3</div>
                    <div className="flex gap-1">
                      {[1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className={`h-2 w-2 rounded-full ${
                            i < attemptIndex ? "bg-green-500" : i === attemptIndex ? "bg-blue-500" : "bg-muted"
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                  {phase === "attempt_recording" && attemptRemainingMs != null && (
                    <div className="mt-2 text-center space-y-2">
                      <div className="text-2xl font-bold text-foreground">
                        {(attemptRemainingMs / 1000).toFixed(1)}s
                      </div>
                      <div className="text-xs text-muted-foreground">Recording attempt...</div>
                    </div>
                  )}
                  {phase === "attempt_recording" && (
                    <div className="text-xs text-muted-foreground text-center">
                      Perform your technique. We'll detect when you stop.
                    </div>
                  )}
                </div>
              )}

              {phase !== "attempt_recording" && phase !== "countdown" && (
                <div className="mt-3 rounded-lg border bg-card p-3 text-center text-xs text-muted-foreground">
                  {phase === "results" ? "All attempts complete. Review results below." : "Camera is on. Press Start to begin the countdown and record 3 attempts."}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Results (shown after Stop) */}
        {phase === "results" && (
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div>
                  <div className="text-base text-foreground font-semibold">Results</div>
                  <div className="text-xs text-muted-foreground">
                    Aggregated across {comparison?.perAttempt?.filter((p) => p.valid).length ?? 0} valid attempts
                    {comparison?.frameCount != null ? ` (${comparison.frameCount} total frames)` : ""}.
                    {comparison?.matchedCount != null ? ` Matched: ${comparison.matchedCount}.` : ""}
                  </div>
                </div>

                <div className="flex items-baseline justify-center gap-2">
                  <div className="text-4xl font-extrabold tabular-nums text-foreground">
                    {comparison?.score0to100 == null ? "—" : comparison.score0to100}
                  </div>
                  <div className="text-sm text-muted-foreground">/ 100</div>
                </div>

                {/* Tabbed interface for organized results */}
                <Tabs defaultValue="visualizations" className="w-full">
                  <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="visualizations">Visualizations</TabsTrigger>
                    <TabsTrigger value="raw-data">Raw Data</TabsTrigger>
                    <TabsTrigger value="ai-feedback">AI Feedback</TabsTrigger>
                    <TabsTrigger value="analytics">Analytics</TabsTrigger>
                  </TabsList>

                  {/* Visualizations Tab */}
                  <TabsContent value="visualizations" className="space-y-4 mt-4">

                    {/* Summary table and charts */}
                    {comparison && !comparison.message && comparison.cameraSeq && comparison.refSeq && (
                      <div className="space-y-4">
                        {/* Summary table */}
                        <div className="rounded-md border bg-background/50 p-3">
                          <div className="text-sm font-semibold text-foreground mb-2">Summary Metrics</div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-muted-foreground">DTW avg cost: </span>
                              <span className="text-foreground font-medium">
                                {comparison.dtw?.avgCost != null ? comparison.dtw.avgCost.toFixed(2) : "—"}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Elbow MAE: </span>
                              <span className="text-foreground font-medium">
                                {comparison.featureErrors?.leadElbowMaeDeg != null
                                  ? `${comparison.featureErrors.leadElbowMaeDeg.toFixed(1)}°`
                                  : "—"}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Extension MAE: </span>
                              <span className="text-foreground font-medium">
                                {comparison.featureErrors?.extensionMae != null
                                  ? comparison.featureErrors.extensionMae.toFixed(2)
                                  : "—"}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Guard MAE: </span>
                              <span className="text-foreground font-medium">
                                {comparison.featureErrors?.guardMae != null
                                  ? comparison.featureErrors.guardMae.toFixed(2)
                                  : "—"}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Active window: </span>
                              <span className="text-foreground font-medium">
                                {comparison.debug?.activeWindowDurationMs != null
                                  ? `${(comparison.debug.activeWindowDurationMs / 1000).toFixed(2)}s`
                                  : "—"}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Frames: </span>
                              <span className="text-foreground font-medium">
                                {comparison.debug?.activeWindowFrameCount ?? 0} / {comparison.debug?.totalFrameCount ?? 0}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Ref peak ext: </span>
                              <span className="text-foreground font-medium">
                                {comparison.debug?.referencePeakExtension != null
                                  ? comparison.debug.referencePeakExtension.toFixed(2)
                                  : "—"}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Camera peak ext: </span>
                              <span className="text-foreground font-medium">
                                {comparison.debug?.cameraPeakExtension != null
                                  ? comparison.debug.cameraPeakExtension.toFixed(2)
                                  : "—"}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Charts */}
                        <PoseComparisonCharts
                          cameraSeq={comparison.cameraSeq}
                          refSeq={comparison.refSeq}
                          leadSide={comparison.debug?.leadSide ?? "left"}
                          activeWindowStartMs={comparison.debug?.activeWindowStartMs ?? null}
                          activeWindowEndMs={comparison.debug?.activeWindowEndMs ?? null}
                        />
                      </div>
                    )}
                  </TabsContent>

                  {/* Raw Data Tab */}
                  <TabsContent value="raw-data" className="space-y-4 mt-4">
                    {/* Export buttons */}
                    {comparison && technique && (
                      <div className="flex flex-col gap-2">
                        <div className="text-sm font-semibold text-foreground mb-2">Export Data</div>
                        <div className="flex gap-2 justify-center flex-wrap">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const session = buildSessionExport(
                                technique.id,
                                attemptsRef.current.map((a) => ({
                                  attemptIndex: a.attemptIndex,
                                  cameraFrames: a.cameraFrames,
                                  refFrames: a.refFrames,
                                  result: a.result,
                                  valid: a.valid,
                                  cameraSeq: a.cameraSeq,
                                  refSeq: a.refSeq,
                                  leadSide: a.leadSide,
                                })),
                                cameraMirrored
                              );
                              const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
                              downloadJSON(session, `technique-${technique.id}-session-${timestamp}.json`);
                            }}
                          >
                            Export JSON
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const session = buildSessionExport(
                                technique.id,
                                attemptsRef.current.map((a) => ({
                                  attemptIndex: a.attemptIndex,
                                  cameraFrames: a.cameraFrames,
                                  refFrames: a.refFrames,
                                  result: a.result,
                                  valid: a.valid,
                                  cameraSeq: a.cameraSeq,
                                  refSeq: a.refSeq,
                                  leadSide: a.leadSide,
                                })),
                                cameraMirrored
                              );
                              const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
                              const csvJoints = exportToCSVJoints(session);
                              downloadCSV(csvJoints, `technique-${technique.id}-joints-${timestamp}.csv`);
                            }}
                          >
                            Export CSV (Joints)
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const session = buildSessionExport(
                                technique.id,
                                attemptsRef.current.map((a) => ({
                                  attemptIndex: a.attemptIndex,
                                  cameraFrames: a.cameraFrames,
                                  refFrames: a.refFrames,
                                  result: a.result,
                                  valid: a.valid,
                                  cameraSeq: a.cameraSeq,
                                  refSeq: a.refSeq,
                                  leadSide: a.leadSide,
                                })),
                                cameraMirrored
                              );
                              const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
                              const csvFeatures = exportToCSVFeatures(session);
                              downloadCSV(csvFeatures, `technique-${technique.id}-features-${timestamp}.csv`);
                            }}
                          >
                            Export CSV (Features)
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Per-attempt breakdown */}
                    {comparison?.perAttempt && comparison.perAttempt.length > 0 && (
                      <div className="rounded-md border bg-background/50 p-3">
                        <div className="text-sm font-semibold text-foreground mb-2">Per-Attempt Scores</div>
                        <div className="grid grid-cols-3 gap-2">
                          {comparison.perAttempt.map((attempt) => (
                            <div
                              key={attempt.attemptIndex}
                              className={`rounded border p-2 text-center ${
                                attempt.valid ? "bg-background/30" : "bg-amber-500/10 border-amber-500/30"
                              }`}
                            >
                              <div className="text-xs text-muted-foreground mb-1">Attempt {attempt.attemptIndex}</div>
                              <div className="text-lg font-bold tabular-nums text-foreground">
                                {attempt.score0to100 == null ? "—" : attempt.score0to100}
                              </div>
                              {!attempt.valid && attempt.message && (
                                <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">{attempt.message}</div>
                              )}
                              <div className="text-[10px] text-muted-foreground mt-1">{attempt.frameCount} frames</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Feature Errors */}
                    {comparison?.featureErrors ? (
                      <div className="rounded-md border bg-background/50 p-3 text-xs text-left space-y-1">
                        <div className="text-sm font-semibold text-foreground">DTW Feature Errors (MAE)</div>
                        <div className="text-muted-foreground">
                          Elbow: {comparison.featureErrors.elbowMaeDeg == null ? "—" : `${comparison.featureErrors.elbowMaeDeg.toFixed(1)}°`} ·
                          Extension: {comparison.featureErrors.extensionMae == null ? "—" : comparison.featureErrors.extensionMae.toFixed(2)} ·
                          Guard: {comparison.featureErrors.guardMae == null ? "—" : comparison.featureErrors.guardMae.toFixed(2)}
                        </div>
                        {comparison.penalties && comparison.penalties.length > 0 ? (
                          <div className="mt-2">
                            <div className="text-sm font-semibold text-foreground">Penalties</div>
                            <ul className="list-disc pl-5 text-muted-foreground">
                              {comparison.penalties.map((p) => (
                                <li key={p.key}>
                                  -{p.amount}: {p.reason}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {/* Joint Angle Table */}
                    {comparison?.message ? (
                      <div className="rounded-md border bg-background/50 p-3 text-center">
                        <div className="text-sm font-semibold text-foreground">{comparison.message}</div>
                        {comparison.validation ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            Validity: {(comparison.validation.validityRatio * 100).toFixed(0)}%
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <>
                        {comparison?.worstJoints && comparison.worstJoints.length > 0 ? (
                          <div className="rounded-md border bg-background/50 p-3 text-left">
                            <div className="text-sm font-semibold text-foreground mb-2">Top Issues</div>
                            <div className="space-y-2">
                              {comparison.worstJoints.map((w) => (
                                <div key={w.key} className="text-xs">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="text-foreground font-medium">{w.label}</div>
                                    <div className="tabular-nums text-muted-foreground">Avg error: {w.avgErrorDeg.toFixed(1)}°</div>
                                  </div>
                                  <div className="text-muted-foreground">{w.hint}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground">
                            Not enough aligned reference data to generate joint hints.
                          </div>
                        )}

                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead className="text-muted-foreground">
                              <tr className="border-b">
                                <th className="py-2 pr-3 font-medium">Angle</th>
                                <th className="py-2 pr-3 font-medium">Actual (°)</th>
                                <th className="py-2 pr-3 font-medium">Ideal (°)</th>
                                <th className="py-2 font-medium">Avg error (°)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(comparison?.rows ?? []).map((r) => (
                                <tr key={r.key} className="border-b last:border-b-0">
                                  <td className="py-2 pr-3 text-foreground">{r.label}</td>
                                  <td className="py-2 pr-3 tabular-nums">
                                    {r.actualDeg == null ? "—" : r.actualDeg.toFixed(1)}
                                  </td>
                                  <td className="py-2 pr-3 tabular-nums">
                                    {r.idealDeg == null ? "—" : r.idealDeg.toFixed(1)}
                                  </td>
                                  <td className="py-2 tabular-nums">
                                    {r.deltaDeg == null ? "—" : r.deltaDeg.toFixed(1)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </TabsContent>

                  {/* AI Feedback Tab */}
                  <TabsContent value="ai-feedback" className="space-y-4 mt-4">
                    {/* Generate AI Feedback button */}
                    {comparison && technique && (
                      <div className="flex justify-center">
                        <Button
                          variant="default"
                          size="sm"
                          disabled={aiFeedbackLoading}
                          onClick={async () => {
                            setAiFeedbackLoading(true);
                            try {
                              const session = buildSessionExport(
                                technique.id,
                                attemptsRef.current.map((a) => ({
                                  attemptIndex: a.attemptIndex,
                                  cameraFrames: a.cameraFrames,
                                  refFrames: a.refFrames,
                                  result: a.result,
                                  valid: a.valid,
                                  cameraSeq: a.cameraSeq,
                                  refSeq: a.refSeq,
                                  leadSide: a.leadSide,
                                })),
                                cameraMirrored
                              );
                              const summary = buildFeedbackSummary(session);
                              const response = await fetch("/api/ai-feedback", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ summary }),
                              });
                              if (response.ok) {
                                const feedback = await response.json();
                                setAiFeedback(feedback);
                              } else {
                                console.error("Failed to generate feedback");
                              }
                            } catch (error) {
                              console.error("Error generating feedback:", error);
                            } finally {
                              setAiFeedbackLoading(false);
                            }
                          }}
                        >
                          {aiFeedbackLoading ? "Generating..." : "Generate AI Feedback"}
                        </Button>
                      </div>
                    )}

                    {/* AI Feedback display */}
                    {aiFeedback && (
                      <div className="rounded-md border bg-background/50 p-4 space-y-3">
                        <div className="text-sm font-semibold text-foreground">AI Coaching Feedback</div>
                        <div className="text-base font-bold text-foreground">{aiFeedback.headline}</div>
                        {aiFeedback.topFixes && aiFeedback.topFixes.length > 0 && (
                          <div>
                            <div className="text-sm font-semibold text-foreground mb-2">Top Fixes</div>
                            <ul className="space-y-2">
                              {aiFeedback.topFixes.map((fix: any, i: number) => (
                                <li key={i} className="text-xs">
                                  <div className="flex items-start gap-2">
                                    <span
                                      className={`text-xs px-1.5 py-0.5 rounded ${
                                        fix.priority === "high"
                                          ? "bg-red-500/20 text-red-600 dark:text-red-400"
                                          : fix.priority === "medium"
                                            ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                                            : "bg-blue-500/20 text-blue-600 dark:text-blue-400"
                                      }`}
                                    >
                                      {fix.priority}
                                    </span>
                                    <div>
                                      <div className="font-medium text-foreground">{fix.issue}</div>
                                      <div className="text-muted-foreground">{fix.fix}</div>
                                    </div>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {aiFeedback.drill && (
                          <div>
                            <div className="text-sm font-semibold text-foreground mb-1">Drill</div>
                            <div className="text-xs text-muted-foreground">{aiFeedback.drill}</div>
                          </div>
                        )}
                        {aiFeedback.whatToFocusNext && (
                          <div>
                            <div className="text-sm font-semibold text-foreground mb-1">Focus Next</div>
                            <div className="text-xs text-muted-foreground">{aiFeedback.whatToFocusNext}</div>
                          </div>
                        )}
                        {aiFeedback.safetyNotes && (
                          <div>
                            <div className="text-sm font-semibold text-foreground mb-1">Safety</div>
                            <div className="text-xs text-amber-600 dark:text-amber-400">{aiFeedback.safetyNotes}</div>
                          </div>
                        )}
                      </div>
                    )}
                  </TabsContent>

                  {/* Analytics Tab */}
                  <TabsContent value="analytics" className="space-y-4 mt-4">

                {comparison?.debug ? (
                  <div className="rounded-md border bg-background/50 p-3 text-xs text-left space-y-2">
                    <div className="text-sm font-semibold text-foreground">Feature debug</div>
                    <div className="text-muted-foreground">
                      leadSide: <span className="text-foreground font-medium">{comparison.debug.leadSide}</span> · mirrored:{" "}
                      <span className="text-foreground font-medium">{comparison.debug.cameraMirrored ? "yes" : "no"}</span>
                    </div>
                    {/* Active Window Info */}
                    {comparison.debug.activeWindowStartIdx != null && comparison.debug.activeWindowEndIdx != null ? (
                      <div className="rounded border bg-background/30 p-2 space-y-1">
                        <div className="text-xs font-semibold text-foreground">Active Motion Window</div>
                        <div className="text-muted-foreground">
                          Duration: <span className="text-foreground font-medium">
                            {comparison.debug.activeWindowDurationMs != null ? (comparison.debug.activeWindowDurationMs / 1000).toFixed(2) : "—"}s
                          </span> · Frames: <span className="text-foreground font-medium">{comparison.debug.activeWindowFrameCount ?? 0}</span> / {comparison.debug.totalFrameCount ?? 0}
                        </div>
                        <div className="text-muted-foreground text-[10px]">
                          Camera: idx {comparison.debug.activeWindowStartIdx}–{comparison.debug.activeWindowEndIdx}
                          {comparison.debug.activeWindowStartMs != null && comparison.debug.activeWindowEndMs != null ? (
                            <> · {new Date(comparison.debug.activeWindowStartMs).toLocaleTimeString()}–{new Date(comparison.debug.activeWindowEndMs).toLocaleTimeString()}</>
                          ) : null}
                        </div>
                        {comparison.debug.activeWindowRefStartMs != null && comparison.debug.activeWindowRefEndMs != null ? (
                          <div className="text-muted-foreground text-[10px]">
                            Reference: {new Date(comparison.debug.activeWindowRefStartMs).toLocaleTimeString()}–{new Date(comparison.debug.activeWindowRefEndMs).toLocaleTimeString()}
                          </div>
                        ) : null}
                        {comparison.debug.extBaseline != null && comparison.debug.extPeak != null && comparison.debug.extDelta != null ? (
                          <>
                            <div className="text-muted-foreground text-[10px] mt-1 pt-1 border-t border-border/50 space-y-1">
                              <div>
                                extBaseline: <span className="text-foreground font-medium">{comparison.debug.extBaseline.toFixed(3)}</span> · 
                                extPeak: <span className="text-foreground font-medium">{comparison.debug.extPeak.toFixed(3)}</span> · 
                                extDelta: <span className="text-foreground font-medium">{comparison.debug.extDelta.toFixed(3)}</span>
                                {comparison.debug.extDeltaMin != null ? (
                                  <> · extDeltaMin: <span className="text-foreground font-medium">{comparison.debug.extDeltaMin.toFixed(3)}</span></>
                                ) : null}
                              </div>
                              {comparison.debug.peakVelocity != null ? (
                                <div>
                                  vPeak: <span className="text-foreground font-medium">{comparison.debug.peakVelocity.toFixed(3)}</span>
                                </div>
                              ) : null}
                              {comparison.debug.leadWristName && comparison.debug.leadShoulderName ? (
                                <div>
                                  leadSide: <span className="text-foreground font-medium">{comparison.debug.leadSide}</span> · 
                                  leadWrist: <span className="text-foreground font-medium">{comparison.debug.leadWristName}</span> · 
                                  leadShoulder: <span className="text-foreground font-medium">{comparison.debug.leadShoulderName}</span> · 
                                  mirrored: <span className="text-foreground font-medium">{comparison.debug.cameraMirrored ? "yes" : "no"}</span>
                                </div>
                              ) : null}
                              {comparison.debug.referenceExtDelta != null ? (
                                <div>
                                  Reference: extDelta={comparison.debug.referenceExtDelta.toFixed(3)}, 
                                  extBaseline={comparison.debug.referenceExtBaseline?.toFixed(3) ?? "N/A"}
                                </div>
                              ) : null}
                              {comparison.debug.windowThresholdStart != null && comparison.debug.windowThresholdEnd != null ? (
                                <div>
                                  Thresholds: start ≤ baseline + {comparison.debug.windowThresholdStart * 100}%·delta, end ≤ baseline + {comparison.debug.windowThresholdEnd * 100}%·delta
                                </div>
                              ) : null}
                            </div>
                            {comparison.debug.peakIdx != null ? (
                              <div className="text-muted-foreground text-[10px]">
                                Peak at idx: <span className="text-foreground font-medium">{comparison.debug.peakIdx}</span>
                              </div>
                            ) : null}
                          </>
                        ) : null}
                        {comparison.debug.guardCameraAvg != null && comparison.debug.guardRefAvg != null ? (
                          <div className="text-muted-foreground text-[10px] mt-1 pt-1 border-t border-border/50">
                            Guard avg: camera <span className="text-foreground font-medium">{comparison.debug.guardCameraAvg.toFixed(3)}</span> · ref <span className="text-foreground font-medium">{comparison.debug.guardRefAvg.toFixed(3)}</span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="text-muted-foreground">
                      referencePeakExtension:{" "}
                      <span className="text-foreground font-medium">
                        {comparison.debug.referencePeakExtension == null ? "—" : comparison.debug.referencePeakExtension.toFixed(2)}
                      </span>{" "}
                      · cameraPeakExtension:{" "}
                      <span className="text-foreground font-medium">
                        {comparison.debug.cameraPeakExtension == null ? "—" : comparison.debug.cameraPeakExtension.toFixed(2)}
                      </span>
                    </div>
                    <div className="text-muted-foreground">
                      extension gate:{" "}
                      <span className="text-foreground font-medium">
                        {comparison.debug.extensionPass == null ? "—" : comparison.debug.extensionPass ? "PASS" : "FAIL"}
                      </span>{" "}
                      · threshold:{" "}
                      <span className="text-foreground font-medium">
                        {comparison.debug.extensionThreshold == null ? "—" : comparison.debug.extensionThreshold.toFixed(2)}
                      </span>{" "}
                      · expr:{" "}
                      <span className="text-foreground font-medium">
                        {comparison.debug.cameraPeakExtension == null || comparison.debug.referencePeakExtension == null
                          ? "—"
                          : `${comparison.debug.cameraPeakExtension.toFixed(2)} >= 0.75*${comparison.debug.referencePeakExtension.toFixed(2)}`}
                      </span>
                    </div>

                    <div className="flex items-center justify-between rounded border bg-background/30 p-2">
                      <div className="text-muted-foreground">Log one-frame points (shoulder/elbow/wrist)</div>
                      <Switch checked={logOneFramePoints} onCheckedChange={setLogOneFramePoints} />
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="rounded border bg-background/30 p-2">
                        <div className="font-semibold text-foreground mb-1">Reference elbow (deg)</div>
                        <div className="text-muted-foreground">
                          L:{" "}
                          {comparison.debug.referenceElbow?.left
                            ? `${comparison.debug.referenceElbow.left.min.toFixed(1)}–${comparison.debug.referenceElbow.left.max.toFixed(1)}`
                            : "—"}
                          {" · "}R:{" "}
                          {comparison.debug.referenceElbow?.right
                            ? `${comparison.debug.referenceElbow.right.min.toFixed(1)}–${comparison.debug.referenceElbow.right.max.toFixed(1)}`
                            : "—"}
                        </div>
                      </div>
                      <div className="rounded border bg-background/30 p-2">
                        <div className="font-semibold text-foreground mb-1">Camera elbow (deg)</div>
                        <div className="text-muted-foreground">
                          L:{" "}
                          {comparison.debug.cameraElbow?.left
                            ? `${comparison.debug.cameraElbow.left.min.toFixed(1)}–${comparison.debug.cameraElbow.left.max.toFixed(1)}`
                            : "—"}
                          {" · "}R:{" "}
                          {comparison.debug.cameraElbow?.right
                            ? `${comparison.debug.cameraElbow.right.min.toFixed(1)}–${comparison.debug.cameraElbow.right.max.toFixed(1)}`
                            : "—"}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                    {/* Debug info */}
                    <div className="text-[11px] text-muted-foreground">
                      Debug: cameraFramesRef={cameraFramesRef.current.length} · refFramesRef={refFramesRef.current.length}
                      {comparison?.debug
                        ? ` · leadSide=${comparison.debug.leadSide} · cameraPeakExt=${comparison.debug.cameraPeakExtension == null ? "—" : comparison.debug.cameraPeakExtension.toFixed(2)} · referencePeakExt=${comparison.debug.referencePeakExtension == null ? "—" : comparison.debug.referencePeakExtension.toFixed(2)} · mirrored=${comparison.debug.cameraMirrored ? "yes" : "no"}`
                        : ""}
                      {comparison?.dtw ? ` · DTW: ${comparison.dtw.pathLength} (${comparison.dtw.cameraSeqLen}×${comparison.dtw.referenceSeqLen})` : ""}
                    </div>

                    {comparison?.debug ? (
                      <div className="rounded-md border bg-background/50 p-3 text-xs text-left space-y-2">
                        <div className="text-sm font-semibold text-foreground">Feature Debug</div>
                        <div className="text-muted-foreground">
                          leadSide: <span className="text-foreground font-medium">{comparison.debug.leadSide}</span> · mirrored:{" "}
                          <span className="text-foreground font-medium">{comparison.debug.cameraMirrored ? "yes" : "no"}</span>
                        </div>
                        {/* Active Window Info */}
                        {comparison.debug.activeWindowStartIdx != null && comparison.debug.activeWindowEndIdx != null ? (
                          <div className="rounded border bg-background/30 p-2 space-y-1">
                            <div className="text-xs font-semibold text-foreground">Active Motion Window</div>
                            <div className="text-muted-foreground">
                              Duration: <span className="text-foreground font-medium">
                                {comparison.debug.activeWindowDurationMs != null ? (comparison.debug.activeWindowDurationMs / 1000).toFixed(2) : "—"}s
                              </span> · Frames: <span className="text-foreground font-medium">{comparison.debug.activeWindowFrameCount ?? 0}</span> / {comparison.debug.totalFrameCount ?? 0}
                            </div>
                            <div className="text-muted-foreground text-[10px]">
                              Camera: idx {comparison.debug.activeWindowStartIdx}–{comparison.debug.activeWindowEndIdx}
                              {comparison.debug.activeWindowStartMs != null && comparison.debug.activeWindowEndMs != null ? (
                                <> · {new Date(comparison.debug.activeWindowStartMs).toLocaleTimeString()}–{new Date(comparison.debug.activeWindowEndMs).toLocaleTimeString()}</>
                              ) : null}
                            </div>
                            {comparison.debug.activeWindowRefStartMs != null && comparison.debug.activeWindowRefEndMs != null ? (
                              <div className="text-muted-foreground text-[10px]">
                                Reference: {new Date(comparison.debug.activeWindowRefStartMs).toLocaleTimeString()}–{new Date(comparison.debug.activeWindowRefEndMs).toLocaleTimeString()}
                              </div>
                            ) : null}
                            {comparison.debug.extBaseline != null && comparison.debug.extPeak != null && comparison.debug.extDelta != null ? (
                              <>
                                <div className="text-muted-foreground text-[10px] mt-1 pt-1 border-t border-border/50 space-y-1">
                                  <div>
                                    extBaseline: <span className="text-foreground font-medium">{comparison.debug.extBaseline.toFixed(3)}</span> · 
                                    extPeak: <span className="text-foreground font-medium">{comparison.debug.extPeak.toFixed(3)}</span> · 
                                    extDelta: <span className="text-foreground font-medium">{comparison.debug.extDelta.toFixed(3)}</span>
                                    {comparison.debug.extDeltaMin != null ? (
                                      <> · extDeltaMin: <span className="text-foreground font-medium">{comparison.debug.extDeltaMin.toFixed(3)}</span></>
                                    ) : null}
                                  </div>
                                  {comparison.debug.peakVelocity != null ? (
                                    <div>
                                      vPeak: <span className="text-foreground font-medium">{comparison.debug.peakVelocity.toFixed(3)}</span>
                                    </div>
                                  ) : null}
                                  {comparison.debug.leadWristName && comparison.debug.leadShoulderName ? (
                                    <div>
                                      leadSide: <span className="text-foreground font-medium">{comparison.debug.leadSide}</span> · 
                                      leadWrist: <span className="text-foreground font-medium">{comparison.debug.leadWristName}</span> · 
                                      leadShoulder: <span className="text-foreground font-medium">{comparison.debug.leadShoulderName}</span> · 
                                      mirrored: <span className="text-foreground font-medium">{comparison.debug.cameraMirrored ? "yes" : "no"}</span>
                                    </div>
                                  ) : null}
                                  {comparison.debug.referenceExtDelta != null ? (
                                    <div>
                                      Reference: extDelta={comparison.debug.referenceExtDelta.toFixed(3)}, 
                                      extBaseline={comparison.debug.referenceExtBaseline?.toFixed(3) ?? "N/A"}
                                    </div>
                                  ) : null}
                                  {comparison.debug.windowThresholdStart != null && comparison.debug.windowThresholdEnd != null ? (
                                    <div>
                                      Thresholds: start ≤ baseline + {comparison.debug.windowThresholdStart * 100}%·delta, end ≤ baseline + {comparison.debug.windowThresholdEnd * 100}%·delta
                                    </div>
                                  ) : null}
                                </div>
                                {comparison.debug.peakIdx != null ? (
                                  <div className="text-muted-foreground text-[10px]">
                                    Peak at idx: <span className="text-foreground font-medium">{comparison.debug.peakIdx}</span>
                                  </div>
                                ) : null}
                              </>
                            ) : null}
                            {comparison.debug.guardCameraAvg != null && comparison.debug.guardRefAvg != null ? (
                              <div className="text-muted-foreground text-[10px] mt-1 pt-1 border-t border-border/50">
                                Guard avg: camera <span className="text-foreground font-medium">{comparison.debug.guardCameraAvg.toFixed(3)}</span> · ref <span className="text-foreground font-medium">{comparison.debug.guardRefAvg.toFixed(3)}</span>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        <div className="text-muted-foreground">
                          referencePeakExtension:{" "}
                          <span className="text-foreground font-medium">
                            {comparison.debug.referencePeakExtension == null ? "—" : comparison.debug.referencePeakExtension.toFixed(2)}
                          </span>{" "}
                          · cameraPeakExtension:{" "}
                          <span className="text-foreground font-medium">
                            {comparison.debug.cameraPeakExtension == null ? "—" : comparison.debug.cameraPeakExtension.toFixed(2)}
                          </span>
                        </div>
                        <div className="text-muted-foreground">
                          extension gate:{" "}
                          <span className="text-foreground font-medium">
                            {comparison.debug.extensionPass == null ? "—" : comparison.debug.extensionPass ? "PASS" : "FAIL"}
                          </span>{" "}
                          · threshold:{" "}
                          <span className="text-foreground font-medium">
                            {comparison.debug.extensionThreshold == null ? "—" : comparison.debug.extensionThreshold.toFixed(2)}
                          </span>{" "}
                          · expr:{" "}
                          <span className="text-foreground font-medium">
                            {comparison.debug.cameraPeakExtension == null || comparison.debug.referencePeakExtension == null
                              ? "—"
                              : `${comparison.debug.cameraPeakExtension.toFixed(2)} >= 0.75*${comparison.debug.referencePeakExtension.toFixed(2)}`}
                          </span>
                        </div>

                        <div className="flex items-center justify-between rounded border bg-background/30 p-2">
                          <div className="text-muted-foreground">Log one-frame points (shoulder/elbow/wrist)</div>
                          <Switch checked={logOneFramePoints} onCheckedChange={setLogOneFramePoints} />
                        </div>

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <div className="rounded border bg-background/30 p-2">
                            <div className="font-semibold text-foreground mb-1">Reference elbow (deg)</div>
                            <div className="text-muted-foreground">
                              L:{" "}
                              {comparison.debug.referenceElbow?.left
                                ? `${comparison.debug.referenceElbow.left.min.toFixed(1)}–${comparison.debug.referenceElbow.left.max.toFixed(1)}`
                                : "—"}
                              {" · "}R:{" "}
                              {comparison.debug.referenceElbow?.right
                                ? `${comparison.debug.referenceElbow.right.min.toFixed(1)}–${comparison.debug.referenceElbow.right.max.toFixed(1)}`
                                : "—"}
                            </div>
                          </div>
                          <div className="rounded border bg-background/30 p-2">
                            <div className="font-semibold text-foreground mb-1">Camera elbow (deg)</div>
                            <div className="text-muted-foreground">
                              L:{" "}
                              {comparison.debug.cameraElbow?.left
                                ? `${comparison.debug.cameraElbow.left.min.toFixed(1)}–${comparison.debug.cameraElbow.left.max.toFixed(1)}`
                                : "—"}
                              {" · "}R:{" "}
                              {comparison.debug.cameraElbow?.right
                                ? `${comparison.debug.cameraElbow.right.min.toFixed(1)}–${comparison.debug.cameraElbow.right.max.toFixed(1)}`
                                : "—"}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </TabsContent>
                </Tabs>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Countdown overlay */}
      {phase === "countdown" && countdownStep !== null && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm pointer-events-auto">
          <div className="text-center space-y-3">
            {attemptIndex > 0 && (
              <div className="text-sm text-muted-foreground">Attempt {attemptIndex}/3</div>
            )}
            <div className="text-6xl sm:text-7xl font-extrabold tracking-tight tabular-nums">
              {countdownStep}
            </div>
            <div className="text-sm text-muted-foreground">
              {attemptIndex > 0 ? `Starting attempt ${attemptIndex}…` : "Starting practice… please hold position."}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

