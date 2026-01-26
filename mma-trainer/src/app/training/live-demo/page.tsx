"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";

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

export type ComparisonResult = {
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
    referenceWindowStartIdx?: number | null;
    referenceWindowEndIdx?: number | null;
    referenceWindowLength?: number | null;
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
    peakFrameDebug?: {
      cameraPeakIdx: number;
      referencePeakIdx: number;
      camera: {
        leadSide: "left" | "right";
        mirrored: boolean;
        leadElbowAngle: number | null;
        leadElbowDelta: number | null; // ΔAngle = angle - baseline
        leadElbowBaseline: number | null;
        leadElbowPoints: {
          shoulder: { x: number; y: number; z: number } | null;
          elbow: { x: number; y: number; z: number } | null;
          wrist: { x: number; y: number; z: number } | null;
        };
        shoulderAngle: number | null;
        shoulderDelta: number | null; // ΔAngle = angle - baseline
        shoulderBaseline: number | null;
        shoulderPoints: {
          torso: { x: number; y: number; z: number } | null;
          shoulder: { x: number; y: number; z: number } | null;
          elbow: { x: number; y: number; z: number } | null;
        };
        extension: {
          baseline: number | null;
          peak: number | null;
          delta: number | null;
          current: number | null;
        };
        guard: number | null;
        timeToPeakMs: number | null;
      };
      reference: {
        leadSide: "left" | "right";
        leadElbowAngle: number | null;
        leadElbowDelta: number | null; // ΔAngle = angle - baseline
        leadElbowBaseline: number | null;
        leadElbowPoints: {
          shoulder: { x: number; y: number; z: number } | null;
          elbow: { x: number; y: number; z: number } | null;
          wrist: { x: number; y: number; z: number } | null;
        };
        shoulderAngle: number | null;
        shoulderDelta: number | null; // ΔAngle = angle - baseline
        shoulderBaseline: number | null;
        shoulderPoints: {
          torso: { x: number; y: number; z: number } | null;
          shoulder: { x: number; y: number; z: number } | null;
          elbow: { x: number; y: number; z: number } | null;
        };
        extension: {
          baseline: number | null;
          peak: number | null;
          delta: number | null;
          current: number | null;
        };
        guard: number | null;
        timeToPeakMs: number | null;
      };
      mappingWarning?: string;
      dtwCostOnDelta?: number | null;
    };
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

/**
 * Calculate component score from error with spasm margin.
 * Spasm margin accounts for skeleton tracking inaccuracies - small errors are ignored.
 */
function componentScoreFromError(err: number | null, scale: number, spasmMargin?: number): number | null {
  if (err == null || !Number.isFinite(err)) return null;
  // Apply spasm margin: errors below this threshold are treated as perfect (1.0)
  const margin = spasmMargin ?? (scale * 0.05); // Default 5% of scale
  if (err <= margin) return 1.0;
  // Return 0-1 scale (will be multiplied by 100 later to get 0-100)
  // Adjust error by subtracting margin before scaling
  const adjustedError = err - margin;
  return clamp01(1 - adjustedError / scale);
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
  lk?: { x: number; y: number; z: number };
  rk?: { x: number; y: number; z: number };
  la?: { x: number; y: number; z: number };
  ra?: { x: number; y: number; z: number };
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
    lk: p.leftKnee ? rotXY(p.leftKnee) : undefined,
    rk: p.rightKnee ? rotXY(p.rightKnee) : undefined,
    la: p.leftAnkle ? rotXY(p.leftAnkle) : undefined,
    ra: p.rightAnkle ? rotXY(p.rightAnkle) : undefined,
  };
}

function computeReferenceLeadExtension(frame: ReferenceFrame, leadSide: "left" | "right"): number | null {
  if (!frame.limbPositions) return null;
  const norm = normalizeReferencePoints(frame.limbPositions);
  if (!norm) return null;

  const shoulderCenter = { x: (norm.ls.x + norm.rs.x) / 2, y: (norm.ls.y + norm.rs.y) / 2, z: (norm.ls.z + norm.rs.z) / 2 };
  const torsoLength = Math.max(1e-6, dist3({ x: 0, y: 0, z: 0 }, shoulderCenter));

  // Dimensionless extension metric: |wrist - shoulder| / torsoLength
  const extL = norm.lw ? dist3(norm.lw, norm.ls) / torsoLength : null;
  const extR = norm.rw ? dist3(norm.rw, norm.rs) / torsoLength : null;
  const leadExt = leadSide === "left" ? extL : extR;
  return typeof leadExt === "number" && Number.isFinite(leadExt) ? leadExt : null;
}

function computeReferenceKickMetrics(
  frame: ReferenceFrame
): { left: { ext: number | null; ankleY: number | null; kneeAngle: number | null }; right: { ext: number | null; ankleY: number | null; kneeAngle: number | null } } | null {
  if (!frame.limbPositions) return null;
  const norm = normalizeReferencePoints(frame.limbPositions);
  if (!norm) return null;

  const shoulderCenter = { x: (norm.ls.x + norm.rs.x) / 2, y: (norm.ls.y + norm.rs.y) / 2, z: (norm.ls.z + norm.rs.z) / 2 };
  const torsoLength = Math.max(1e-6, dist3({ x: 0, y: 0, z: 0 }, shoulderCenter));

  // Leg extension metric: |ankle - hip| / torsoLength
  const extL = norm.la ? dist3(norm.la, norm.lh) / torsoLength : null;
  const extR = norm.ra ? dist3(norm.ra, norm.rh) / torsoLength : null;
  const kneeL = norm.lh && norm.lk && norm.la ? angleDeg3(norm.lh, norm.lk, norm.la) : null;
  const kneeR = norm.rh && norm.rk && norm.ra ? angleDeg3(norm.rh, norm.rk, norm.ra) : null;
  return {
    left: {
      ext: typeof extL === "number" && Number.isFinite(extL) ? extL : null,
      ankleY: typeof norm.la?.y === "number" && Number.isFinite(norm.la.y) ? norm.la.y : null,
      kneeAngle: typeof kneeL === "number" && Number.isFinite(kneeL) ? kneeL : null,
    },
    right: {
      ext: typeof extR === "number" && Number.isFinite(extR) ? extR : null,
      ankleY: typeof norm.ra?.y === "number" && Number.isFinite(norm.ra.y) ? norm.ra.y : null,
      kneeAngle: typeof kneeR === "number" && Number.isFinite(kneeR) ? kneeR : null,
    },
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
    // Validate: if skeleton mapping is missing (empty featureVector), skip this frame
    // Do NOT silently compute garbage - mark as invalid
    if (!f.referenceValid || !f.featureVector || f.featureVector.length === 0) {
      continue;
    }
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
/**
 * Compute baseline angles as median of first 10-20% of active window.
 * Returns baseline angles for elbows and shoulders.
 */
function computeBaselineAngles(
  seq: MultiFeatureFrame[],
  leadSide: "left" | "right"
): {
  leadElbow: number | null;
  rearElbow: number | null;
  leadShoulder: number | null;
  rearShoulder: number | null;
} {
  if (seq.length === 0) {
    return { leadElbow: null, rearElbow: null, leadShoulder: null, rearShoulder: null };
  }
  
  const baselineWindowSize = Math.max(1, Math.floor(seq.length * 0.15)); // 15% of window
  const baselineFrames = seq.slice(0, baselineWindowSize);
  
  const leadElbowKey: AngleKey = leadSide === "left" ? "leftElbow" : "rightElbow";
  const rearElbowKey: AngleKey = leadSide === "left" ? "rightElbow" : "leftElbow";
  const leadShoulderKey: AngleKey = leadSide === "left" ? "leftShoulder" : "rightShoulder";
  const rearShoulderKey: AngleKey = leadSide === "left" ? "rightShoulder" : "leftShoulder";
  
  const leadElbowValues = baselineFrames
    .map((f) => f.angles[leadElbowKey])
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const rearElbowValues = baselineFrames
    .map((f) => f.angles[rearElbowKey])
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const leadShoulderValues = baselineFrames
    .map((f) => f.angles[leadShoulderKey])
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const rearShoulderValues = baselineFrames
    .map((f) => f.angles[rearShoulderKey])
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  
  return {
    leadElbow: leadElbowValues.length > 0 ? median(leadElbowValues) : null,
    rearElbow: rearElbowValues.length > 0 ? median(rearElbowValues) : null,
    leadShoulder: leadShoulderValues.length > 0 ? median(leadShoulderValues) : null,
    rearShoulder: rearShoulderValues.length > 0 ? median(rearShoulderValues) : null,
  };
}

/**
 * Create delta angle sequences (angle[t] - baseline) for DTW alignment.
 * For jabs, we compare movement quality (delta angles) instead of absolute angles.
 */
function createDeltaAngleSequence(
  seq: MultiFeatureFrame[],
  baseline: ReturnType<typeof computeBaselineAngles>,
  leadSide: "left" | "right"
): Array<{
  wallClockMs: number;
  leadElbowDelta: number | null;
  leadExtension: number | null;
  rearGuardDist: number | null;
}> {
  const leadElbowKey: AngleKey = leadSide === "left" ? "leftElbow" : "rightElbow";
  
  return seq.map((f) => {
    const leadElbow = f.angles[leadElbowKey];
    const leadElbowDelta = 
      typeof leadElbow === "number" && Number.isFinite(leadElbow) && baseline.leadElbow != null
        ? leadElbow - baseline.leadElbow
        : null;
    
    return {
      wallClockMs: f.wallClockMs,
      leadElbowDelta,
      leadExtension: f.leadExtension,
      rearGuardDist: f.rearGuardDist,
    };
  });
}

/**
 * DTW cost function for delta-based sequences (movement quality comparison).
 * Compares delta angles (movement from baseline) instead of absolute angles.
 */
function dtwCostDelta(
  a: { leadElbowDelta: number | null; leadExtension: number | null; rearGuardDist: number | null },
  b: { leadElbowDelta: number | null; leadExtension: number | null; rearGuardDist: number | null }
): number | null {
  // Extension delta similarity (most important - 50% weight)
  const extA = a.leadExtension;
  const extB = b.leadExtension;
  if (typeof extA !== "number" || typeof extB !== "number" || !Number.isFinite(extA) || !Number.isFinite(extB)) {
    return null;
  }
  const extCost = Math.abs(extA - extB);

  // Guard distance similarity (15% weight)
  const guardA = a.rearGuardDist;
  const guardB = b.rearGuardDist;
  if (typeof guardA !== "number" || typeof guardB !== "number" || !Number.isFinite(guardA) || !Number.isFinite(guardB)) {
    return null;
  }
  const guardCost = Math.abs(guardA - guardB);

  // Delta elbow angle similarity (movement quality)
  const elbowDeltaA = a.leadElbowDelta;
  const elbowDeltaB = b.leadElbowDelta;
  const elbowDeltaCost = 
    typeof elbowDeltaA === "number" && typeof elbowDeltaB === "number" && Number.isFinite(elbowDeltaA) && Number.isFinite(elbowDeltaB)
      ? Math.abs(elbowDeltaA - elbowDeltaB)
      : 0;

  // Weights: extension (50%), guard (15%), delta elbow (35% for alignment quality)
  return (
    0.50 * extCost * 30.0 + // Scale extension cost
    0.15 * guardCost * 30.0 + // Scale guard cost
    0.35 * elbowDeltaCost * 1.0 // Delta elbow cost
  );
}

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

/**
 * DTW alignment using delta-based sequences (for movement quality comparison).
 */
function dtwAlignDelta(
  cameraDeltaSeq: Array<{ leadElbowDelta: number | null; leadExtension: number | null; rearGuardDist: number | null }>,
  refDeltaSeq: Array<{ leadElbowDelta: number | null; leadExtension: number | null; rearGuardDist: number | null }>
): { path: Array<[number, number]>; avgCost: number } | null {
  const n = cameraDeltaSeq.length;
  const m = refDeltaSeq.length;
  if (n === 0 || m === 0) return null;

  // If endpoints don't have required features, DTW becomes unstable; bail out.
  if (dtwCostDelta(cameraDeltaSeq[0], refDeltaSeq[0]) == null || dtwCostDelta(cameraDeltaSeq[n - 1], refDeltaSeq[m - 1]) == null) {
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

  const cost00 = dtwCostDelta(cameraDeltaSeq[0], refDeltaSeq[0]);
  if (cost00 == null) return null;
  dp[0][0] = cost00;
  prev[0][0] = 0;

  for (let i = 0; i < n; i += 1) {
    const jStart = Math.max(0, i - window);
    const jEnd = Math.min(m - 1, i + window);
    for (let j = jStart; j <= jEnd; j += 1) {
      if (i === 0 && j === 0) continue;
      const c = dtwCostDelta(cameraDeltaSeq[i], refDeltaSeq[j]);
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
  const costs: number[] = [];
  for (const [i, j] of path) {
    const c = dtwCostDelta(cameraDeltaSeq[i], refDeltaSeq[j]);
    if (c != null) costs.push(c);
  }
  const avgCost = costs.length > 0 ? mean(costs) : null;
  return avgCost != null ? { path, avgCost } : null;
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
    : 1000 / 30; // Default 30fps (matches inference rate)
  const fps = avgDt > 0 ? 1000 / avgDt : 30;
  const paddingStartFrames = Math.round(0.15 * fps);
  const paddingEndFrames = Math.round(0.20 * fps);
  
  startIdx = Math.max(0, startIdx - paddingStartFrames);
  endIdx = Math.min(frames.length - 1, endIdx + paddingEndFrames);

  // Enforce minimum window length (>= 10 frames)
  // If window is too short, expand around peak velocity
  const MIN_WINDOW_LENGTH = 10;
  const windowLength = endIdx - startIdx + 1;
  if (windowLength < MIN_WINDOW_LENGTH) {
    // Expand around peak: take N frames before and after peak
    const framesBefore = Math.floor(MIN_WINDOW_LENGTH / 2);
    const framesAfter = Math.ceil(MIN_WINDOW_LENGTH / 2);
    startIdx = Math.max(0, peakIdx - framesBefore);
    endIdx = Math.min(frames.length - 1, peakIdx + framesAfter);
  }

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
 * Extract active motion window from reference (3D animation) frames.
 * Similar to camera extraction but ensures minimum length (12-15 frames preferred, 15-45 ideal).
 * Falls back to safe window around peak if motion detection finds too short a window.
 */
function extractReferenceActiveMotionWindow(
  frames: ReferenceFrame[],
  leadSide: "left" | "right"
): {
  startIdx: number;
  endIdx: number;
  extBaseline: number;
  extPeak: number;
  extDelta: number;
  peakIdx: number;
} | null {
  if (frames.length < 3) return null;
  
  const validFrames = frames.filter(
    (f) => typeof f.wallClockMs === "number" && f.referenceValid && f.limbPositions
  );
  if (validFrames.length < 3) return null;

  // Compute extension signal from reference frames
  const extensions: Array<{ ext: number; frameIdx: number }> = [];
  for (let i = 0; i < validFrames.length; i += 1) {
    const f = validFrames[i];
    if (!f.limbPositions) continue;
    
    const norm = normalizeReferencePoints(f.limbPositions);
    if (!norm) continue;
    
    const shoulderCenter = { 
      x: (norm.ls.x + norm.rs.x) / 2, 
      y: (norm.ls.y + norm.rs.y) / 2, 
      z: (norm.ls.z + norm.rs.z) / 2 
    };
    const torsoLength = Math.max(1e-6, dist3({ x: 0, y: 0, z: 0 }, shoulderCenter));
    
    const leadWrist = leadSide === "left" ? norm.lw : norm.rw;
    const leadShoulder = leadSide === "left" ? norm.ls : norm.rs;
    
    if (!leadWrist || !leadShoulder) continue;
    
    const ext = dist3(leadWrist, leadShoulder) / torsoLength;
    if (Number.isFinite(ext)) {
      const origIdx = frames.findIndex((orig) => orig.wallClockMs === f.wallClockMs);
      if (origIdx >= 0) {
        extensions.push({ ext, frameIdx: origIdx });
      }
    }
  }

  if (extensions.length === 0) return null;

  // Compute baseline: median of lowest 20% of ext values
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

  if (startIdx === -1) startIdx = 0;
  if (endIdx === -1) endIdx = frames.length - 1;

  // Enforce minimum window length: prefer 15-45 frames, minimum 12 frames
  const MIN_WINDOW_LENGTH = 12;
  const PREFERRED_MIN = 15;
  const PREFERRED_MAX = 45;
  const windowLength = endIdx - startIdx + 1;
  
  if (windowLength < MIN_WINDOW_LENGTH) {
    // Fallback: expand around peak (8 before + 8 after, clamped to bounds)
    const framesBefore = Math.floor(MIN_WINDOW_LENGTH / 2);
    const framesAfter = Math.ceil(MIN_WINDOW_LENGTH / 2);
    startIdx = Math.max(0, peakIdx - framesBefore);
    endIdx = Math.min(frames.length - 1, peakIdx + framesAfter);
  } else if (windowLength < PREFERRED_MIN) {
    // Expand slightly to reach preferred minimum
    const expandBy = PREFERRED_MIN - windowLength;
    const expandBefore = Math.floor(expandBy / 2);
    const expandAfter = Math.ceil(expandBy / 2);
    startIdx = Math.max(0, startIdx - expandBefore);
    endIdx = Math.min(frames.length - 1, endIdx + expandAfter);
  } else if (windowLength > PREFERRED_MAX) {
    // Trim to preferred maximum, keeping peak centered
    const trimBy = windowLength - PREFERRED_MAX;
    const trimBefore = Math.floor(trimBy / 2);
    const trimAfter = Math.ceil(trimBy / 2);
    startIdx = Math.min(startIdx + trimBefore, peakIdx);
    endIdx = Math.max(endIdx - trimAfter, peakIdx);
  }

  return {
    startIdx,
    endIdx,
    extBaseline,
    extPeak,
    extDelta,
    peakIdx,
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
  logOneFramePoints: boolean,
  techniqueCategory?: "punch" | "kick" | null
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
        extensionPass: extDeltaPassInitial,
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

  // Extract reference active motion window (ensures minimum length)
  const refActiveWindow = extractReferenceActiveMotionWindow(refFrames, leadSide);
  if (!refActiveWindow) {
    return {
      message: "Failed to extract reference active motion window",
      score0to100: null,
      rows: [],
      worstJoints: [],
      frameCount: cameraFrames.length,
      matchedCount: 0,
      durationMs,
      validation: {
        validityRatio: computeValidityRatio(activeFrames),
        motionEnergy: 0,
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

  // Extract reference frames using active window indices
  const refFramesAll = refFrames.slice(refActiveWindow.startIdx, refActiveWindow.endIdx + 1);
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
  
  // Debug logging for reference window
  if (logOneFramePoints) {
    console.log(`[Jab Scoring Debug] Reference window: startIdx=${refActiveWindow.startIdx}, endIdx=${refActiveWindow.endIdx}, length=${refActiveWindow.endIdx - refActiveWindow.startIdx + 1}`);
    console.log(`[Jab Scoring Debug] Reference sequence length: ${refSeq.length}, Camera sequence length: ${cameraSeq.length}`);
    console.log(`[Jab Scoring Debug] Reference extBaseline=${refActiveWindow.extBaseline.toFixed(3)}, extPeak=${refActiveWindow.extPeak.toFixed(3)}, extDelta=${refActiveWindow.extDelta.toFixed(3)}`);
  }
  
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

  // Technique-specific feature set: for jabs, exclude knees from scoring
  // Jab features: lead elbow, rear elbow, lead extension, rear guard, shoulder (low weight)
  const isJab = techniqueCategory === "punch" || techniqueCategory === null; // Default to jab if not specified
  
  // For jabs: use delta-based movement quality comparison instead of absolute angles
  let dtw: { path: Array<[number, number]>; avgCost: number } | null = null;
  let cameraBaseline: ReturnType<typeof computeBaselineAngles> | null = null;
  let referenceBaseline: ReturnType<typeof computeBaselineAngles> | null = null;
  let cameraDeltaSeq: ReturnType<typeof createDeltaAngleSequence> | null = null;
  let referenceDeltaSeq: ReturnType<typeof createDeltaAngleSequence> | null = null;
  
  if (isJab) {
    // Compute baselines (median of first 10-20% of active window)
    cameraBaseline = computeBaselineAngles(cameraSeq, leadSide);
    referenceBaseline = computeBaselineAngles(refSeq, leadSide);
    
    // Create delta sequences (angle[t] - baseline)
    cameraDeltaSeq = createDeltaAngleSequence(cameraSeq, cameraBaseline, leadSide);
    referenceDeltaSeq = createDeltaAngleSequence(refSeq, referenceBaseline, leadSide);
    
    // Use delta-based DTW for movement quality comparison
    dtw = dtwAlignDelta(cameraDeltaSeq, referenceDeltaSeq);
  } else {
    // For kicks: use absolute angle comparison (existing logic)
    dtw = dtwAlignMulti(cameraSeq, refSeq, leadSide);
  }
  const angleKeys: AngleKey[] = isJab
    ? ["leftElbow", "rightElbow", "leftShoulder", "rightShoulder"] // Exclude knees for jabs
    : ["leftElbow", "rightElbow", "leftKnee", "rightKnee", "leftShoulder", "rightShoulder"]; // Include knees for kicks

  const makeAngleBuckets = (): Record<AngleKey, number[]> => ({
    leftElbow: [],
    rightElbow: [],
    leftKnee: [],
    rightKnee: [],
    leftShoulder: [],
    rightShoulder: [],
  });

  const cameraValues = makeAngleBuckets();
  const refValues = makeAngleBuckets();
  const absErrors = makeAngleBuckets();
  const signedErrors = makeAngleBuckets();

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
    
    // Debug: log single frame elbow angle calculation if enabled
    if (logOneFramePoints && dtw.path.length > 0) {
      const [camIdx, refIdx] = dtw.path[Math.floor(dtw.path.length / 2)]; // Middle frame
      const cam = cameraSeq[camIdx];
      const ref = refSeq[refIdx];
      if (cam && ref && cam.angles && ref.angles) {
        const camElbow = cam.angles[leadElbowKey];
        const refElbow = ref.angles[leadElbowKey];
        console.log(`[Jab Scoring Debug] Frame ${camIdx}/${refIdx}: Camera elbow=${camElbow}°, Reference elbow=${refElbow}°`);
        
        // Log landmark points for camera if available
        if (activeFrames[camIdx]?.landmarks) {
          const get = normalizeLandmarkPoints(activeFrames[camIdx].landmarks, { mirrorX });
          const shoulder = get(leadSide === "left" ? 11 : 12);
          const elbow = get(leadSide === "left" ? 13 : 14);
          const wrist = get(leadSide === "left" ? 15 : 16);
          if (shoulder && elbow && wrist) {
            console.log(`[Jab Scoring Debug] Camera points: shoulder=(${shoulder.x.toFixed(3)},${shoulder.y.toFixed(3)},${shoulder.z.toFixed(3)}), elbow=(${elbow.x.toFixed(3)},${elbow.y.toFixed(3)},${elbow.z.toFixed(3)}), wrist=(${wrist.x.toFixed(3)},${wrist.y.toFixed(3)},${wrist.z.toFixed(3)})`);
            const computedAngle = angleDeg3(shoulder, elbow, wrist);
            console.log(`[Jab Scoring Debug] Computed camera elbow angle: ${computedAngle}°`);
          }
        }
        
        // Log reference points if available
        if (refFramesAll[refIdx]?.limbPositions) {
          const norm = normalizeReferencePoints(refFramesAll[refIdx].limbPositions);
          if (norm) {
            const shoulder = leadSide === "left" ? norm.ls : norm.rs;
            const elbow = leadSide === "left" ? norm.le : norm.re;
            const wrist = leadSide === "left" ? norm.lw : norm.rw;
            if (shoulder && elbow && wrist) {
              console.log(`[Jab Scoring Debug] Reference points: shoulder=(${shoulder.x.toFixed(3)},${shoulder.y.toFixed(3)},${shoulder.z.toFixed(3)}), elbow=(${elbow.x.toFixed(3)},${elbow.y.toFixed(3)},${elbow.z.toFixed(3)}), wrist=(${wrist.x.toFixed(3)},${wrist.y.toFixed(3)},${wrist.z.toFixed(3)})`);
              const computedAngle = angleDeg3(shoulder, elbow, wrist);
              console.log(`[Jab Scoring Debug] Computed reference elbow angle: ${computedAngle}°`);
            }
          }
        }
      }
    }
    
    // Process DTW path: for jabs use delta comparison, for kicks use absolute comparison
    if (isJab && cameraBaseline && referenceBaseline && cameraDeltaSeq && referenceDeltaSeq) {
      // Delta-based comparison for jabs (already handled in leadElbowErrors calculation above)
      // Just collect extension and guard errors here
      for (const [i, j] of dtw.path) {
        const cam = cameraSeq[i];
        const ref = refSeq[j];
        if (!cam || !ref) continue;
        
        if (typeof cam.leadExtension === "number" && typeof ref.leadExtension === "number") {
          extensionErrors.push(Math.abs(cam.leadExtension - ref.leadExtension));
        }
        if (typeof cam.rearGuardDist === "number" && typeof ref.rearGuardDist === "number") {
          guardErrors.push(Math.abs(cam.rearGuardDist - ref.rearGuardDist));
        }
      }
    } else {
      // Absolute angle comparison for kicks (existing logic)
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
  // For jabs: use delta-based comparison (movement quality)
  // For kicks: use absolute angle comparison
  const leadElbowErrors: number[] = [];
  const rearElbowErrors: number[] = [];
  
  if (dtw) {
    if (isJab && cameraBaseline && referenceBaseline && cameraDeltaSeq && referenceDeltaSeq) {
      // Delta-based comparison for jabs: compare ΔAngle (movement from baseline)
      for (const [i, j] of dtw.path) {
        const camDelta = cameraDeltaSeq[i];
        const refDelta = referenceDeltaSeq[j];
        
        if (!camDelta || !refDelta) continue;
        
        // Compare delta angles (movement quality)
        if (typeof camDelta.leadElbowDelta === "number" && typeof refDelta.leadElbowDelta === "number") {
          leadElbowErrors.push(Math.abs(camDelta.leadElbowDelta - refDelta.leadElbowDelta));
        }
        
        // Rear elbow: still compare absolute angles (less critical for jabs)
        const cam = cameraSeq[i];
        const ref = refSeq[j];
        if (cam && ref && cam.angles && ref.angles) {
          const rearElbowA = cam.angles[rearElbowKey];
          const rearElbowB = ref.angles[rearElbowKey];
          if (typeof rearElbowA === "number" && typeof rearElbowB === "number" && Number.isFinite(rearElbowA) && Number.isFinite(rearElbowB)) {
            rearElbowErrors.push(Math.abs(rearElbowA - rearElbowB));
          }
        }
      }
    } else {
      // Absolute angle comparison for kicks (existing logic)
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
  
  // Calculate reference step cost for DTW normalization (must be done before DTW score calculation)
  const refStepCosts: number[] = [];
  for (let i = 1; i < refSeq.length; i += 1) {
    const c = dtwCostMulti(refSeq[i - 1], refSeq[i], leadSide);
    if (typeof c === "number" && Number.isFinite(c)) refStepCosts.push(c);
  }
  const refStepCost = mean(refStepCosts) ?? null;
  
  // Calculate actual FPS from frame timestamps to adjust thresholds
  const estimatedFps = activeFrames.length >= 2 && windowDurationMs && windowDurationMs > 0
    ? Math.round((activeFrames.length - 1) * 1000 / windowDurationMs)
    : 30; // Default to 30 FPS
  const fpsFactor = Math.max(0.5, Math.min(1.5, estimatedFps / 30)); // Normalize to 30 FPS (0.5x to 1.5x range)
  
  // Calculate DTW-based score component (primary for jab scoring)
  // DTW cost represents overall movement pattern similarity
  // Lower cost = better match. Convert to 0-1 score.
  let dtwScoreComponent: number | null = null;
  if (dtwAvgCost != null && Number.isFinite(dtwAvgCost) && refStepCost != null && Number.isFinite(refStepCost)) {
    // Normalize DTW cost relative to reference step cost
    // If dtwAvgCost <= refStepCost, score is high (close to 1.0)
    // If dtwAvgCost > 2 * refStepCost, score is low (close to 0.0)
    const normalizedCost = dtwAvgCost / Math.max(refStepCost, 1e-6);
    dtwScoreComponent = Math.max(0, Math.min(1, 1 - (normalizedCost - 1) / 1)); // 1.0 cost = 1.0 score, 2.0 cost = 0.0 score
  }
  
  // For jabs: use delta-based movement quality scoring
  // Score composition: 50% extension delta, 25% time-to-peak, 15% guard, 10% smoothness
  let baseScore: number | null = null;
  
  if (isJab) {
    // Calculate extension delta similarity (50% weight)
    const camExtDelta = activeWindow.extDelta;
    const refExtDelta = referenceExtDelta;
    let extensionDeltaScore: number | null = null;
    if (camExtDelta != null && refExtDelta != null && refExtDelta > 0) {
      const deltaRatio = Math.min(1.0, camExtDelta / refExtDelta); // Cap at 1.0 (never penalize for exceeding)
      extensionDeltaScore = deltaRatio; // Direct ratio: 1.0 = perfect, 0.0 = no extension
    }
    
    // Calculate time-to-peak similarity (25% weight)
    // Time-to-peak: time from window start to peak extension
    let timeToPeakScore: number | null = null;
    if (activeWindow.cameraStartMs != null && activeWindow.cameraEndMs != null && activeWindow.peakIdx != null) {
      const peakFrame = cameraSeq[activeWindow.peakIdx];
      const peakTimeMs = peakFrame?.wallClockMs;
      if (peakTimeMs != null) {
        const camTimeToPeak = peakTimeMs - activeWindow.cameraStartMs;
        
        // Find reference peak time
        let refPeakIdx = -1;
        let refMaxExt = -Infinity;
        for (let i = 0; i < refSeq.length; i += 1) {
          const ext = refSeq[i]?.leadExtension;
          if (typeof ext === "number" && ext > refMaxExt) {
            refMaxExt = ext;
            refPeakIdx = i;
          }
        }
        
        if (refPeakIdx >= 0 && refFramesAll.length > 0) {
          const refStartMs = refFramesAll[0]?.wallClockMs;
          const refPeakFrame = refFramesAll[refPeakIdx];
          const refPeakTimeMs = refPeakFrame?.wallClockMs;
          
          if (refStartMs != null && refPeakTimeMs != null) {
            const refTimeToPeak = refPeakTimeMs - refStartMs;
            if (refTimeToPeak > 0) {
              // Similarity: 1.0 if times match, decreases with difference
              const timeDiff = Math.abs(camTimeToPeak - refTimeToPeak);
              const timeSimilarity = Math.max(0, 1 - timeDiff / (refTimeToPeak * 0.5)); // 50% tolerance
              timeToPeakScore = timeSimilarity;
            }
          }
        }
      }
    }
    
    // Calculate guard distance similarity (15% weight)
    const guardSpasmMargin = SCORE_SCALES.guard * 0.10;
    const guardScore = componentScoreFromError(guardMae, SCORE_SCALES.guard, guardSpasmMargin);
    
    // Calculate smoothness (velocity variance) (10% weight)
    // Smoothness: lower variance in extension velocity = smoother movement
    let smoothnessScore: number | null = null;
    if (cameraSeq.length >= 2) {
      const velocities: number[] = [];
      for (let i = 1; i < cameraSeq.length; i += 1) {
        const prev = cameraSeq[i - 1];
        const curr = cameraSeq[i];
        const prevExt = prev?.leadExtension;
        const currExt = curr?.leadExtension;
        const prevTime = prev?.wallClockMs;
        const currTime = curr?.wallClockMs;
        
        if (typeof prevExt === "number" && typeof currExt === "number" && 
            typeof prevTime === "number" && typeof currTime === "number" && 
            currTime > prevTime) {
          const dt = currTime - prevTime;
          const velocity = (currExt - prevExt) / dt;
          velocities.push(velocity);
        }
      }
      
      if (velocities.length > 0) {
        const meanVel = mean(velocities) ?? 0;
        const variance = velocities.reduce((acc, v) => acc + Math.pow(v - meanVel, 2), 0) / velocities.length;
        const stdDev = Math.sqrt(variance);
        
        // Smoothness score: lower std dev = higher score
        // Normalize: assume good smoothness has std dev < 0.01 units/ms
        const smoothnessThreshold = 0.01;
        smoothnessScore = Math.max(0, Math.min(1, 1 - (stdDev / smoothnessThreshold)));
      }
    }
    
    // Combine scores with new weights
    const parts: Array<{ w: number; s: number | null }> = [
      { w: 0.50, s: extensionDeltaScore }, // Extension delta similarity (50%)
      { w: 0.25, s: timeToPeakScore }, // Time-to-peak similarity (25%)
      { w: 0.15, s: guardScore }, // Guard distance similarity (15%)
      { w: 0.10, s: smoothnessScore }, // Smoothness (10%)
    ];
    const wSum = parts.filter((p) => typeof p.s === "number").reduce((acc, p) => acc + p.w, 0);
    baseScore = wSum > 0 ? parts.filter((p) => typeof p.s === "number").reduce((acc, p) => acc + p.w * (p.s as number), 0) / wSum : null;
    
    // Debug logging for scoring
    if (logOneFramePoints) {
      console.log(`[Jab Scoring Debug] Extension delta: camera=${camExtDelta?.toFixed(3)}, reference=${refExtDelta?.toFixed(3)}, score=${extensionDeltaScore?.toFixed(3)}`);
      console.log(`[Jab Scoring Debug] Time-to-peak score: ${timeToPeakScore?.toFixed(3)}`);
      console.log(`[Jab Scoring Debug] Guard score: ${guardScore?.toFixed(3)}`);
      console.log(`[Jab Scoring Debug] Smoothness score: ${smoothnessScore?.toFixed(3)}`);
      console.log(`[Jab Scoring Debug] Base score: ${baseScore?.toFixed(3)}`);
    }
  } else {
    // For kicks: use existing absolute angle scoring
    const spasmMarginFactor = 1.0 / fpsFactor;
    const elbowSpasmMargin = SCORE_SCALES.elbowDeg * 0.08 * spasmMarginFactor;
    const extensionSpasmMargin = SCORE_SCALES.extension * 0.10 * spasmMarginFactor;
    const guardSpasmMargin = SCORE_SCALES.guard * 0.10 * spasmMarginFactor;
    
    const leadElbowScore = componentScoreFromError(leadElbowMae, SCORE_SCALES.elbowDeg, elbowSpasmMargin);
    const rearElbowScore = componentScoreFromError(rearElbowMae, SCORE_SCALES.elbowDeg, elbowSpasmMargin);
    const extensionScore = componentScoreFromError(extensionMae, SCORE_SCALES.extension, extensionSpasmMargin);
    const guardScore = componentScoreFromError(guardMae, SCORE_SCALES.guard, guardSpasmMargin);
    
    const parts: Array<{ w: number; s: number | null }> = [
      { w: JAB_SCORE_WEIGHTS.leadElbow, s: leadElbowScore },
      { w: JAB_SCORE_WEIGHTS.leadExtension, s: extensionScore },
      { w: JAB_SCORE_WEIGHTS.rearGuard, s: guardScore },
      { w: JAB_SCORE_WEIGHTS.rearElbow, s: rearElbowScore },
    ];
    const wSum = parts.filter((p) => typeof p.s === "number").reduce((acc, p) => acc + p.w, 0);
    baseScore = wSum > 0 ? parts.filter((p) => typeof p.s === "number").reduce((acc, p) => acc + p.w * (p.s as number), 0) / wSum : null;
  }

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
  
  // For jabs: only penalize if extension delta < 90% of reference (never penalize for exceeding)
  if (isJab) {
    const camExtDelta = activeWindow.extDelta;
    const refExtDelta = referenceExtDelta;
    if (camExtDelta != null && refExtDelta != null && refExtDelta > 0) {
      const deltaRatio = camExtDelta / refExtDelta;
      if (deltaRatio < 0.90) {
        // Only penalize if extension delta is less than 90% of reference
        penalties.push({ key: "insufficient_peak_extension", amount: 60, reason: `Insufficient lead-hand extension (${(deltaRatio * 100).toFixed(0)}% of reference)` });
      }
      // No penalty if deltaRatio >= 0.90 (even if > 1.0, exceeding is fine)
    } else if (!extensionPeakExists) {
      // Fallback: if we can't compute delta ratio, use old logic
      penalties.push({ key: "insufficient_peak_extension", amount: 60, reason: "Insufficient lead-hand extension (jab not fully thrown)" });
    }
  } else {
    // For kicks: use existing penalty logic
    if (!extensionPeakExists) {
      penalties.push({ key: "insufficient_peak_extension", amount: 60, reason: "Insufficient lead-hand extension (jab not fully thrown)" });
    }
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

  // refStepCost already calculated above
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
  
  // baseScore is 0-1, multiply by 100 to get 0-100, then subtract penalties
  // Ensure penalties cannot drive score below 0
  const rawScore = baseScore == null ? 0 : Math.round((baseScore * 100) - penaltyTotalCapped);
  const dtwPathLen = dtw?.path.length ?? 0;
  const scoreGuarded = baseScore != null && dtwPathLen > 10 && extensionPeakExists ? Math.max(1, rawScore) : rawScore;
  const score = Math.max(0, Math.min(100, scoreGuarded)); // Clamp to 0-100
  
  // Debug logging for final score
  if (logOneFramePoints) {
    console.log(`[Jab Scoring Debug] Penalties: total=${penaltyTotal}, capped=${penaltyTotalCapped}`);
    console.log(`[Jab Scoring Debug] Raw score: ${rawScore}, Score guarded: ${scoreGuarded}, Final score: ${score}`);
    if (isJab) {
      console.log(`[Jab Scoring Debug] Delta-based scoring used (extension delta 50%, time-to-peak 25%, guard 15%, smoothness 10%)`);
    }
  }

  // Filter out knees for jab techniques when selecting worst joints
  const jabRelevantRows = isJab 
    ? rows.filter((r) => r.key !== "leftKnee" && r.key !== "rightKnee")
    : rows;
  
  const worstJoints: WorstJointHint[] = jabRelevantRows
    .filter((r) => typeof r.deltaDeg === "number" && Number.isFinite(r.deltaDeg) && typeof r.signedErrorDeg === "number" && Number.isFinite(r.signedErrorDeg))
    .sort((a, b) => (b.deltaDeg as number) - (a.deltaDeg as number))
    .slice(0, 2)
    .map((r) => ({ key: r.key, label: r.label, avgErrorDeg: r.deltaDeg as number, hint: hintForJoint(r.key, r.signedErrorDeg as number) }));

  // Compute peak frame debug info
  type PeakFrameDebugType = NonNullable<NonNullable<ComparisonResult["debug"]>["peakFrameDebug"]>;
  let peakFrameDebug: PeakFrameDebugType | undefined = undefined;
  if (dtw && cameraSeq.length > 0 && refSeq.length > 0 && activeFrames.length > 0) {
    // For jabs, we need baselines to compute delta angles
    const hasBaselines = isJab ? (cameraBaseline != null && referenceBaseline != null) : true;
    if (hasBaselines && (!isJab || (cameraBaseline != null && referenceBaseline != null))) {
    // Find camera frame with peak extension
    let cameraPeakIdx = -1;
    let maxExtension = -Infinity;
    for (let i = 0; i < cameraSeq.length; i += 1) {
      const ext = cameraSeq[i]?.leadExtension;
      if (typeof ext === "number" && Number.isFinite(ext) && ext > maxExtension) {
        maxExtension = ext;
        cameraPeakIdx = i;
      }
    }
    
    if (cameraPeakIdx >= 0) {
      // Find aligned reference frame via DTW path (closest pair to cameraPeakIdx)
      let referencePeakIdx = -1;
      let minDist = Infinity;
      for (const [i, j] of dtw.path) {
        const dist = Math.abs(i - cameraPeakIdx);
        if (dist < minDist) {
          minDist = dist;
          referencePeakIdx = j;
        }
      }
      
      if (referencePeakIdx >= 0 && referencePeakIdx < refSeq.length && cameraPeakIdx < activeFrames.length) {
        const camFrame = cameraSeq[cameraPeakIdx];
        const refFrame = refSeq[referencePeakIdx];
        const camPoseFrame = activeFrames[cameraPeakIdx];
        // Find reference frame by matching wallClockMs (refSeq is built from refFramesAll)
        const refFrameWallClockMs = refFrame?.wallClockMs;
        const refPoseFrame = refFrameWallClockMs != null 
          ? refFramesAll.find((f) => f.wallClockMs === refFrameWallClockMs) 
          : (referencePeakIdx < refFramesAll.length ? refFramesAll[referencePeakIdx] : null);
        
        // Extract camera debug info
        let cameraLeadElbowAngle: number | null = null;
        let cameraLeadElbowPoints: { shoulder: { x: number; y: number; z: number } | null; elbow: { x: number; y: number; z: number } | null; wrist: { x: number; y: number; z: number } | null } = { shoulder: null, elbow: null, wrist: null };
        let cameraShoulderAngle: number | null = null;
        let cameraShoulderPoints: { torso: { x: number; y: number; z: number } | null; shoulder: { x: number; y: number; z: number } | null; elbow: { x: number; y: number; z: number } | null } = { torso: null, shoulder: null, elbow: null };
        
        if (camPoseFrame?.landmarks) {
          const get = normalizeLandmarkPoints(camPoseFrame.landmarks, { mirrorX });
          const shoulderIdx = leadSide === "left" ? 11 : 12;
          const elbowIdx = leadSide === "left" ? 13 : 14;
          const wristIdx = leadSide === "left" ? 15 : 16;
          const hipIdx = leadSide === "left" ? 23 : 24;
          
          const shoulder = get(shoulderIdx);
          const elbow = get(elbowIdx);
          const wrist = get(wristIdx);
          const hip = get(hipIdx);
          
          if (shoulder && elbow && wrist) {
            cameraLeadElbowPoints = { shoulder, elbow, wrist };
            cameraLeadElbowAngle = angleDeg3(shoulder, elbow, wrist);
          }
          
          // Shoulder angle: hip -> shoulder -> elbow
          if (hip && shoulder && elbow) {
            cameraShoulderPoints = { torso: hip, shoulder, elbow };
            cameraShoulderAngle = angleDeg3(hip, shoulder, elbow);
          }
        }
        
        // Extract reference debug info
        let referenceLeadElbowAngle: number | null = null;
        let referenceLeadElbowPoints: { shoulder: { x: number; y: number; z: number } | null; elbow: { x: number; y: number; z: number } | null; wrist: { x: number; y: number; z: number } | null } = { shoulder: null, elbow: null, wrist: null };
        let referenceShoulderAngle: number | null = null;
        let referenceShoulderPoints: { torso: { x: number; y: number; z: number } | null; shoulder: { x: number; y: number; z: number } | null; elbow: { x: number; y: number; z: number } | null } = { torso: null, shoulder: null, elbow: null };
        
        if (refPoseFrame?.limbPositions) {
          const norm = normalizeReferencePoints(refPoseFrame.limbPositions);
          if (norm) {
            const shoulder = leadSide === "left" ? norm.ls : norm.rs;
            const elbow = leadSide === "left" ? norm.le : norm.re;
            const wrist = leadSide === "left" ? norm.lw : norm.rw;
            const hip = leadSide === "left" ? norm.lh : norm.rh;
            
            if (shoulder && elbow && wrist) {
              referenceLeadElbowPoints = { shoulder, elbow, wrist };
              referenceLeadElbowAngle = angleDeg3(shoulder, elbow, wrist);
            }
            
            // Shoulder angle: hip -> shoulder -> elbow (use hip as torso proxy)
            if (hip && shoulder && elbow) {
              referenceShoulderPoints = { torso: hip, shoulder, elbow };
              referenceShoulderAngle = angleDeg3(hip, shoulder, elbow);
            }
          }
        }
        
        // Sanity check: verify lead arm mapping consistency
        let mappingWarning: string | undefined = undefined;
        const cameraUsesLeft = cameraLeadElbowPoints.shoulder != null && cameraLeadElbowPoints.elbow != null && cameraLeadElbowPoints.wrist != null;
        const referenceUsesLeft = referenceLeadElbowPoints.shoulder != null && referenceLeadElbowPoints.elbow != null && referenceLeadElbowPoints.wrist != null;
        
        if (leadSide === "left") {
          // Camera should use left arm (indices 11, 13, 15)
          // Reference should use left arm (norm.ls, norm.le, norm.lw)
          // If we're checking, we can verify by checking if the points match expected side
          // For now, we trust the leadSide parameter, but we can add visual verification
        } else {
          // leadSide === "right"
          // Camera should use right arm (indices 12, 14, 16)
          // Reference should use right arm (norm.rs, norm.re, norm.rw)
        }
        
        // Extension metrics
        const cameraExtBaseline = activeWindow.extBaseline;
        const cameraExtPeak = activeWindow.extPeak;
        const cameraExtDelta = activeWindow.extDelta;
        const cameraExtCurrent = camFrame?.leadExtension ?? null;
        
        const refExtBaseline = referenceExtBaseline;
        const refExtPeak = referenceExtPeak;
        const refExtDelta = referenceExtDelta;
        const refExtCurrent = refFrame?.leadExtension ?? null;
        
        // Calculate time-to-peak for camera and reference
        let cameraTimeToPeak: number | null = null;
        if (activeWindow.cameraStartMs != null && camFrame?.wallClockMs != null) {
          cameraTimeToPeak = camFrame.wallClockMs - activeWindow.cameraStartMs;
        }
        
        let referenceTimeToPeak: number | null = null;
        if (refFramesAll.length > 0 && refPoseFrame?.wallClockMs != null) {
          const refStartMs = refFramesAll[0]?.wallClockMs;
          if (refStartMs != null) {
            referenceTimeToPeak = refPoseFrame.wallClockMs - refStartMs;
          }
        }
        
        // Calculate delta angles (for jabs: movement quality)
        const cameraLeadElbowDelta = (isJab && cameraBaseline) && cameraLeadElbowAngle != null && cameraBaseline.leadElbow != null
          ? cameraLeadElbowAngle - cameraBaseline.leadElbow
          : null;
        const referenceLeadElbowDelta = (isJab && referenceBaseline) && referenceLeadElbowAngle != null && referenceBaseline.leadElbow != null
          ? referenceLeadElbowAngle - referenceBaseline.leadElbow
          : null;
        
        const cameraShoulderDelta = (isJab && cameraBaseline) && cameraShoulderAngle != null && cameraBaseline.leadShoulder != null
          ? cameraShoulderAngle - cameraBaseline.leadShoulder
          : null;
        const referenceShoulderDelta = (isJab && referenceBaseline) && referenceShoulderAngle != null && referenceBaseline.leadShoulder != null
          ? referenceShoulderAngle - referenceBaseline.leadShoulder
          : null;
        
        peakFrameDebug = {
          cameraPeakIdx,
          referencePeakIdx,
          camera: {
            leadSide,
            mirrored: mirrorX,
            leadElbowAngle: cameraLeadElbowAngle,
            leadElbowDelta: cameraLeadElbowDelta,
            leadElbowBaseline: cameraBaseline?.leadElbow ?? null,
            leadElbowPoints: cameraLeadElbowPoints,
            shoulderAngle: cameraShoulderAngle,
            shoulderDelta: cameraShoulderDelta,
            shoulderBaseline: cameraBaseline?.leadShoulder ?? null,
            shoulderPoints: cameraShoulderPoints,
            extension: {
              baseline: cameraExtBaseline,
              peak: cameraExtPeak,
              delta: cameraExtDelta,
              current: cameraExtCurrent,
            },
            guard: camFrame?.rearGuardDist ?? null,
            timeToPeakMs: cameraTimeToPeak,
          },
          reference: {
            leadSide,
            leadElbowAngle: referenceLeadElbowAngle,
            leadElbowDelta: referenceLeadElbowDelta,
            leadElbowBaseline: referenceBaseline?.leadElbow ?? null,
            leadElbowPoints: referenceLeadElbowPoints,
            shoulderAngle: referenceShoulderAngle,
            shoulderDelta: referenceShoulderDelta,
            shoulderBaseline: referenceBaseline?.leadShoulder ?? null,
            shoulderPoints: referenceShoulderPoints,
            extension: {
              baseline: refExtBaseline,
              peak: refExtPeak,
              delta: refExtDelta,
              current: refExtCurrent,
            },
            guard: refFrame?.rearGuardDist ?? null,
            timeToPeakMs: referenceTimeToPeak,
          },
          mappingWarning,
          dtwCostOnDelta: isJab ? dtwAvgCost : null, // DTW cost on delta sequences for jabs
        };
      }
    }
    }
  }

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
      referenceWindowStartIdx: refActiveWindow.startIdx,
      referenceWindowEndIdx: refActiveWindow.endIdx,
      referenceWindowLength: refActiveWindow.endIdx - refActiveWindow.startIdx + 1,
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
      leadWristName: leadSide === "left" ? "left_wrist" : "right_wrist",
      leadShoulderName: leadSide === "left" ? "left_shoulder" : "right_shoulder",
      peakFrameDebug,
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

function LiveDemoInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const techniqueId = searchParams.get("techniqueId");
  const technique: Technique | null = useMemo(() => (techniqueId ? (getTechniqueById(techniqueId) ?? null) : null), [techniqueId]);
  const cameraMirrored = true;
  const [logOneFramePoints, setLogOneFramePoints] = useState(false);

  // Keep lead side consistent across camera + reference for the chosen technique.
  const leadSideRef = useRef<"left" | "right">("left");
  useEffect(() => {
    leadSideRef.current = technique?.leadSide ?? "left";
  }, [technique?.leadSide]);

  const [phase, setPhase] = useState<Phase>("idle");
  const [countdownStep, setCountdownStep] = useState<CountdownStep | null>(null);
  const [showStartDialog, setShowStartDialog] = useState(false);
  const [showResultsDrawer, setShowResultsDrawer] = useState(false);
  const [attemptIndex, setAttemptIndex] = useState(0); // 0 = not started, 1..3 = current attempt
  const [attemptRemainingMs, setAttemptRemainingMs] = useState<number | null>(null);
  const attemptTimerRef = useRef<number | null>(null);
  const countdownAudioRef = useRef<HTMLAudioElement | null>(null);
  const jabStretchAudioRef = useRef<HTMLAudioElement | null>(null);
  const kickWhooshAudioRef = useRef<HTMLAudioElement | null>(null);
  const refLeadStretchActiveRef = useRef(false);
  const refLeadExtStatsRef = useRef<{ min: number; max: number } | null>(null);
  const refLastAnimationFrameRef = useRef<number | null>(null);
  const techniqueIdRef = useRef<string | null>(null);
  const refKickStatsRef = useRef<{
    left: { ext: { min: number; max: number }; ankleY: { min: number; max: number }; kneeAngle: { min: number; max: number } };
    right: { ext: { min: number; max: number }; ankleY: { min: number; max: number }; kneeAngle: { min: number; max: number } };
  } | null>(null);
  const refKickLegRef = useRef<"left" | "right" | null>(null);
  const refKickPlayedRef = useRef<{ extended: boolean; bent: boolean }>({ extended: false, bent: false });
  const [poseReady, setPoseReady] = useState(false);
  const poseReadyRef = useRef(false);
  const phaseRef = useRef<Phase>("idle");
  const attemptIndexRef = useRef(0);
  const [referencePlayToken, setReferencePlayToken] = useState(0);
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

  useEffect(() => {
    techniqueIdRef.current = technique?.id ?? null;
    refLeadStretchActiveRef.current = false;
    refLeadExtStatsRef.current = null;
    refKickStatsRef.current = null;
    refKickLegRef.current = null;
    refKickPlayedRef.current = { extended: false, bent: false };
    refLastAnimationFrameRef.current = null;
  }, [technique?.id]);

  useEffect(() => {
    if (phase !== "countdown") return;
    const audio = countdownAudioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    void audio.play().catch(() => {});
    return () => {
      audio.pause();
      audio.currentTime = 0;
    };
  }, [phase]);

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
      setReferencePlayToken((token) => token + 1);
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

    const currentFrame = frame.animation.currentFrame;
    const prevFrame = refLastAnimationFrameRef.current;
    if (typeof currentFrame === "number") {
      if (typeof prevFrame === "number" && currentFrame < prevFrame - 1) {
        // Animation looped - allow a new trigger.
        refLeadStretchActiveRef.current = false;
        refKickPlayedRef.current = { extended: false, bent: false };
      }
      refLastAnimationFrameRef.current = currentFrame;
    }

    const techniqueId = techniqueIdRef.current;
    if (techniqueId === "simple_jab") {
      const leadSide = leadSideRef.current;
      const leadExt = computeReferenceLeadExtension(frame, leadSide);
      if (leadExt == null) return;

      const stats = refLeadExtStatsRef.current;
      if (!stats) {
        refLeadExtStatsRef.current = { min: leadExt, max: leadExt };
      } else {
        stats.min = Math.min(stats.min, leadExt);
        stats.max = Math.max(stats.max, leadExt);
      }

      const updatedStats = refLeadExtStatsRef.current;
      if (!updatedStats) return;

      const range = updatedStats.max - updatedStats.min;
      const MIN_RANGE = 0.06;
      const STRETCH_ON_RATIO = 0.88;
      const STRETCH_OFF_RATIO = 0.7;
      const onThreshold = updatedStats.min + range * STRETCH_ON_RATIO;
      const offThreshold = updatedStats.min + range * STRETCH_OFF_RATIO;
      const hasRange = range >= MIN_RANGE;
      const isStretched = hasRange ? leadExt >= onThreshold : false;

      if (isStretched && !refLeadStretchActiveRef.current) {
        if (currentPhase !== "countdown") {
          const audio = jabStretchAudioRef.current;
          if (audio) {
            // Reset and play audio - ensure it plays even if already playing
            audio.pause();
            audio.currentTime = 0;
            void audio.play().catch((err) => {
              console.warn("Failed to play jab audio:", err);
            });
          }
        }
        refLeadStretchActiveRef.current = true;
        return;
      }
      if (!isStretched && refLeadStretchActiveRef.current && leadExt <= offThreshold) {
        refLeadStretchActiveRef.current = false;
      }
      return;
    }

    if (techniqueId === "mmakick") {
      const metrics = computeReferenceKickMetrics(frame);
      if (!metrics) return;

      const stats = refKickStatsRef.current;
      if (!stats) {
        refKickStatsRef.current = {
          left: {
            ext: { min: metrics.left.ext ?? Infinity, max: metrics.left.ext ?? -Infinity },
            ankleY: { min: metrics.left.ankleY ?? Infinity, max: metrics.left.ankleY ?? -Infinity },
            kneeAngle: { min: metrics.left.kneeAngle ?? Infinity, max: metrics.left.kneeAngle ?? -Infinity },
          },
          right: {
            ext: { min: metrics.right.ext ?? Infinity, max: metrics.right.ext ?? -Infinity },
            ankleY: { min: metrics.right.ankleY ?? Infinity, max: metrics.right.ankleY ?? -Infinity },
            kneeAngle: { min: metrics.right.kneeAngle ?? Infinity, max: metrics.right.kneeAngle ?? -Infinity },
          },
        };
      } else {
        const update = (side: "left" | "right") => {
          const m = metrics[side];
          if (typeof m.ext === "number") {
            stats[side].ext.min = Math.min(stats[side].ext.min, m.ext);
            stats[side].ext.max = Math.max(stats[side].ext.max, m.ext);
          }
          if (typeof m.ankleY === "number") {
            stats[side].ankleY.min = Math.min(stats[side].ankleY.min, m.ankleY);
            stats[side].ankleY.max = Math.max(stats[side].ankleY.max, m.ankleY);
          }
          if (typeof m.kneeAngle === "number") {
            stats[side].kneeAngle.min = Math.min(stats[side].kneeAngle.min, m.kneeAngle);
            stats[side].kneeAngle.max = Math.max(stats[side].kneeAngle.max, m.kneeAngle);
          }
        };
        update("left");
        update("right");
      }

      const updatedStats = refKickStatsRef.current;
      if (!updatedStats) return;

      const leftRange = updatedStats.left.ext.max - updatedStats.left.ext.min;
      const rightRange = updatedStats.right.ext.max - updatedStats.right.ext.min;
      const MIN_EXT_RANGE = 0.08;
      if (!refKickLegRef.current && (leftRange >= MIN_EXT_RANGE || rightRange >= MIN_EXT_RANGE)) {
        refKickLegRef.current = leftRange >= rightRange ? "left" : "right";
      }

      const kickLeg = refKickLegRef.current;
      if (!kickLeg) return;

      const legStats = updatedStats[kickLeg];
      const legMetrics = metrics[kickLeg];
      if (!legStats || !legMetrics) return;

      const extRange = legStats.ext.max - legStats.ext.min;
      const heightRange = legStats.ankleY.max - legStats.ankleY.min;
      const kneeRange = legStats.kneeAngle.max - legStats.kneeAngle.min;
      const MIN_HEIGHT_RANGE = 0.12;
      const MIN_KNEE_RANGE = 25;
      if (extRange < MIN_EXT_RANGE || heightRange < MIN_HEIGHT_RANGE || kneeRange < MIN_KNEE_RANGE) return;

      const footInAir = typeof legMetrics.ankleY === "number" && legMetrics.ankleY >= legStats.ankleY.min + heightRange * 0.6;
      if (!footInAir) return;

      const nearExtension = typeof legMetrics.ext === "number" && legMetrics.ext >= legStats.ext.min + extRange * 0.9;
      const kneeBent = typeof legMetrics.kneeAngle === "number" && legMetrics.kneeAngle <= legStats.kneeAngle.min + kneeRange * 0.35;

      const played = refKickPlayedRef.current;

      if (nearExtension && !played.extended) {
        if (currentPhase !== "countdown") {
          const audio = kickWhooshAudioRef.current;
          if (audio) {
            // Reset and play audio - ensure it plays even if already playing
            audio.pause();
            audio.currentTime = 0;
            void audio.play().catch((err) => {
              console.warn("Failed to play kick audio:", err);
            });
          }
        }
        refKickPlayedRef.current = { ...played, extended: true };
        return;
      }
      if (kneeBent && !played.bent) {
        if (currentPhase !== "countdown") {
          const audio = kickWhooshAudioRef.current;
          if (audio) {
            // Reset and play audio - ensure it plays even if already playing
            audio.pause();
            audio.currentTime = 0;
            void audio.play().catch((err) => {
              console.warn("Failed to play kick audio:", err);
            });
          }
        }
        refKickPlayedRef.current = { ...played, bent: true };
      }
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

      const techniqueCategory: "punch" | "kick" | null = 
        technique?.category === "punch" || technique?.category === "kick" 
          ? (technique.category as "punch" | "kick")
          : null;
      const result = scoreSingleAttempt(cameraFrames, refFrames, leadSide, mirrorX, logOneFramePoints, techniqueCategory);
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
      setShowStartDialog(true);
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

  // Get status badge variant and label
  const statusBadge = useMemo(() => {
    if (phase === "idle") return { variant: "idle" as const, label: "Ready" };
    if (phase === "countdown") return { variant: "countdown" as const, label: "Countdown" };
    if (phase === "attempt_recording") return { variant: "recording" as const, label: "Recording" };
    if (phase === "results") return { variant: "analyzing" as const, label: "Analyzing" };
    return { variant: "idle" as const, label: "Ready" };
  }, [phase]);

  // Get instruction text based on phase
  const instructionText = useMemo(() => {
    if (phase === "idle") return "Press Start to perform 3 jabs.";
    if (phase === "countdown") return "Get ready…";
    if (phase === "attempt_recording") return "Perform the technique now.";
    if (phase === "results") return "Session complete. Tap “Show results” to review.";
    if (attemptIndex > 0 && attemptIndex < 3 && phase !== "countdown" && phase !== "attempt_recording") {
      return "Reset and prepare for the next attempt.";
    }
    return "Press Start to begin.";
  }, [phase, attemptIndex]);

  // Get technique category label
  const techniqueCategory = useMemo(() => {
    if (!technique?.category) return null;
    const categoryMap: Record<string, string> = {
      punch: "Boxing",
      kick: "Striking",
      defense: "Defense",
      grappling: "Grappling",
    };
    return categoryMap[technique.category] || technique.category;
  }, [technique]);

  return (
    <div className="min-h-screen bg-background">
      <audio ref={countdownAudioRef} src="/audio/321_countdown_beep.mp3" preload="auto" />
      <audio ref={jabStretchAudioRef} src="/audio/jab_stretch_sound.mp3" preload="auto" />
      <audio ref={kickWhooshAudioRef} src="/audio/kick_whoosh_sound.mp3" preload="auto" />
      {/* Fixed Header Bar */}
      <div className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto px-4 py-3 max-w-7xl">
          <div className="flex items-center justify-between">
            {/* Left: Back + Training label */}
            <div className="flex items-center gap-3">
              <Button 
                variant="ghost" 
                size="sm"
                onClick={handleBack} 
                disabled={phase === "countdown"}
                className="h-8 cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4 mr-1.5" />
                Training
              </Button>
            </div>

            {/* Center: Technique name with badge */}
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-foreground">
                {technique?.name || "No Technique Selected"}
              </h1>
              {techniqueCategory && (
                <Badge variant="secondary" className="text-xs">
                  {techniqueCategory} • {technique?.category === "punch" ? "Strikes" : technique?.category === "kick" ? "Strikes" : "Techniques"}
                </Badge>
              )}
            </div>

          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <div className={`space-y-6 ${phase === "countdown" ? "pointer-events-none select-none" : ""}`}>
          {/* 2-Column Grid: Reference + Live Pose */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Left: Reference Technique Card */}
            <Card className="shadow-sm border-0">
              <CardContent className="pt-4 pb-4">
                <div className="space-y-3">
                  {/* Title row */}
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-foreground">Reference Technique</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">Ideal execution</p>
                      <p className="text-xs text-muted-foreground mt-0.5">The technique will start playing once you start the training</p>
                    </div>
                    {phase === "attempt_recording" && (
                      <Badge variant="outline" className="text-xs">
                        Looping
                      </Badge>
                    )}
                  </div>

                  {/* Animation container */}
                  <div className="relative w-full aspect-square bg-muted/30 rounded-lg overflow-hidden">
                    <SceneCanvas
                      className="w-full h-full"
                      technique={technique}
                      referenceFps={15}
                      onReferenceFrame={handleReferenceFrame}
                      animationMode={phase === "attempt_recording" ? "once" : "paused"}
                      playToken={referencePlayToken}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Right: Live Pose Card */}
            <Card className="shadow-sm border-0">
              <CardContent className="pt-4 pb-4">
                <div className="space-y-3">
                    {/* Title row */}
                    <div className="flex items-start justify-between">
                      <div>
                        <h2 className="text-base font-semibold text-foreground">Your Movement</h2>
                        <p className="text-xs text-muted-foreground mt-0.5">Live pose detection</p>
                      </div>
                      {poseReady && (
                        <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20">
                          Ready
                        </Badge>
                      )}
                    </div>

                  {/* Camera feed */}
                  <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
                    <PoseCameraOverlay
                      ref={poseCameraOverlayRef}
                      showVideo={true}
                      mirrored={cameraMirrored}
                      inferenceFps={30}
                      onPoseFrame={handlePoseFrame}
                    />
                  </div>

                  {/* Attempt progress (only show during recording) */}
                  {attemptIndex > 0 && attemptIndex <= 3 && phase === "attempt_recording" && attemptRemainingMs != null && (
                    <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                      <span>Attempt {attemptIndex}/3</span>
                      <span className="font-medium text-foreground">{(attemptRemainingMs / 1000).toFixed(1)}s remaining</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Control Bar - Primary Action Area */}
          <div className="flex flex-col items-center gap-3 pt-2">
            {phase === "results" ? (
              <div className="flex flex-col items-center gap-2 w-full">
                <Button
                  size="lg"
                  onClick={() => setShowResultsDrawer(true)}
                  className="min-w-[200px] h-12 text-base font-semibold hover:cursor-pointer"
                >
                  Show results
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => {
                    setShowResultsDrawer(false);
                    handlePrimaryAction();
                  }}
                  className="min-w-[200px] h-12 text-base font-semibold hover:cursor-pointer "
                >
                  Restart Training
                </Button>
              </div>
            ) : (
              <Button
                variant={phase === "idle" ? "default" : "outline"}
                size="lg"
                onClick={handlePrimaryAction}
                disabled={phase === "countdown" || phase === "attempt_recording"}
                className="min-w-[200px] h-12 text-base font-semibold hover:cursor-pointer"
              >
                {phase === "idle" && "Start Training"}
                {phase === "countdown" && (countdownStep || "Cancel")}
                {phase === "attempt_recording" && "Recording…"}
              </Button>
            )}

            {/* Instruction text */}
            <p className="text-sm text-muted-foreground text-center max-w-md">
              {instructionText}
            </p>
          </div>


        {/* Results (shown in Drawer) */}
        {phase === "results" ? (
          <Drawer open={showResultsDrawer} onOpenChange={setShowResultsDrawer}>
            <DrawerContent className="max-h-[85vh]">
              <DrawerHeader>
                <DrawerTitle className="text-center">Results</DrawerTitle>
                <DrawerDescription className="text-center">AI feedback, raw data, and visualizations for your 3 attempts.</DrawerDescription>
              </DrawerHeader>
              <div className="px-4 pb-6 overflow-y-auto">
                <div className="flex items-baseline justify-center gap-2 mb-6">
                  <div className="text-4xl font-extrabold tabular-nums text-foreground">
                    {comparison?.score0to100 == null ? "—" : comparison.score0to100}
                  </div>
                  <div className="text-sm text-muted-foreground">/ 100</div>
                </div>

                {/* Tabbed interface for organized results */}
                <Tabs defaultValue="overview" className="w-full">
                  <TabsList className="grid w-full grid-cols-6 gap-2 bg-transparent p-0">
                    <TabsTrigger 
                      value="overview"
                      className="bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all duration-200 font-semibold hover:cursor-pointer"
                    >
                      Overview
                    </TabsTrigger>
                    <TabsTrigger 
                      value="ai-feedback"
                      className="bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all duration-200 font-semibold hover:cursor-pointer"
                    >
                      AI Feedback
                    </TabsTrigger>
                    <TabsTrigger 
                      value="raw-data"
                      className="bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all duration-200 font-semibold hover:cursor-pointer"
                    >
                      Raw Data
                    </TabsTrigger>
                    <TabsTrigger 
                      value="visualizations"
                      className="bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all duration-200 font-semibold hover:cursor-pointer"
                    >
                      Visualizations
                    </TabsTrigger>
                    <TabsTrigger 
                      value="scoring-explanation"
                      className="bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all duration-200 font-semibold hover:cursor-pointer"
                    >
                      Scoring
                    </TabsTrigger>
                    <TabsTrigger 
                      value="peak-debug"
                      className="bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all duration-200 font-semibold hover:cursor-pointer"
                    >
                      Peak Debug
                    </TabsTrigger>
                  </TabsList>

                  {/* Overview Tab */}
                  <TabsContent value="overview" className="space-y-4 mt-6">
                    <div className="rounded-md border bg-background/50 p-6 space-y-4">
                      <div className="text-lg font-semibold text-foreground text-center">Your Training Results</div>
                      <div className="text-sm text-muted-foreground text-center space-y-2">
                        <p>
                          You've completed your training session! Explore your performance using the tabs above:
                        </p>
                        <div className="space-y-3 mt-4 text-left">
                          <div className="flex items-start gap-3">
                            <div className="w-2 h-2 rounded-full bg-primary mt-1.5 flex-shrink-0"></div>
                            <div>
                              <div className="font-semibold text-foreground">AI Feedback</div>
                              <div className="text-xs">Get personalized coaching feedback and improvement suggestions based on your performance.</div>
                            </div>
                          </div>
                          <div className="flex items-start gap-3">
                            <div className="w-2 h-2 rounded-full bg-primary mt-1.5 flex-shrink-0"></div>
                            <div>
                              <div className="font-semibold text-foreground">Raw Data</div>
                              <div className="text-xs">View detailed per-attempt scores, feature errors, and technical metrics.</div>
                              <div className="text-xs">THIS IS RAW DATA AND VERY TECHNICAL.</div>
                            </div>
                          </div>
                          <div className="flex items-start gap-3">
                            <div className="w-2 h-2 rounded-full bg-primary mt-1.5 flex-shrink-0"></div>
                            <div>
                              <div className="font-semibold text-foreground">Visualizations</div>
                              <div className="text-xs">See your movements compared to the reference technique in data-visualizations.</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </TabsContent>

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
                            {technique?.category === "punch" && (
                              <div>
                                <span className="text-muted-foreground">Elbow MAE: </span>
                                <span className="text-foreground font-medium">
                                  {comparison.featureErrors?.leadElbowMaeDeg != null
                                    ? `${comparison.featureErrors.leadElbowMaeDeg.toFixed(1)}°`
                                    : "—"}
                                </span>
                              </div>
                            )}
                            {technique?.category === "kick" && comparison.featureErrors?.shoulderMaeDeg != null && (
                              <div>
                                <span className="text-muted-foreground">Shoulder MAE: </span>
                                <span className="text-foreground font-medium">
                                  {comparison.featureErrors.shoulderMaeDeg.toFixed(1)}°
                                </span>
                              </div>
                            )}
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
                          techniqueCategory={technique?.category}
                          comparison={comparison}
                        />
                      </div>
                    )}
                  </TabsContent>

                  {/* Scoring Explanation Tab */}
                  <TabsContent value="scoring-explanation" className="space-y-4 mt-4">
                    <div className="rounded-md border bg-background/50 p-6 space-y-6">
                      <div className="text-lg font-semibold text-foreground text-center">How Your Score is Calculated</div>
                      
                      {/* Overview */}
                      <div className="space-y-3">
                        <div className="text-base font-semibold text-foreground">Overview</div>
                        <div className="text-sm text-muted-foreground space-y-2">
                          <p>
                            Your performance is evaluated by comparing your movements to a reference technique using advanced computer vision and motion analysis. The scoring system analyzes multiple aspects of your technique to provide a comprehensive score from 0 to 100.
                          </p>
                        </div>
                      </div>

                      {/* Step 1: Pose Detection */}
                      <div className="space-y-3">
                        <div className="text-base font-semibold text-foreground">Step 1: Pose Detection & Feature Extraction</div>
                        <div className="text-sm text-muted-foreground space-y-2">
                          <p>
                            Using <strong className="text-foreground">MediaPipe PoseLandmarker</strong>, the system tracks 33 body landmarks in real-time:
                          </p>
                          <ul className="list-disc pl-5 space-y-1">
                            <li><strong className="text-foreground">Landmarks tracked:</strong> Face (nose, eyes, ears), upper body (shoulders, elbows, wrists, hands), and lower body (hips, knees, ankles, feet)</li>
                            <li><strong className="text-foreground">Model:</strong> MediaPipe Pose Landmarker Lite (optimized for real-time performance)</li>
                            <li><strong className="text-foreground">Feature extraction:</strong> From these landmarks, we calculate:
                              <ul className="list-disc pl-5 mt-1 space-y-1">
                                <li>Joint angles (elbow, knee, shoulder angles) using 3-point angle calculations</li>
                                <li>Extension distances (normalized distance from shoulder to wrist/ankle)</li>
                                <li>Guard distances (distance from guard hand to body center)</li>
                                <li>Body-relative measurements (normalized using hip-to-shoulder distance as the reference scale)</li>
                              </ul>
                            </li>
                            <li><strong className="text-foreground">Normalization:</strong> All measurements are normalized to your body size (using torso length) to ensure fair comparison across different body types</li>
                          </ul>
                        </div>
                      </div>

                      {/* Step 2: Active Motion Window */}
                      <div className="space-y-3">
                        <div className="text-base font-semibold text-foreground">Step 2: Active Motion Window Detection</div>
                        <div className="text-sm text-muted-foreground space-y-2">
                          <p>
                            The system identifies the most relevant portion of your movement by analyzing extension patterns:
                          </p>
                          <ul className="list-disc pl-5 space-y-1">
                            <li><strong className="text-foreground">Baseline calculation:</strong> Computes the median of the lowest 20% of extension values (represents your guard/resting position)</li>
                            <li><strong className="text-foreground">Peak detection:</strong> Identifies the maximum extension point during the attempt</li>
                            <li><strong className="text-foreground">Delta calculation:</strong> Calculates the difference between peak and baseline (extDelta = peak - baseline)</li>
                            <li><strong className="text-foreground">Window start:</strong> Finds the last frame before peak where extension ≤ baseline + 0.25 × delta</li>
                            <li><strong className="text-foreground">Window end:</strong> Finds the first frame after peak where extension ≤ baseline + 0.35 × delta</li>
                            <li>This ensures we only score the actual technique execution phase, filtering out preparation and recovery movements</li>
                          </ul>
                        </div>
                      </div>

                      {/* Step 3: Dynamic Time Warping */}
                      <div className="space-y-3">
                        <div className="text-base font-semibold text-foreground">Step 3: Temporal Alignment (Dynamic Time Warping)</div>
                        <div className="text-sm text-muted-foreground space-y-2">
                          <p>
                            Since everyone performs techniques at different speeds, we use <strong className="text-foreground">Dynamic Time Warping (DTW)</strong> to align your movement with the reference:
                          </p>
                          <ul className="list-disc pl-5 space-y-1">
                            <li><strong className="text-foreground">Purpose:</strong> Matches corresponding moments in your movement to the reference, regardless of speed differences</li>
                            <li><strong className="text-foreground">Features compared (with weights):</strong>
                              <ul className="list-disc pl-5 mt-1 space-y-1">
                                <li>Lead extension (weight: 30.0) - most important for alignment</li>
                                <li>Guard distance (weight: 30.0) - important for form alignment</li>
                                <li>Lead elbow angle (weight: 1.0) - primary alignment feature</li>
                                <li>Arm direction angle (weight: 0.15) - optional directional feature</li>
                                <li>Shoulder angle (weight: 0.05) - minimal weight, used for validation</li>
                              </ul>
                            </li>
                            <li><strong className="text-foreground">Result:</strong> Creates an optimal alignment path that accounts for timing variations</li>
                            <li><strong className="text-foreground">DTW Cost:</strong> The average cost along the alignment path represents how well your movement pattern matches the reference pattern (lower is better)</li>
                          </ul>
                        </div>
                      </div>

                      {/* Step 4: Error Calculation */}
                      <div className="space-y-3">
                        <div className="text-base font-semibold text-foreground">Step 4: Error Calculation (Mean Absolute Error)</div>
                        <div className="text-sm text-muted-foreground space-y-2">
                          <p>
                            For each aligned frame pair, we calculate the differences between your performance and the reference:
                          </p>
                          <ul className="list-disc pl-5 space-y-1">
                            <li><strong className="text-foreground">Lead Elbow MAE:</strong> Average difference in elbow angle (in degrees)</li>
                            <li><strong className="text-foreground">Extension MAE:</strong> Average difference in extension distance (in body-relative units)</li>
                            <li><strong className="text-foreground">Guard MAE:</strong> Average difference in guard distance (in body-relative units)</li>
                            <li><strong className="text-foreground">Shoulder MAE:</strong> Average difference in shoulder angle (for kicks)</li>
                          </ul>
                          <p className="mt-2">
                            Lower errors mean better alignment with the reference technique.
                          </p>
                        </div>
                      </div>

                      {/* Step 5: Component Scoring */}
                      <div className="space-y-3">
                        <div className="text-base font-semibold text-foreground">Step 5: Component Score Calculation</div>
                        <div className="text-sm text-muted-foreground space-y-2">
                          <p>
                            Each error metric is converted to a component score (0-1 scale):
                          </p>
                          <ul className="list-disc pl-5 space-y-1">
                            <li><strong className="text-foreground">Elbow Score:</strong> 45° average error → 0 points, 0° error → 1.0 points</li>
                            <li><strong className="text-foreground">Extension Score:</strong> 0.8 body-units average error → 0 points, 0 error → 1.0 points</li>
                            <li><strong className="text-foreground">Guard Score:</strong> 0.8 body-units average error → 0 points, 0 error → 1.0 points</li>
                          </ul>
                          <p className="mt-2">
                            The formula: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">score = max(0, 1 - (error / scale))</code>
                          </p>
                        </div>
                      </div>

                      {/* Step 6: Weighted Combination */}
                      <div className="space-y-3">
                        <div className="text-base font-semibold text-foreground">Step 6: Weighted Score Combination</div>
                        <div className="text-sm text-muted-foreground space-y-2">
                          <p>
                            Component scores are combined using technique-specific weights:
                          </p>
                          <div className="bg-muted/50 p-3 rounded-md space-y-1 text-xs">
                            <div className="font-semibold text-foreground mb-2">For Punching Techniques:</div>
                            <div className="space-y-1">
                              <div>• <strong>Lead Extension:</strong> 45% weight (most important)</div>
                              <div>• <strong>Lead Elbow:</strong> 35% weight</div>
                              <div>• <strong>Rear Guard:</strong> 20% weight</div>
                            </div>
                            <div className="font-semibold text-foreground mt-3 mb-2">For Kicking Techniques:</div>
                            <div className="space-y-1">
                              <div>• <strong>Leg Extension:</strong> 45% weight</div>
                              <div>• <strong>Knee Angle:</strong> 35% weight</div>
                              <div>• <strong>Shoulder Angle:</strong> 20% weight</div>
                            </div>
                          </div>
                          <p className="mt-2">
                            Final base score = (Weight₁ × Score₁ + Weight₂ × Score₂ + Weight₃ × Score₃) / Total Weight
                          </p>
                        </div>
                      </div>

                      {/* Step 7: Penalties */}
                      <div className="space-y-3">
                        <div className="text-base font-semibold text-foreground">Step 7: Penalties</div>
                        <div className="text-sm text-muted-foreground space-y-2">
                          <p>
                            Additional penalties may be applied for specific issues:
                          </p>
                          <ul className="list-disc pl-5 space-y-1">
                            <li><strong className="text-foreground">Insufficient Extension:</strong> If your peak extension is less than 75% of the reference peak extension (EXTENSION_PEAK_RATIO = 0.75)</li>
                            <li><strong className="text-foreground">Missing Recoil:</strong> If the movement doesn't show proper retraction after extension (extension should decrease after peak)</li>
                            <li><strong className="text-foreground">Insufficient Motion:</strong> If the extension delta (peak - baseline) is too small, indicating the technique wasn't fully executed</li>
                            <li><strong className="text-foreground">Low Velocity:</strong> If peak velocity is below threshold, indicating the movement was too slow</li>
                          </ul>
                          <p className="mt-2">
                            Penalties are subtracted from the base score (which is on a 0-1 scale) before scaling to 0-100.
                          </p>
                        </div>
                      </div>

                      {/* Final Score */}
                      <div className="space-y-3">
                        <div className="text-base font-semibold text-foreground">Final Score Calculation</div>
                        <div className="text-sm text-muted-foreground space-y-2">
                          <p>
                            <strong className="text-foreground">Final Score = Base Score - Penalties</strong>
                          </p>
                          <p>
                            The score is then scaled to a 0-100 range, where:
                          </p>
                          <ul className="list-disc pl-5 space-y-1">
                            <li><strong className="text-foreground">90-100:</strong> Excellent technique, very close to reference</li>
                            <li><strong className="text-foreground">75-89:</strong> Good technique with minor improvements needed</li>
                            <li><strong className="text-foreground">60-74:</strong> Decent technique, several areas need work</li>
                            <li><strong className="text-foreground">40-59:</strong> Needs significant improvement</li>
                            <li><strong className="text-foreground">0-39:</strong> Major technique issues, focus on fundamentals</li>
                          </ul>
                        </div>
                      </div>

                      {/* Technical Notes */}
                      <div className="space-y-3 pt-4 border-t">
                        <div className="text-base font-semibold text-foreground">Technical Notes</div>
                        <div className="text-xs text-muted-foreground space-y-2">
                          <p>
                            • <strong className="text-foreground">MediaPipe PoseLandmarker:</strong> Uses the Lite model optimized for real-time performance, running at 30 FPS inference rate with GPU acceleration
                          </p>
                          <p>
                            • <strong className="text-foreground">Body normalization:</strong> All measurements use body-relative units based on hip-to-shoulder distance (torso length) rather than absolute pixel measurements
                          </p>
                          <p>
                            • <strong className="text-foreground">Frame validation:</strong> Only frames where MediaPipe has sufficient confidence (visibility ≥ 0.3 for most landmarks, ≥ 0.15 for wrists/hands) are included in the analysis
                          </p>
                          <p>
                            • <strong className="text-foreground">Active motion window:</strong> Filters out idle movements by focusing only on the phase where extension exceeds baseline thresholds, ensuring we score actual technique execution
                          </p>
                          <p>
                            • <strong className="text-foreground">Score scaling:</strong> Component scores are calculated on a 0-1 scale, then the weighted combination is scaled to 0-100 for the final score
                          </p>
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  {/* Peak Frame Debug Tab */}
                  <TabsContent value="peak-debug" className="space-y-4 mt-4">
                    {comparison?.debug?.peakFrameDebug && technique?.category === "punch" ? (
                      <div className="space-y-4">
                        <div className="rounded-md border bg-background/50 p-4">
                          <div className="text-lg font-semibold text-foreground mb-4">Peak Frame Debug (Jab Extension)</div>
                          
                          {/* Mapping Warning */}
                          {comparison.debug.peakFrameDebug.mappingWarning && (
                            <div className="mb-4 p-3 rounded-md bg-amber-500/10 border border-amber-500/30">
                              <div className="text-sm font-semibold text-amber-600 dark:text-amber-400">⚠️ Mapping Warning</div>
                              <div className="text-xs text-amber-700 dark:text-amber-300 mt-1">{comparison.debug.peakFrameDebug.mappingWarning}</div>
                            </div>
                          )}

                          {/* Peak Frame Indices */}
                          <div className="mb-4 p-3 rounded-md bg-background/30">
                            <div className="text-sm font-semibold text-foreground mb-2">Aligned Peak Frames</div>
                            <div className="grid grid-cols-2 gap-3 text-xs">
                              <div>
                                <span className="text-muted-foreground">Camera Peak Index: </span>
                                <span className="text-foreground font-medium">{comparison.debug.peakFrameDebug.cameraPeakIdx}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Reference Peak Index: </span>
                                <span className="text-foreground font-medium">{comparison.debug.peakFrameDebug.referencePeakIdx}</span>
                              </div>
                            </div>
                          </div>

                          {/* Camera Debug Info */}
                          <div className="mb-4 p-3 rounded-md border">
                            <div className="text-sm font-semibold text-foreground mb-3">Camera Frame (Peak Extension)</div>
                            <div className="space-y-3 text-xs">
                              <div>
                                <span className="text-muted-foreground">Lead Side: </span>
                                <span className="text-foreground font-medium">{comparison.debug.peakFrameDebug.camera.leadSide}</span>
                                <span className="text-muted-foreground ml-2">• Mirrored: </span>
                                <span className="text-foreground font-medium">{comparison.debug.peakFrameDebug.camera.mirrored ? "Yes" : "No"}</span>
                              </div>
                              
                              {/* Lead Elbow Angle */}
                              <div className="p-2 rounded bg-background/30">
                                <div className="font-semibold text-foreground mb-1">Lead Elbow Angle</div>
                                <div className="text-muted-foreground mb-2 space-y-1">
                                  <div>
                                    Absolute: <span className="text-foreground font-medium tabular-nums">
                                      {comparison.debug.peakFrameDebug.camera.leadElbowAngle != null 
                                        ? `${comparison.debug.peakFrameDebug.camera.leadElbowAngle.toFixed(1)}°`
                                        : "N/A"}
                                    </span>
                                  </div>
                                  {comparison.debug.peakFrameDebug.camera.leadElbowBaseline != null && (
                                    <div>
                                      Baseline: <span className="text-foreground font-medium tabular-nums">
                                        {comparison.debug.peakFrameDebug.camera.leadElbowBaseline.toFixed(1)}°
                                      </span>
                                    </div>
                                  )}
                                  {comparison.debug.peakFrameDebug.camera.leadElbowDelta != null && (
                                    <div>
                                      ΔAngle: <span className="text-foreground font-medium tabular-nums">
                                        {comparison.debug.peakFrameDebug.camera.leadElbowDelta > 0 ? "+" : ""}{comparison.debug.peakFrameDebug.camera.leadElbowDelta.toFixed(1)}°
                                      </span>
                                    </div>
                                  )}
                                </div>
                                <div className="text-muted-foreground text-[10px] space-y-1 mt-2">
                                  <div>Shoulder: {comparison.debug.peakFrameDebug.camera.leadElbowPoints.shoulder ? `(${comparison.debug.peakFrameDebug.camera.leadElbowPoints.shoulder.x.toFixed(3)}, ${comparison.debug.peakFrameDebug.camera.leadElbowPoints.shoulder.y.toFixed(3)})` : "N/A"}</div>
                                  <div>Elbow: {comparison.debug.peakFrameDebug.camera.leadElbowPoints.elbow ? `(${comparison.debug.peakFrameDebug.camera.leadElbowPoints.elbow.x.toFixed(3)}, ${comparison.debug.peakFrameDebug.camera.leadElbowPoints.elbow.y.toFixed(3)})` : "N/A"}</div>
                                  <div>Wrist: {comparison.debug.peakFrameDebug.camera.leadElbowPoints.wrist ? `(${comparison.debug.peakFrameDebug.camera.leadElbowPoints.wrist.x.toFixed(3)}, ${comparison.debug.peakFrameDebug.camera.leadElbowPoints.wrist.y.toFixed(3)})` : "N/A"}</div>
                                </div>
                              </div>

                              {/* Shoulder Angle */}
                              {comparison.debug.peakFrameDebug.camera.shoulderAngle != null && (
                                <div className="p-2 rounded bg-background/30">
                                  <div className="font-semibold text-foreground mb-1">Shoulder Angle</div>
                                  <div className="text-muted-foreground mb-2">
                                    Computed: <span className="text-foreground font-medium tabular-nums">
                                      {comparison.debug.peakFrameDebug.camera.shoulderAngle.toFixed(1)}°
                                    </span>
                                  </div>
                                  <div className="text-muted-foreground text-[10px] space-y-1">
                                    <div>Torso (Hip): {comparison.debug.peakFrameDebug.camera.shoulderPoints.torso ? `(${comparison.debug.peakFrameDebug.camera.shoulderPoints.torso.x.toFixed(3)}, ${comparison.debug.peakFrameDebug.camera.shoulderPoints.torso.y.toFixed(3)})` : "N/A"}</div>
                                    <div>Shoulder: {comparison.debug.peakFrameDebug.camera.shoulderPoints.shoulder ? `(${comparison.debug.peakFrameDebug.camera.shoulderPoints.shoulder.x.toFixed(3)}, ${comparison.debug.peakFrameDebug.camera.shoulderPoints.shoulder.y.toFixed(3)})` : "N/A"}</div>
                                    <div>Elbow: {comparison.debug.peakFrameDebug.camera.shoulderPoints.elbow ? `(${comparison.debug.peakFrameDebug.camera.shoulderPoints.elbow.x.toFixed(3)}, ${comparison.debug.peakFrameDebug.camera.shoulderPoints.elbow.y.toFixed(3)})` : "N/A"}</div>
                                  </div>
                                </div>
                              )}

                              {/* Extension Metrics */}
                              <div className="p-2 rounded bg-background/30">
                                <div className="font-semibold text-foreground mb-1">Extension Metrics</div>
                                <div className="grid grid-cols-2 gap-2 text-[10px]">
                                  <div>Baseline: <span className="font-medium tabular-nums">{comparison.debug.peakFrameDebug.camera.extension.baseline?.toFixed(3) ?? "N/A"}</span></div>
                                  <div>Peak: <span className="font-medium tabular-nums">{comparison.debug.peakFrameDebug.camera.extension.peak?.toFixed(3) ?? "N/A"}</span></div>
                                  <div>Delta: <span className="font-medium tabular-nums">{comparison.debug.peakFrameDebug.camera.extension.delta?.toFixed(3) ?? "N/A"}</span></div>
                                  <div>Current: <span className="font-medium tabular-nums">{comparison.debug.peakFrameDebug.camera.extension.current?.toFixed(3) ?? "N/A"}</span></div>
                                </div>
                              </div>

                              {/* Guard Distance */}
                              {comparison.debug.peakFrameDebug.camera.guard != null && (
                                <div>
                                  <span className="text-muted-foreground">Guard Distance: </span>
                                  <span className="text-foreground font-medium tabular-nums">
                                    {comparison.debug.peakFrameDebug.camera.guard.toFixed(3)}
                                  </span>
                                </div>
                              )}

                              {/* Time to Peak */}
                              {comparison.debug.peakFrameDebug.camera.timeToPeakMs != null && (
                                <div>
                                  <span className="text-muted-foreground">Time to Peak: </span>
                                  <span className="text-foreground font-medium tabular-nums">
                                    {comparison.debug.peakFrameDebug.camera.timeToPeakMs.toFixed(0)}ms
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Reference Debug Info */}
                          <div className="mb-4 p-3 rounded-md border">
                            <div className="text-sm font-semibold text-foreground mb-3">Reference Frame (Aligned Peak)</div>
                            <div className="space-y-3 text-xs">
                              <div>
                                <span className="text-muted-foreground">Lead Side: </span>
                                <span className="text-foreground font-medium">{comparison.debug.peakFrameDebug.reference.leadSide}</span>
                              </div>
                              
                              {/* Lead Elbow Angle */}
                              <div className="p-2 rounded bg-background/30">
                                <div className="font-semibold text-foreground mb-1">Lead Elbow Angle</div>
                                <div className="text-muted-foreground mb-2 space-y-1">
                                  <div>
                                    Absolute: <span className="text-foreground font-medium tabular-nums">
                                      {comparison.debug.peakFrameDebug.reference.leadElbowAngle != null 
                                        ? `${comparison.debug.peakFrameDebug.reference.leadElbowAngle.toFixed(1)}°`
                                        : "N/A"}
                                    </span>
                                  </div>
                                  {comparison.debug.peakFrameDebug.reference.leadElbowBaseline != null && (
                                    <div>
                                      Baseline: <span className="text-foreground font-medium tabular-nums">
                                        {comparison.debug.peakFrameDebug.reference.leadElbowBaseline.toFixed(1)}°
                                      </span>
                                    </div>
                                  )}
                                  {comparison.debug.peakFrameDebug.reference.leadElbowDelta != null && (
                                    <div>
                                      ΔAngle: <span className="text-foreground font-medium tabular-nums">
                                        {comparison.debug.peakFrameDebug.reference.leadElbowDelta > 0 ? "+" : ""}{comparison.debug.peakFrameDebug.reference.leadElbowDelta.toFixed(1)}°
                                      </span>
                                    </div>
                                  )}
                                </div>
                                <div className="text-muted-foreground text-[10px] space-y-1 mt-2">
                                  <div>Shoulder: {comparison.debug.peakFrameDebug.reference.leadElbowPoints.shoulder ? `(${comparison.debug.peakFrameDebug.reference.leadElbowPoints.shoulder.x.toFixed(3)}, ${comparison.debug.peakFrameDebug.reference.leadElbowPoints.shoulder.y.toFixed(3)})` : "N/A"}</div>
                                  <div>Elbow: {comparison.debug.peakFrameDebug.reference.leadElbowPoints.elbow ? `(${comparison.debug.peakFrameDebug.reference.leadElbowPoints.elbow.x.toFixed(3)}, ${comparison.debug.peakFrameDebug.reference.leadElbowPoints.elbow.y.toFixed(3)})` : "N/A"}</div>
                                  <div>Wrist: {comparison.debug.peakFrameDebug.reference.leadElbowPoints.wrist ? `(${comparison.debug.peakFrameDebug.reference.leadElbowPoints.wrist.x.toFixed(3)}, ${comparison.debug.peakFrameDebug.reference.leadElbowPoints.wrist.y.toFixed(3)})` : "N/A"}</div>
                                </div>
                              </div>

                              {/* Shoulder Angle */}
                              {comparison.debug.peakFrameDebug.reference.shoulderAngle != null && (
                                <div className="p-2 rounded bg-background/30">
                                  <div className="font-semibold text-foreground mb-1">Shoulder Angle</div>
                                  <div className="text-muted-foreground mb-2 space-y-1">
                                    <div>
                                      Absolute: <span className="text-foreground font-medium tabular-nums">
                                        {comparison.debug.peakFrameDebug.reference.shoulderAngle.toFixed(1)}°
                                      </span>
                                    </div>
                                    {comparison.debug.peakFrameDebug.reference.shoulderBaseline != null && (
                                      <div>
                                        Baseline: <span className="text-foreground font-medium tabular-nums">
                                          {comparison.debug.peakFrameDebug.reference.shoulderBaseline.toFixed(1)}°
                                        </span>
                                      </div>
                                    )}
                                    {comparison.debug.peakFrameDebug.reference.shoulderDelta != null && (
                                      <div>
                                        ΔAngle: <span className="text-foreground font-medium tabular-nums">
                                          {comparison.debug.peakFrameDebug.reference.shoulderDelta > 0 ? "+" : ""}{comparison.debug.peakFrameDebug.reference.shoulderDelta.toFixed(1)}°
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                  <div className="text-muted-foreground text-[10px] space-y-1 mt-2">
                                    <div>Torso (Hip): {comparison.debug.peakFrameDebug.reference.shoulderPoints.torso ? `(${comparison.debug.peakFrameDebug.reference.shoulderPoints.torso.x.toFixed(3)}, ${comparison.debug.peakFrameDebug.reference.shoulderPoints.torso.y.toFixed(3)})` : "N/A"}</div>
                                    <div>Shoulder: {comparison.debug.peakFrameDebug.reference.shoulderPoints.shoulder ? `(${comparison.debug.peakFrameDebug.reference.shoulderPoints.shoulder.x.toFixed(3)}, ${comparison.debug.peakFrameDebug.reference.shoulderPoints.shoulder.y.toFixed(3)})` : "N/A"}</div>
                                    <div>Elbow: {comparison.debug.peakFrameDebug.reference.shoulderPoints.elbow ? `(${comparison.debug.peakFrameDebug.reference.shoulderPoints.elbow.x.toFixed(3)}, ${comparison.debug.peakFrameDebug.reference.shoulderPoints.elbow.y.toFixed(3)})` : "N/A"}</div>
                                  </div>
                                </div>
                              )}

                              {/* Extension Metrics */}
                              <div className="p-2 rounded bg-background/30">
                                <div className="font-semibold text-foreground mb-1">Extension Metrics</div>
                                <div className="grid grid-cols-2 gap-2 text-[10px]">
                                  <div>Baseline: <span className="font-medium tabular-nums">{comparison.debug.peakFrameDebug.reference.extension.baseline?.toFixed(3) ?? "N/A"}</span></div>
                                  <div>Peak: <span className="font-medium tabular-nums">{comparison.debug.peakFrameDebug.reference.extension.peak?.toFixed(3) ?? "N/A"}</span></div>
                                  <div>Delta: <span className="font-medium tabular-nums">{comparison.debug.peakFrameDebug.reference.extension.delta?.toFixed(3) ?? "N/A"}</span></div>
                                  <div>Current: <span className="font-medium tabular-nums">{comparison.debug.peakFrameDebug.reference.extension.current?.toFixed(3) ?? "N/A"}</span></div>
                                </div>
                              </div>

                              {/* Guard Distance */}
                              {comparison.debug.peakFrameDebug.reference.guard != null && (
                                <div>
                                  <span className="text-muted-foreground">Guard Distance: </span>
                                  <span className="text-foreground font-medium tabular-nums">
                                    {comparison.debug.peakFrameDebug.reference.guard.toFixed(3)}
                                  </span>
                                </div>
                              )}

                              {/* Time to Peak */}
                              {comparison.debug.peakFrameDebug.reference.timeToPeakMs != null && (
                                <div>
                                  <span className="text-muted-foreground">Time to Peak: </span>
                                  <span className="text-foreground font-medium tabular-nums">
                                    {comparison.debug.peakFrameDebug.reference.timeToPeakMs.toFixed(0)}ms
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Delta Comparison Summary */}
                          {comparison.debug.peakFrameDebug.camera.leadElbowDelta != null && comparison.debug.peakFrameDebug.reference.leadElbowDelta != null && (
                            <div className="mb-4 p-3 rounded-md border bg-background/30">
                              <div className="text-sm font-semibold text-foreground mb-2">Delta Angle Comparison (Movement Quality)</div>
                              <div className="grid grid-cols-2 gap-3 text-xs">
                                <div>
                                  <span className="text-muted-foreground">Camera ΔElbow: </span>
                                  <span className="text-foreground font-medium tabular-nums">
                                    {comparison.debug.peakFrameDebug.camera.leadElbowDelta > 0 ? "+" : ""}{comparison.debug.peakFrameDebug.camera.leadElbowDelta.toFixed(1)}°
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Reference ΔElbow: </span>
                                  <span className="text-foreground font-medium tabular-nums">
                                    {comparison.debug.peakFrameDebug.reference.leadElbowDelta > 0 ? "+" : ""}{comparison.debug.peakFrameDebug.reference.leadElbowDelta.toFixed(1)}°
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">ΔElbow Error: </span>
                                  <span className="text-foreground font-medium tabular-nums">
                                    {Math.abs(comparison.debug.peakFrameDebug.camera.leadElbowDelta - comparison.debug.peakFrameDebug.reference.leadElbowDelta).toFixed(1)}°
                                  </span>
                                </div>
                                {comparison.debug.peakFrameDebug.camera.timeToPeakMs != null && comparison.debug.peakFrameDebug.reference.timeToPeakMs != null && (
                                  <div>
                                    <span className="text-muted-foreground">Time-to-Peak Diff: </span>
                                    <span className="text-foreground font-medium tabular-nums">
                                      {Math.abs(comparison.debug.peakFrameDebug.camera.timeToPeakMs - comparison.debug.peakFrameDebug.reference.timeToPeakMs).toFixed(0)}ms
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* DTW Cost on Delta */}
                          {comparison.debug.peakFrameDebug.dtwCostOnDelta != null && (
                            <div className="mb-4 p-3 rounded-md border bg-background/30">
                              <div className="text-sm font-semibold text-foreground mb-2">DTW Cost on Delta Sequences</div>
                              <div className="text-xs">
                                <span className="text-muted-foreground">DTW avg cost (delta-based): </span>
                                <span className="text-foreground font-medium tabular-nums">
                                  {comparison.debug.peakFrameDebug.dtwCostOnDelta.toFixed(3)}
                                </span>
                              </div>
                            </div>
                          )}

                          {/* Simple Charts - Note: PoseComparisonCharts already shows elbow and extension */}
                          <div className="text-xs text-muted-foreground italic">
                            Note: See the "Visualizations" tab for detailed charts of elbow angle and extension over time.
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-md border bg-background/50 p-4">
                        <div className="text-sm text-muted-foreground text-center">
                          {technique?.category !== "punch" 
                            ? "Peak Frame Debug is only available for punch techniques (jabs)."
                            : "Peak frame debug information is not available for this attempt."}
                        </div>
                      </div>
                    )}
                  </TabsContent>

                  {/* Raw Data Tab */}
                  <TabsContent value="raw-data" className="space-y-4 mt-4">
                    {/* Overall Score */}
                    {comparison?.score0to100 != null && (
                      <div className="rounded-md border bg-background/50 p-3">
                        <div className="text-sm font-semibold text-foreground mb-2">Overall Score</div>
                        <div className="text-2xl font-bold tabular-nums text-foreground">
                          {comparison.score0to100.toFixed(1)} / 100
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Based on {comparison.matchedCount} matched frames out of {comparison.frameCount} total frames
                        </div>
                      </div>
                    )}

                    {/* Per-attempt breakdown */}
                    {comparison?.perAttempt && comparison.perAttempt.length > 0 && (
                      <div className="rounded-md border bg-background/50 p-3">
                        <div className="text-sm font-semibold text-foreground mb-3">Per-Attempt Breakdown</div>
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
                                {attempt.score0to100 == null ? "—" : attempt.score0to100}/100
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

                    {/* Feature Errors - Detailed */}
                    {comparison?.featureErrors && (
                      <div className="rounded-md border bg-background/50 p-3">
                        <div className="text-sm font-semibold text-foreground mb-3">Feature Errors (Mean Absolute Error)</div>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          {technique?.category === "punch" && comparison.featureErrors.leadElbowMaeDeg != null && (
                            <div>
                              <span className="text-muted-foreground">Lead Elbow MAE: </span>
                              <span className="text-foreground font-medium tabular-nums">
                                {comparison.featureErrors.leadElbowMaeDeg.toFixed(1)}°
                              </span>
                            </div>
                          )}
                          {comparison.featureErrors.rearElbowMaeDeg != null && (
                            <div>
                              <span className="text-muted-foreground">Rear Elbow MAE: </span>
                              <span className="text-foreground font-medium tabular-nums">
                                {comparison.featureErrors.rearElbowMaeDeg.toFixed(1)}°
                              </span>
                            </div>
                          )}
                          {comparison.featureErrors.extensionMae != null && (
                            <div>
                              <span className="text-muted-foreground">Extension MAE: </span>
                              <span className="text-foreground font-medium tabular-nums">
                                {comparison.featureErrors.extensionMae.toFixed(3)}
                              </span>
                            </div>
                          )}
                          {comparison.featureErrors.guardMae != null && (
                            <div>
                              <span className="text-muted-foreground">Guard Distance MAE: </span>
                              <span className="text-foreground font-medium tabular-nums">
                                {comparison.featureErrors.guardMae.toFixed(3)}
                              </span>
                            </div>
                          )}
                          {comparison.featureErrors.shoulderMaeDeg != null && (
                            <div>
                              <span className="text-muted-foreground">Shoulder MAE: </span>
                              <span className="text-foreground font-medium tabular-nums">
                                {comparison.featureErrors.shoulderMaeDeg.toFixed(1)}°
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Debug Metrics */}
                    {comparison?.debug && (
                      <div className="rounded-md border bg-background/50 p-3">
                        <div className="text-sm font-semibold text-foreground mb-3">Motion Metrics</div>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          {comparison.debug.cameraPeakExtension != null && (
                            <div>
                              <span className="text-muted-foreground">Camera Peak Extension: </span>
                              <span className="text-foreground font-medium tabular-nums">
                                {comparison.debug.cameraPeakExtension.toFixed(3)}
                              </span>
                            </div>
                          )}
                          {comparison.debug.referencePeakExtension != null && (
                            <div>
                              <span className="text-muted-foreground">Reference Peak Extension: </span>
                              <span className="text-foreground font-medium tabular-nums">
                                {comparison.debug.referencePeakExtension.toFixed(3)}
                              </span>
                            </div>
                          )}
                          {comparison.debug.guardCameraAvg != null && (
                            <div>
                              <span className="text-muted-foreground">Camera Avg Guard Distance: </span>
                              <span className="text-foreground font-medium tabular-nums">
                                {comparison.debug.guardCameraAvg.toFixed(3)}
                              </span>
                            </div>
                          )}
                          {comparison.debug.guardRefAvg != null && (
                            <div>
                              <span className="text-muted-foreground">Reference Avg Guard Distance: </span>
                              <span className="text-foreground font-medium tabular-nums">
                                {comparison.debug.guardRefAvg.toFixed(3)}
                              </span>
                            </div>
                          )}
                          {comparison.debug.peakVelocity != null && (
                            <div>
                              <span className="text-muted-foreground">Peak Velocity: </span>
                              <span className="text-foreground font-medium tabular-nums">
                                {comparison.debug.peakVelocity.toFixed(3)}
                              </span>
                            </div>
                          )}
                          {comparison.debug.activeWindowDurationMs != null && (
                            <div>
                              <span className="text-muted-foreground">Active Window Duration: </span>
                              <span className="text-foreground font-medium tabular-nums">
                                {(comparison.debug.activeWindowDurationMs / 1000).toFixed(2)}s
                              </span>
                            </div>
                          )}
                          {comparison.debug.extBaseline != null && (
                            <div>
                              <span className="text-muted-foreground">Extension Baseline: </span>
                              <span className="text-foreground font-medium tabular-nums">
                                {comparison.debug.extBaseline.toFixed(3)}
                              </span>
                            </div>
                          )}
                          {comparison.debug.extPeak != null && (
                            <div>
                              <span className="text-muted-foreground">Extension Peak: </span>
                              <span className="text-foreground font-medium tabular-nums">
                                {comparison.debug.extPeak.toFixed(3)}
                              </span>
                            </div>
                          )}
                          {comparison.debug.extDelta != null && (
                            <div>
                              <span className="text-muted-foreground">Extension Delta: </span>
                              <span className="text-foreground font-medium tabular-nums">
                                {comparison.debug.extDelta.toFixed(3)}
                              </span>
                            </div>
                          )}
                          {comparison.debug.leadSide && (
                            <div>
                              <span className="text-muted-foreground">Lead Side: </span>
                              <span className="text-foreground font-medium capitalize">
                                {comparison.debug.leadSide}
                              </span>
                            </div>
                          )}
                          {comparison.debug.cameraMirrored != null && (
                            <div>
                              <span className="text-muted-foreground">Camera Mirrored: </span>
                              <span className="text-foreground font-medium">
                                {comparison.debug.cameraMirrored ? "Yes" : "No"}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Angle Ranges */}
                    {comparison?.debug?.cameraElbow && comparison.debug.referenceElbow && (
                      <div className="rounded-md border bg-background/50 p-3">
                        <div className="text-sm font-semibold text-foreground mb-3">Elbow Angle Ranges</div>
                        <div className="space-y-2 text-xs">
                          {(["left", "right"] as const).map((side) => {
                            const camElbow = comparison.debug?.cameraElbow?.[side];
                            const refElbow = comparison.debug?.referenceElbow?.[side];
                            if (!camElbow || !refElbow) return null;
                            return (
                              <div key={side} className="grid grid-cols-4 gap-2">
                                <div className="capitalize text-muted-foreground">{side} Elbow:</div>
                                <div>
                                  <span className="text-muted-foreground">Camera: </span>
                                  <span className="text-foreground font-medium tabular-nums">
                                    {camElbow.min.toFixed(1)}° - {camElbow.max.toFixed(1)}°
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Reference: </span>
                                  <span className="text-foreground font-medium tabular-nums">
                                    {refElbow.min.toFixed(1)}° - {refElbow.max.toFixed(1)}°
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Range Diff: </span>
                                  <span className="text-foreground font-medium tabular-nums">
                                    {Math.abs((camElbow.max - camElbow.min) - (refElbow.max - refElbow.min)).toFixed(1)}°
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* DTW Metrics */}
                    {comparison?.dtw && (
                      <div className="rounded-md border bg-background/50 p-3">
                        <div className="text-sm font-semibold text-foreground mb-3">Dynamic Time Warping (DTW)</div>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <span className="text-muted-foreground">Average Cost: </span>
                            <span className="text-foreground font-medium tabular-nums">
                              {comparison.dtw.avgCost != null ? comparison.dtw.avgCost.toFixed(3) : "—"}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Path Length: </span>
                            <span className="text-foreground font-medium tabular-nums">
                              {comparison.dtw.pathLength}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Camera Sequence Length: </span>
                            <span className="text-foreground font-medium tabular-nums">
                              {comparison.dtw.cameraSeqLen}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Reference Sequence Length: </span>
                            <span className="text-foreground font-medium tabular-nums">
                              {comparison.dtw.referenceSeqLen}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Penalties */}
                    {comparison?.penalties && comparison.penalties.length > 0 && (
                      <div className="rounded-md border bg-background/50 p-3">
                        <div className="text-sm font-semibold text-foreground mb-2">Penalties Applied</div>
                        <div className="space-y-1 text-xs">
                          {comparison.penalties.map((p) => (
                            <div key={p.key} className="flex items-center justify-between">
                              <span className="text-muted-foreground">{p.reason}</span>
                              <span className="text-foreground font-medium tabular-nums">-{p.amount} points</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Validation Metrics */}
                    {comparison?.validation && (
                      <div className="rounded-md border bg-background/50 p-3">
                        <div className="text-sm font-semibold text-foreground mb-3">Data Quality</div>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <span className="text-muted-foreground">Validity Ratio: </span>
                            <span className="text-foreground font-medium tabular-nums">
                              {(comparison.validation.validityRatio * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Motion Energy: </span>
                            <span className="text-foreground font-medium tabular-nums">
                              {comparison.validation.motionEnergy.toFixed(3)} units/s
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

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
                                  result: a.result ?? null,
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
          </DrawerContent>
        </Drawer>
        ) : null}

        {/* Countdown Overlay */}
        {phase === "countdown" && countdownStep !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm pointer-events-auto">
            <div className="text-center space-y-4">
              {attemptIndex > 0 && attemptIndex <= 3 && (
                <div className="text-sm text-muted-foreground font-medium">Attempt {attemptIndex}/3</div>
              )}
              <div 
                className="text-8xl sm:text-9xl font-extrabold tracking-tight tabular-nums text-foreground"
                style={{
                  animation: "scaleIn 0.3s ease-out",
                }}
              >
                {countdownStep}
              </div>
              <div className="text-base text-muted-foreground">
                {attemptIndex > 0 ? `Starting attempt ${attemptIndex}…` : "Get ready…"}
              </div>
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Start Training Drawer - Outside main container to avoid pointer-events issues */}
      <Drawer open={showStartDialog} onOpenChange={setShowStartDialog}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Ready to Start Training?</DrawerTitle>
            <DrawerDescription>
              You're about to perform 3 attempts of the {technique?.name || "technique"}.
            </DrawerDescription>
          </DrawerHeader>
          <div className="text-sm text-muted-foreground space-y-3 px-4">
            <p>
              Here's what will happen:
            </p>
            <ul className="list-disc list-inside space-y-1.5 text-sm ml-2">
              <li>A countdown will begin (3... 2... 1... GO)</li>
              <li>Each attempt will last <strong>3 seconds</strong></li>
              <li>Perform the technique during each attempt ONLY ONCE!</li>
              <li>Once you did your technique, hold still untill the attempt is finished</li>
              <li>After all 3 attempts, you'll see your results and feedback</li>
            </ul>
            <p className="pt-1">
              Make sure you're fully in frame and have space to move before starting.
            </p>
          </div>
          <DrawerFooter>
            <Button className="hover:cursor-pointer"
              onClick={() => {
                setShowStartDialog(false);
                setAttemptIndex(1);
                setPhase("countdown");
              }}
            >
              I Understand
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowStartDialog(false)}
              className="hover:cursor-pointer"
            >
              Cancel
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

export default function LiveDemoPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background">
          <div className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
            <div className="container mx-auto px-4 py-3 max-w-7xl">
              <div className="text-sm text-muted-foreground">Loading…</div>
            </div>
          </div>
          <div className="container mx-auto px-4 py-6 max-w-7xl">
            <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
              Preparing training session…
            </div>
          </div>
        </div>
      }
    >
      <LiveDemoInner />
    </Suspense>
  );
}

