"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import SceneCanvas from "@/app/components/training/SceneCanvas";
import type { ReferenceFrame } from "@/app/components/training/SceneCanvas";
import { getTechniqueById, type Technique } from "@/app/lib/techniques";
import type { PoseCameraOverlayHandle, PoseFrame } from "@/app/components/pose/PoseCameraOverlay";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// Keep camera/mediapipe out of SSR/bundles where possible
const PoseCameraOverlay = dynamic(() => import("@/app/components/pose/PoseCameraOverlay").then((mod) => ({ default: mod.PoseCameraOverlay })), { ssr: false });

type Phase = "idle" | "countdown" | "recording" | "results";
type CountdownStep = 3 | 2 | 1 | "GO";

const MAX_POSE_BUFFER_MS = 10_000; // keep last 10s of frames in memory
const MAX_REFERENCE_BUFFER_MS = 10_000; // keep last 10s of reference frames in memory

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
  score0to100: number | null;
  rows: AngleDeltaRow[];
  worstJoints: WorstJointHint[];
  frameCount: number;
  matchedCount: number;
  durationMs: number | null;
};

const ANGLE_LABELS: Record<AngleKey, string> = {
  leftElbow: "Left elbow",
  rightElbow: "Right elbow",
  leftKnee: "Left knee",
  rightKnee: "Right knee",
  leftShoulder: "Left shoulder",
  rightShoulder: "Right shoulder",
};

function angleDeg(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, c: { x: number; y: number; z: number }): number {
  // Angle at point b between vectors (a-b) and (c-b)
  const v1 = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const v2 = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
  const n1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
  const n2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);
  if (n1 === 0 || n2 === 0) return NaN;
  const cos = Math.min(1, Math.max(-1, dot / (n1 * n2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function normalizeLandmarkPoints(landmarks: any): ((i: number) => { x: number; y: number; z: number } | null) {
  // Normalize to body-relative coordinates:
  // - center at mid-hips
  // - scale by hip->shoulder distance (reduces distance-to-camera effects)
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

  return (i: number) => {
    const p = raw(i);
    if (!p) return null;
    return {
      x: (p.x - hipCenter.x) * invScale,
      y: (p.y - hipCenter.y) * invScale,
      z: (p.z - hipCenter.z) * invScale,
    };
  };
}

function extractAnglesFromLandmarks(landmarks: any): AngleSample {
  // MediaPipe Pose landmarks indices:
  // 11 LShoulder, 13 LElbow, 15 LWrist
  // 12 RShoulder, 14 RElbow, 16 RWrist
  // 23 LHip, 25 LKnee, 27 LAnkle
  // 24 RHip, 26 RKnee, 28 RAnkle
  // Shoulder angle approximation:
  // Left: LHip -> LShoulder -> LElbow
  // Right: RHip -> RShoulder -> RElbow
  const get = normalizeLandmarkPoints(landmarks);

  const ls = get(11), le = get(13), lw = get(15);
  const rs = get(12), re = get(14), rw = get(16);
  const lh = get(23), lk = get(25), la = get(27);
  const rh = get(24), rk = get(26), ra = get(28);

  const out: AngleSample = {};
  if (ls && le && lw) out.leftElbow = angleDeg(ls, le, lw);
  if (rs && re && rw) out.rightElbow = angleDeg(rs, re, rw);
  if (lh && lk && la) out.leftKnee = angleDeg(lh, lk, la);
  if (rh && rk && ra) out.rightKnee = angleDeg(rh, rk, ra);
  if (lh && ls && le) out.leftShoulder = angleDeg(lh, ls, le);
  if (rh && rs && re) out.rightShoulder = angleDeg(rh, rs, re);

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

export default function LiveDemoPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const techniqueId = searchParams.get("techniqueId");
  const technique: Technique | null = useMemo(() => (techniqueId ? getTechniqueById(techniqueId) : null), [techniqueId]);

  const [phase, setPhase] = useState<Phase>("idle");
  const [countdownStep, setCountdownStep] = useState<CountdownStep | null>(null);
  const [poseReady, setPoseReady] = useState(false);
  const poseReadyRef = useRef(false);
  const phaseRef = useRef<Phase>("idle");
  const poseCameraOverlayRef = useRef<PoseCameraOverlayHandle>(null);
  const poseFramesRef = useRef<PoseFrame[]>([]);
  const poseFrameCountRef = useRef(0);
  const lastPoseAtRef = useRef<number | null>(null);
  const referenceFramesRef = useRef<ReferenceFrame[]>([]);
  const referenceFrameCountRef = useRef(0);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const ignoreNextOnStopRef = useRef(false);
  // Naming aliases for debug clarity
  const cameraFramesRef = poseFramesRef;
  const refFramesRef = referenceFramesRef;

  const statusText = useMemo(() => {
    if (phase === "idle") return "Idle";
    if (phase === "countdown") return "Starting...";
    if (phase === "results") return "Results";
    return "Recording";
  }, [phase]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Keep camera on for the whole page lifecycle.
  // We only start/stop "recording" (buffering + scoring) based on phase.
  useEffect(() => {
    if (phase === "idle") {
      lastPoseAtRef.current = null;
    }
  }, [phase]);

  const handlePoseFrame = useCallback((frame: PoseFrame) => {
    // Mark "pose ready" once (no per-frame React state updates)
    if (!poseReadyRef.current && frame.landmarks) {
      poseReadyRef.current = true;
      setPoseReady(true);
    }

    if (phaseRef.current !== "recording") return;

    // Store frame during recording
    poseFramesRef.current.push(frame);

    // Trim buffer to avoid unbounded growth (keep last MAX_POSE_BUFFER_MS)
    const newestTs = frame.wallClockMs ?? Date.now();
    const cutoff = newestTs - MAX_POSE_BUFFER_MS;
    // Drop from the front while old
    while (poseFramesRef.current.length > 0) {
      const oldest = poseFramesRef.current[0];
      const oldestTs = oldest.wallClockMs ?? 0;
      if (oldestTs >= cutoff) break;
      poseFramesRef.current.shift();
    }

    poseFrameCountRef.current = poseFramesRef.current.length;
    if (frame.landmarks) {
      lastPoseAtRef.current = Date.now();
    }
  }, []);

  const handleReferenceFrame = useCallback((frame: ReferenceFrame) => {
    if (phaseRef.current !== "recording") return;

    // Buffer reference frames during recording (no React state updates here)
    referenceFramesRef.current.push(frame);

    // Trim buffer (keep last MAX_REFERENCE_BUFFER_MS)
    const newestTs = frame.wallClockMs ?? Date.now();
    const cutoff = newestTs - MAX_REFERENCE_BUFFER_MS;
    while (referenceFramesRef.current.length > 0) {
      const oldestTs = referenceFramesRef.current[0].wallClockMs ?? 0;
      if (oldestTs >= cutoff) break;
      referenceFramesRef.current.shift();
    }

    referenceFrameCountRef.current = referenceFramesRef.current.length;
  }, []);

  // Clear previous recording frames when starting a new run
  useEffect(() => {
    if (phase === "countdown") {
      poseFramesRef.current = [];
      poseFrameCountRef.current = 0;
      lastPoseAtRef.current = null;
      referenceFramesRef.current = [];
      referenceFrameCountRef.current = 0;
      setComparison(null);
    }
  }, [phase]);

  // Compute comparison when recording ends
  useEffect(() => {
    if (phase !== "results") return;

    const frames = poseFramesRef.current;
    // For alignment, we only require timestamps. (Angles comparison still requires landmarks.)
    const validFrames = frames.filter((f) => typeof f.wallClockMs === "number");
    const refFrames = referenceFramesRef.current.filter((f) => typeof f.wallClockMs === "number");

    // Simple timing alignment: align both streams by movement onset (velocity threshold)
    const camOnsetMs = detectMovementOnsetMsFromPoseFrames(frames);
    const refOnsetMs = detectMovementOnsetMsFromReferenceFrames(refFrames);

    const durationMs =
      frames.length >= 2
        ? Math.max(0, (frames[frames.length - 1].wallClockMs ?? 0) - (frames[0].wallClockMs ?? 0))
        : null;

    const angleKeys: AngleKey[] = ["leftElbow", "rightElbow", "leftKnee", "rightKnee", "leftShoulder", "rightShoulder"];

    // Accumulate matched-pair stats (camera vs reference)
    const cameraValues: Record<AngleKey, number[]> = Object.fromEntries(angleKeys.map((k) => [k, []])) as Record<AngleKey, number[]>;
    const refValues: Record<AngleKey, number[]> = Object.fromEntries(angleKeys.map((k) => [k, []])) as Record<AngleKey, number[]>;
    const absErrors: Record<AngleKey, number[]> = Object.fromEntries(angleKeys.map((k) => [k, []])) as Record<AngleKey, number[]>;
    const signedErrors: Record<AngleKey, number[]> = Object.fromEntries(angleKeys.map((k) => [k, []])) as Record<AngleKey, number[]>;

    let matchedCount = 0;

    for (const camFrame of validFrames) {
      const tAbs = camFrame.wallClockMs;
      const tAlignedAbs =
        camOnsetMs != null && refOnsetMs != null
          ? refOnsetMs + (tAbs - camOnsetMs)
          : tAbs;

      const refFrame = closestByWallClockMs(refFrames, tAlignedAbs);
      if (!refFrame) continue;

      // Count alignment even if the reference feature vector isn't ready yet.
      matchedCount += 1;

      // Can't compare angles without both a camera pose and a reference vector.
      if (!camFrame.landmarks) continue;
      if (!refFrame.featureVector || refFrame.featureVector.length === 0) continue;

      const camAngles = extractAnglesFromLandmarks(camFrame.landmarks);
      const refAngles = anglesFromReferenceVector(refFrame.featureVector);

      let anyCompared = false;
      for (const k of angleKeys) {
        const c = camAngles[k];
        const r = refAngles[k];
        if (typeof c !== "number" || !Number.isFinite(c)) continue;
        if (typeof r !== "number" || !Number.isFinite(r)) continue;
        cameraValues[k].push(c);
        refValues[k].push(r);
        absErrors[k].push(Math.abs(c - r));
        signedErrors[k].push(c - r);
        anyCompared = true;
      }

      // (matchedCount already counts aligned frames; scoring uses only values we actually compared)
    }

    const rows: AngleDeltaRow[] = angleKeys.map((k) => {
      const actual = mean(cameraValues[k]);
      const ideal = mean(refValues[k]);
      const delta = mean(absErrors[k]); // average absolute error for this angle
      const signedError = mean(signedErrors[k]); // average signed error (camera - reference)
      return {
        key: k,
        label: ANGLE_LABELS[k],
        actualDeg: actual,
        idealDeg: ideal,
        deltaDeg: delta,
        signedErrorDeg: signedError,
      };
    });

    const perAngleAvgErrors = rows.map((r) => r.deltaDeg).filter((d): d is number => typeof d === "number" && Number.isFinite(d));
    const avgAbsError = mean(perAngleAvgErrors);

    // Map average absolute error (deg) to score 0..100 (no DTW yet)
    const MAX_ERROR_FOR_ZERO = 90; // deg
    const score = avgAbsError == null ? null : Math.max(0, Math.min(100, Math.round(100 * (1 - avgAbsError / MAX_ERROR_FOR_ZERO))));

    const worstJoints: WorstJointHint[] = rows
      .filter((r) => typeof r.deltaDeg === "number" && Number.isFinite(r.deltaDeg) && typeof r.signedErrorDeg === "number" && Number.isFinite(r.signedErrorDeg))
      .sort((a, b) => (b.deltaDeg as number) - (a.deltaDeg as number))
      .slice(0, 2)
      .map((r) => ({
        key: r.key,
        label: r.label,
        avgErrorDeg: r.deltaDeg as number,
        hint: hintForJoint(r.key, r.signedErrorDeg as number),
      }));

    setComparison({
      score0to100: score,
      rows,
      worstJoints,
      frameCount: frames.length,
      matchedCount,
      durationMs,
    });
  }, [phase]);

  // Countdown state machine: idle -> countdown -> recording
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
      setPhase("recording");
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
      setPhase("countdown");
      return;
    }
    if (phase === "countdown") {
      setCountdownStep(null);
      setPhase("idle");
      return;
    }
    if (phase === "recording") {
      ignoreNextOnStopRef.current = true;
      setPhase("results");
      return;
    }
    // results
    lastPoseAtRef.current = null;
    setPhase("idle");
  };

  const primaryLabel = useMemo(() => {
    if (phase === "idle") return "Start";
    if (phase === "countdown") return "Cancel";
    if (phase === "recording") return "Stop";
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
                  onReferenceFrame={phase === "recording" ? handleReferenceFrame : undefined}
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
                mirrored={true}
                inferenceFps={15}
                onPoseFrame={handlePoseFrame}
              />

              {phase !== "recording" && (
                <div className="mt-3 rounded-lg border bg-card p-3 text-center text-xs text-muted-foreground">
                  {phase === "results" ? "Recording stopped. Review results below." : "Camera is on. Press Start to begin the countdown and record a run."}
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
                    Based on last {comparison?.frameCount ?? 0} frames
                    {comparison?.durationMs != null ? ` (~${(comparison.durationMs / 1000).toFixed(1)}s)` : ""}.
                    {comparison?.matchedCount != null ? ` Matched: ${comparison.matchedCount}.` : ""}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    Debug: cameraFramesRef={cameraFramesRef.current.length} · refFramesRef={refFramesRef.current.length}
                  </div>
                </div>

                <div className="flex items-baseline justify-center gap-2">
                  <div className="text-4xl font-extrabold tabular-nums text-foreground">
                    {comparison?.score0to100 == null ? "—" : comparison.score0to100}
                  </div>
                  <div className="text-sm text-muted-foreground">/ 100</div>
                </div>

                {comparison?.worstJoints && comparison.worstJoints.length > 0 ? (
                  <div className="rounded-md border bg-background/50 p-3 text-left">
                    <div className="text-sm font-semibold text-foreground mb-2">Top issues</div>
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
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Countdown overlay */}
      {phase === "countdown" && countdownStep !== null && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm pointer-events-auto">
          <div className="text-center space-y-3">
            <div className="text-6xl sm:text-7xl font-extrabold tracking-tight tabular-nums">
              {countdownStep}
            </div>
            <div className="text-sm text-muted-foreground">
              Starting practice… please hold position.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

