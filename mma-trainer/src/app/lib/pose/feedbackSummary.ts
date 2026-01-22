import type { AttemptExport, SessionExport } from "./exportTypes";

export type FeedbackSummary = {
  technique: string;
  overallScore: number | null;
  attempts: Array<{
    score: number | null;
    extDelta: number;
    vPeak: number;
    dtwAvgCost: number | null;
    worstJoints: Array<{ joint: string; errorDeg: number }>;
    timing: {
      durationMs: number;
      peakExtMs: number | null;
    };
  }>;
  aggregate: {
    consistency: number; // 0..1, based on score variance
    worstJoints: Array<{ joint: string; avgErrorDeg: number }>;
    biggestDeviation: {
      joint: string;
      errorDeg: number;
      attemptIndex: number;
    } | null;
  };
  dataQuality: {
    validFrameRatioAvg: number;
    occlusionRisk: "low" | "medium" | "high"; // Based on validFrameRatio
  };
  curves: {
    leadExtCamera: number[];
    leadExtRef: number[];
    leadElbowCameraDeg: number[];
    leadElbowRefDeg: number[];
    rearGuardCamera: number[];
    rearGuardRef: number[];
  }; // Downsampled to <= 60 points each
};

/**
 * Build FeedbackSummary from SessionExport for AI feedback generation.
 */
export function buildFeedbackSummary(session: SessionExport): FeedbackSummary {
  const validAttempts = session.attempts.filter((a) => a.aggregates.score0to100 != null);
  const scores = validAttempts
    .map((a) => a.aggregates.score0to100)
    .filter((s): s is number => typeof s === "number" && Number.isFinite(s));

  // Compute consistency (inverse of coefficient of variation)
  let consistency = 1.0;
  if (scores.length >= 2) {
    const meanScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((acc, s) => acc + Math.pow(s - meanScore, 2), 0) / scores.length;
    const stdDev = Math.sqrt(variance);
    const cv = meanScore > 0 ? stdDev / meanScore : 1.0;
    consistency = Math.max(0, Math.min(1, 1 - cv)); // Higher consistency = lower variance
  }

  // Aggregate worst joints across attempts
  const jointErrors: Record<string, number[]> = {};
  for (const attempt of validAttempts) {
    for (const [joint, error] of Object.entries(attempt.aggregates.perJointMaeDeg)) {
      if (typeof error === "number" && Number.isFinite(error)) {
        if (!jointErrors[joint]) jointErrors[joint] = [];
        jointErrors[joint].push(error);
      }
    }
  }

  const worstJoints = Object.entries(jointErrors)
    .map(([joint, errors]) => ({
      joint,
      avgErrorDeg: errors.reduce((a, b) => a + b, 0) / errors.length,
    }))
    .sort((a, b) => b.avgErrorDeg - a.avgErrorDeg)
    .slice(0, 3);

  // Find biggest deviation
  let biggestDeviation: { joint: string; errorDeg: number; attemptIndex: number } | null = null;
  for (const attempt of validAttempts) {
    for (const [joint, error] of Object.entries(attempt.aggregates.perJointMaeDeg)) {
      if (typeof error === "number" && Number.isFinite(error)) {
        if (!biggestDeviation || error > biggestDeviation.errorDeg) {
          biggestDeviation = { joint, errorDeg: error, attemptIndex: attempt.attemptIndex };
        }
      }
    }
  }

  // Compute data quality
  const validFrameRatios = validAttempts.map((a) => a.aggregates.gates.validFrameRatio);
  const validFrameRatioAvg =
    validFrameRatios.length > 0
      ? validFrameRatios.reduce((a, b) => a + b, 0) / validFrameRatios.length
      : 0;
  const occlusionRisk =
    validFrameRatioAvg >= 0.9 ? "low" : validFrameRatioAvg >= 0.7 ? "medium" : "high";

  // Build attempt summaries
  const attemptSummaries = validAttempts.map((attempt) => {
    const worstJointsForAttempt = Object.entries(attempt.aggregates.perJointMaeDeg)
      .map(([joint, error]) => ({
        joint,
        errorDeg: typeof error === "number" && Number.isFinite(error) ? error : 0,
      }))
      .filter((w) => w.errorDeg > 0)
      .sort((a, b) => b.errorDeg - a.errorDeg)
      .slice(0, 2);

    // Find peak extension time (if features available)
    let peakExtMs: number | null = null;
    if (attempt.featuresPerFrame && attempt.featuresPerFrame.length > 0) {
      let maxExt = -Infinity;
      for (const feature of attempt.featuresPerFrame) {
        if (feature.leadExt > maxExt) {
          maxExt = feature.leadExt;
          peakExtMs = feature.tMs;
        }
      }
    }

    return {
      score: attempt.aggregates.score0to100,
      extDelta: attempt.aggregates.gates.extDelta,
      vPeak: attempt.aggregates.gates.vPeak,
      dtwAvgCost: attempt.aggregates.dtw.avgCost,
      worstJoints: worstJointsForAttempt,
      timing: {
        durationMs: attempt.activeWindow.endMs - attempt.activeWindow.startMs,
        peakExtMs,
      },
    };
  });

  // Build curves (downsample to <= 60 points)
  const downsampleCurve = (values: number[], maxPoints: number = 60): number[] => {
    if (values.length <= maxPoints) return values;
    const step = values.length / maxPoints;
    const sampled: number[] = [];
    for (let i = 0; i < values.length; i += step) {
      sampled.push(values[Math.floor(i)]);
    }
    return sampled;
  };

  // Extract curves from first valid attempt
  // Note: Reference curves would need to be extracted from reference feature sequences
  // For now, we extract camera curves from featuresPerFrame if available
  const firstValidAttempt = validAttempts[0];
  const curves = {
    leadExtCamera: [] as number[],
    leadExtRef: [] as number[],
    leadElbowCameraDeg: [] as number[],
    leadElbowRefDeg: [] as number[],
    rearGuardCamera: [] as number[],
    rearGuardRef: [] as number[],
  };

  if (firstValidAttempt?.featuresPerFrame && firstValidAttempt.featuresPerFrame.length > 0) {
    // Extract from features per frame
    const leadExts = firstValidAttempt.featuresPerFrame
      .map((f) => f.leadExt)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const leadElbows = firstValidAttempt.featuresPerFrame
      .map((f) => f.leadElbowDeg)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const rearGuards = firstValidAttempt.featuresPerFrame
      .map((f) => f.rearGuard)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

    curves.leadExtCamera = downsampleCurve(leadExts, 60);
    curves.leadElbowCameraDeg = downsampleCurve(leadElbows, 60);
    curves.rearGuardCamera = downsampleCurve(rearGuards, 60);

    // Reference curves would need to be extracted from reference feature sequences
    // For now, use empty arrays (can be populated if reference features are available in export)
    curves.leadExtRef = [];
    curves.leadElbowRefDeg = [];
    curves.rearGuardRef = [];
  }

  return {
    technique: session.techniqueId,
    overallScore: session.summary.overallScore,
    attempts: attemptSummaries,
    aggregate: {
      consistency,
      worstJoints,
      biggestDeviation,
    },
    dataQuality: {
      validFrameRatioAvg,
      occlusionRisk,
    },
    curves,
  };
}
