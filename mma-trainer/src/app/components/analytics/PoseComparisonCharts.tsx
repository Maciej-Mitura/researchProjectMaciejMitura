"use client";

import { useMemo, useState } from "react";
import { 
  LineChart, Line, 
  BarChart, Bar, 
  AreaChart, Area,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from "recharts";
import { Switch } from "@/components/ui/switch";

type ChartDataPoint = {
  t: number; // Normalized time (0..1) or milliseconds offset
  tMs: number; // Actual milliseconds
  extCam: number | null;
  extRef: number | null;
  elbowCam: number | null;
  elbowRef: number | null;
  kneeCam: number | null;
  kneeRef: number | null;
  shoulderCam: number | null;
  shoulderRef: number | null;
  guardCam: number | null;
  guardRef: number | null;
};

type PoseComparisonChartsProps = {
  cameraSeq: Array<{
    wallClockMs: number;
    leadExtension: number | null;
    angles: {
      leftElbow?: number;
      rightElbow?: number;
      leftKnee?: number;
      rightKnee?: number;
      leftShoulder?: number;
      rightShoulder?: number;
    };
    rearGuardDist: number | null;
  }>;
  refSeq: Array<{
    wallClockMs: number;
    leadExtension: number | null;
    angles: {
      leftElbow?: number;
      rightElbow?: number;
      leftKnee?: number;
      rightKnee?: number;
      leftShoulder?: number;
      rightShoulder?: number;
    };
    rearGuardDist: number | null;
  }>;
  leadSide: "left" | "right";
  activeWindowStartMs: number | null;
  activeWindowEndMs: number | null;
  techniqueCategory?: "punch" | "kick" | "defense" | "grappling";
  comparison?: {
    debug?: {
      cameraPeakExtension?: number | null;
      referencePeakExtension?: number | null;
      cameraElbow?: {
        left?: { min: number; max: number };
        right?: { min: number; max: number };
      };
      referenceElbow?: {
        left?: { min: number; max: number };
        right?: { min: number; max: number };
      };
      guardCameraAvg?: number | null;
      guardRefAvg?: number | null;
      peakVelocity?: number | null;
    };
    featureErrors?: {
      extensionMae?: number | null;
      guardMae?: number | null;
      leadElbowMaeDeg?: number | null;
      shoulderMaeDeg?: number | null;
    };
  };
};

/**
 * Downsample data to max 120 points per series.
 */
function downsampleData<T extends { t: number }>(data: T[], maxPoints: number = 120): T[] {
  if (data.length <= maxPoints) return data;
  const step = data.length / maxPoints;
  const sampled: T[] = [];
  for (let i = 0; i < data.length; i += step) {
    sampled.push(data[Math.floor(i)]);
  }
  return sampled.length > 0 ? sampled : data.slice(0, maxPoints);
}

export function PoseComparisonCharts({
  cameraSeq,
  refSeq,
  leadSide,
  activeWindowStartMs,
  activeWindowEndMs,
  techniqueCategory,
  comparison,
}: PoseComparisonChartsProps) {
  const [useNormalizedTime, setUseNormalizedTime] = useState(true);

  const chartData = useMemo(() => {
    if (cameraSeq.length === 0 && refSeq.length === 0) return [];

    const leadElbowKey = leadSide === "left" ? "leftElbow" : "rightElbow";
    const leadKneeKey = leadSide === "left" ? "leftKnee" : "rightKnee";
    const leadShoulderKey = leadSide === "left" ? "leftShoulder" : "rightShoulder";
    const startMs = activeWindowStartMs ?? cameraSeq[0]?.wallClockMs ?? refSeq[0]?.wallClockMs ?? 0;
    const endMs = activeWindowEndMs ?? cameraSeq[cameraSeq.length - 1]?.wallClockMs ?? refSeq[refSeq.length - 1]?.wallClockMs ?? startMs;
    const durationMs = endMs - startMs;

    // Build combined dataset
    const dataMap = new Map<number, ChartDataPoint>();

    // Add camera data
    for (const frame of cameraSeq) {
      if (typeof frame.wallClockMs !== "number") continue;
      const tMs = frame.wallClockMs - startMs;
      const t = durationMs > 0 ? tMs / durationMs : 0;

      if (!dataMap.has(frame.wallClockMs)) {
        dataMap.set(frame.wallClockMs, {
          t: useNormalizedTime ? t : tMs,
          tMs,
          extCam: null,
          extRef: null,
          elbowCam: null,
          elbowRef: null,
          kneeCam: null,
          kneeRef: null,
          shoulderCam: null,
          shoulderRef: null,
          guardCam: null,
          guardRef: null,
        });
      }

      const point = dataMap.get(frame.wallClockMs)!;
      point.extCam = frame.leadExtension;
      point.elbowCam = frame.angles[leadElbowKey] ?? null;
      point.kneeCam = frame.angles[leadKneeKey] ?? null;
      point.shoulderCam = frame.angles[leadShoulderKey] ?? null;
      point.guardCam = frame.rearGuardDist;
    }

    // Add reference data (align by timestamp)
    for (const frame of refSeq) {
      if (typeof frame.wallClockMs !== "number") continue;
      const tMs = frame.wallClockMs - startMs;
      const t = durationMs > 0 ? tMs / durationMs : 0;

      // Find closest camera frame or create new point
      let closestPoint: ChartDataPoint | null = null;
      let minDiff = Infinity;
      for (const point of dataMap.values()) {
        const diff = Math.abs(point.tMs - tMs);
        if (diff < minDiff && diff < 100) {
          // Within 100ms
          minDiff = diff;
          closestPoint = point;
        }
      }

      if (closestPoint) {
        closestPoint.extRef = frame.leadExtension;
        closestPoint.elbowRef = frame.angles[leadElbowKey] ?? null;
        closestPoint.kneeRef = frame.angles[leadKneeKey] ?? null;
        closestPoint.shoulderRef = frame.angles[leadShoulderKey] ?? null;
        closestPoint.guardRef = frame.rearGuardDist;
      } else {
        // Create new point for reference
        dataMap.set(frame.wallClockMs, {
          t: useNormalizedTime ? t : tMs,
          tMs,
          extCam: null,
          extRef: frame.leadExtension,
          elbowCam: null,
          elbowRef: frame.angles[leadElbowKey] ?? null,
          kneeCam: null,
          kneeRef: frame.angles[leadKneeKey] ?? null,
          shoulderCam: null,
          shoulderRef: frame.angles[leadShoulderKey] ?? null,
          guardCam: null,
          guardRef: frame.rearGuardDist,
        });
      }
    }

    // Convert to array and sort by time
    const data = Array.from(dataMap.values()).sort((a, b) => a.tMs - b.tMs);
    return downsampleData(data, 120);
  }, [cameraSeq, refSeq, leadSide, activeWindowStartMs, activeWindowEndMs, useNormalizedTime]);

  if (chartData.length === 0) {
    return (
      <div className="rounded-md border bg-background/50 p-4 text-center text-sm text-muted-foreground">
        No chart data available
      </div>
    );
  }

  const isPunch = techniqueCategory === "punch";
  const isKick = techniqueCategory === "kick";
  const showElbow = isPunch || !techniqueCategory; // Default to showing elbow if no category
  const showKnee = isKick;
  const showShoulder = isKick; // Show shoulder angle for kicks

  // Prepare comparison data for bar charts
  const peakExtensionData = useMemo(() => {
    if (!comparison?.debug) return null;
    return [
      {
        name: "Peak Extension",
        "Your Performance": comparison.debug.cameraPeakExtension ?? 0,
        "Reference": comparison.debug.referencePeakExtension ?? 0,
      },
    ];
  }, [comparison]);

  const guardComparisonData = useMemo(() => {
    if (!comparison?.debug) return null;
    return [
      {
        name: "Average Guard Distance",
        "Your Performance": comparison.debug.guardCameraAvg ?? 0,
        "Reference": comparison.debug.guardRefAvg ?? 0,
      },
    ];
  }, [comparison]);

  const angleRangeData = useMemo(() => {
    if (!comparison?.debug) return null;
    const leadElbowKey = leadSide === "left" ? "left" : "right";
    const camElbow = comparison.debug.cameraElbow?.[leadElbowKey];
    const refElbow = comparison.debug.referenceElbow?.[leadElbowKey];
    
    if (!camElbow || !refElbow) return null;
    
    return [
      {
        name: "Min Angle",
        "Your Performance": camElbow.min,
        "Reference": refElbow.min,
      },
      {
        name: "Max Angle",
        "Your Performance": camElbow.max,
        "Reference": refElbow.max,
      },
    ];
  }, [comparison, leadSide]);

  // Prepare area chart data (cumulative extension)
  const areaChartData = useMemo(() => {
    if (chartData.length === 0) return [];
    let cumulative = 0;
    return chartData.map((point) => {
      if (point.extCam != null) cumulative += point.extCam;
      return {
        ...point,
        cumulativeExt: cumulative,
      };
    });
  }, [chartData]);

  // Prepare metrics comparison for radar chart
  const radarData = useMemo(() => {
    if (!comparison?.featureErrors || !comparison?.debug) return null;
    
    const maxExtension = Math.max(
      comparison.debug.cameraPeakExtension ?? 0,
      comparison.debug.referencePeakExtension ?? 0
    );
    const extensionScore = maxExtension > 0 
      ? ((comparison.debug.cameraPeakExtension ?? 0) / maxExtension) * 100 
      : 0;
    
    const maxGuard = Math.max(
      comparison.debug.guardCameraAvg ?? 0,
      comparison.debug.guardRefAvg ?? 0
    );
    const guardScore = maxGuard > 0
      ? ((comparison.debug.guardCameraAvg ?? 0) / maxGuard) * 100
      : 0;
    
    // Invert errors to scores (lower error = higher score)
    const extensionErrorScore = comparison.featureErrors.extensionMae != null
      ? Math.max(0, 100 - (comparison.featureErrors.extensionMae * 50))
      : 0;
    const guardErrorScore = comparison.featureErrors.guardMae != null
      ? Math.max(0, 100 - (comparison.featureErrors.guardMae * 20))
      : 0;
    const elbowErrorScore = comparison.featureErrors.leadElbowMaeDeg != null
      ? Math.max(0, 100 - (comparison.featureErrors.leadElbowMaeDeg * 2))
      : 0;
    
    return [
      {
        subject: "Extension",
        score: extensionScore,
        fullMark: 100,
      },
      {
        subject: "Extension Accuracy",
        score: extensionErrorScore,
        fullMark: 100,
      },
      {
        subject: "Guard",
        score: guardScore,
        fullMark: 100,
      },
      {
        subject: "Guard Accuracy",
        score: guardErrorScore,
        fullMark: 100,
      },
      {
        subject: "Angle Accuracy",
        score: elbowErrorScore,
        fullMark: 100,
      },
    ];
  }, [comparison]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-foreground">Motion Comparison</div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Normalized time (0..1)</span>
          <Switch checked={useNormalizedTime} onCheckedChange={setUseNormalizedTime} />
        </div>
      </div>

      {/* Metrics Comparison Section */}
      {comparison && (
        <div className="space-y-4">
          {/* Peak Extension Bar Chart */}
          {peakExtensionData && (
            <div className="rounded-md border bg-background/50 p-4">
              <div className="text-sm font-semibold text-foreground mb-2">Peak Extension Comparison</div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={peakExtensionData}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
                  <XAxis dataKey="name" stroke="currentColor" style={{ fontSize: "12px" }} />
                  <YAxis stroke="currentColor" style={{ fontSize: "12px" }} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: "hsl(var(--background))", 
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px"
                    }}
                  />
                  <Legend />
                  <Bar dataKey="Your Performance" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Reference" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Guard Distance Bar Chart */}
          {guardComparisonData && (
            <div className="rounded-md border bg-background/50 p-4">
              <div className="text-sm font-semibold text-foreground mb-2">Guard Distance Comparison</div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={guardComparisonData}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
                  <XAxis dataKey="name" stroke="currentColor" style={{ fontSize: "12px" }} />
                  <YAxis stroke="currentColor" style={{ fontSize: "12px" }} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: "hsl(var(--background))", 
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px"
                    }}
                  />
                  <Legend />
                  <Bar dataKey="Your Performance" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Reference" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Angle Range Comparison (for punches) */}
          {showElbow && angleRangeData && (
            <div className="rounded-md border bg-background/50 p-4">
              <div className="text-sm font-semibold text-foreground mb-2">Elbow Angle Range</div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={angleRangeData}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
                  <XAxis dataKey="name" stroke="currentColor" style={{ fontSize: "12px" }} />
                  <YAxis label={{ value: "Angle (deg)", angle: -90, position: "insideLeft" }} stroke="currentColor" style={{ fontSize: "12px" }} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: "hsl(var(--background))", 
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px"
                    }}
                  />
                  <Legend />
                  <Bar dataKey="Your Performance" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Reference" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Performance Radar Chart */}
          {radarData && (
            <div className="rounded-md border bg-background/50 p-4">
              <div className="text-sm font-semibold text-foreground mb-2">Performance Overview</div>
              <ResponsiveContainer width="100%" height={280}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="currentColor" strokeOpacity={0.3} />
                  <PolarAngleAxis 
                    dataKey="subject" 
                    tick={{ fill: "currentColor", fontSize: 11 }}
                  />
                  <PolarRadiusAxis 
                    angle={90} 
                    domain={[0, 100]}
                    tick={{ fill: "currentColor", fontSize: 10 }}
                  />
                  <Radar
                    name="Your Performance"
                    dataKey="score"
                    stroke="#3b82f6"
                    fill="#3b82f6"
                    fillOpacity={0.6}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: "hsl(var(--background))", 
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px"
                    }}
                  />
                  <Legend />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* Cumulative Extension Area Chart */}
      {areaChartData.length > 0 && (
        <div className="rounded-md border bg-background/50 p-4">
          <div className="text-sm font-semibold text-foreground mb-2">Cumulative Extension</div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={areaChartData}>
              <defs>
                <linearGradient id="colorExt" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
              <XAxis
                dataKey="t"
                type="number"
                domain={useNormalizedTime ? [0, 1] : ["dataMin", "dataMax"]}
                label={{ value: useNormalizedTime ? "Time (normalized)" : "Time (ms)", position: "insideBottom", offset: -5 }}
                stroke="currentColor"
                style={{ fontSize: "12px" }}
              />
              <YAxis 
                label={{ value: "Cumulative Extension", angle: -90, position: "insideLeft" }} 
                stroke="currentColor"
                style={{ fontSize: "12px" }}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: "hsl(var(--background))", 
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "6px"
                }}
              />
              <Area
                type="monotone"
                dataKey="cumulativeExt"
                stroke="#3b82f6"
                fillOpacity={1}
                fill="url(#colorExt)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Chart 1: Lead Extension */}
      <div className="rounded-md border bg-background/50 p-4">
        <div className="text-sm font-semibold text-foreground mb-2">
          {isKick ? "Leg Extension" : "Lead Extension"}
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
            <XAxis
              dataKey="t"
              type="number"
              domain={useNormalizedTime ? [0, 1] : ["dataMin", "dataMax"]}
              label={{ value: useNormalizedTime ? "Time (normalized)" : "Time (ms)", position: "insideBottom", offset: -5 }}
              stroke="currentColor"
              style={{ fontSize: "12px" }}
            />
            <YAxis 
              label={{ value: "Extension", angle: -90, position: "insideLeft" }} 
              stroke="currentColor"
              style={{ fontSize: "12px" }}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: "hsl(var(--background))", 
                border: "1px solid hsl(var(--border))",
                borderRadius: "6px"
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="extCam"
              stroke="#3b82f6"
              strokeWidth={2.5}
              dot={false}
              name="Your Performance"
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="extRef"
              stroke="#ef4444"
              strokeWidth={2.5}
              dot={false}
              name="Reference"
              strokeDasharray="5 5"
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Chart 2: Lead Elbow Angle (for punches) */}
      {showElbow && (
        <div className="rounded-md border bg-background/50 p-4">
          <div className="text-sm font-semibold text-foreground mb-2">Lead Elbow Angle</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
              <XAxis
                dataKey="t"
                type="number"
                domain={useNormalizedTime ? [0, 1] : ["dataMin", "dataMax"]}
                label={{ value: useNormalizedTime ? "Time (normalized)" : "Time (ms)", position: "insideBottom", offset: -5 }}
                stroke="currentColor"
                style={{ fontSize: "12px" }}
              />
              <YAxis 
                label={{ value: "Angle (deg)", angle: -90, position: "insideLeft" }} 
                stroke="currentColor"
                style={{ fontSize: "12px" }}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: "hsl(var(--background))", 
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "6px"
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="elbowCam"
                stroke="#3b82f6"
                strokeWidth={2.5}
                dot={false}
                name="Your Performance"
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="elbowRef"
                stroke="#ef4444"
                strokeWidth={2.5}
                dot={false}
                name="Reference"
                strokeDasharray="5 5"
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Chart 2b: Lead Knee Angle (for kicks) */}
      {showKnee && (
        <div className="rounded-md border bg-background/50 p-4">
          <div className="text-sm font-semibold text-foreground mb-2">Lead Knee Angle</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
              <XAxis
                dataKey="t"
                type="number"
                domain={useNormalizedTime ? [0, 1] : ["dataMin", "dataMax"]}
                label={{ value: useNormalizedTime ? "Time (normalized)" : "Time (ms)", position: "insideBottom", offset: -5 }}
                stroke="currentColor"
                style={{ fontSize: "12px" }}
              />
              <YAxis 
                label={{ value: "Angle (deg)", angle: -90, position: "insideLeft" }} 
                stroke="currentColor"
                style={{ fontSize: "12px" }}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: "hsl(var(--background))", 
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "6px"
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="kneeCam"
                stroke="#3b82f6"
                strokeWidth={2.5}
                dot={false}
                name="Your Performance"
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="kneeRef"
                stroke="#ef4444"
                strokeWidth={2.5}
                dot={false}
                name="Reference"
                strokeDasharray="5 5"
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Chart 2c: Lead Shoulder Angle (for kicks) */}
      {showShoulder && (
        <div className="rounded-md border bg-background/50 p-4">
          <div className="text-sm font-semibold text-foreground mb-2">Lead Shoulder Angle</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
              <XAxis
                dataKey="t"
                type="number"
                domain={useNormalizedTime ? [0, 1] : ["dataMin", "dataMax"]}
                label={{ value: useNormalizedTime ? "Time (normalized)" : "Time (ms)", position: "insideBottom", offset: -5 }}
                stroke="currentColor"
                style={{ fontSize: "12px" }}
              />
              <YAxis 
                label={{ value: "Angle (deg)", angle: -90, position: "insideLeft" }} 
                stroke="currentColor"
                style={{ fontSize: "12px" }}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: "hsl(var(--background))", 
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "6px"
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="shoulderCam"
                stroke="#3b82f6"
                strokeWidth={2.5}
                dot={false}
                name="Your Performance"
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="shoulderRef"
                stroke="#ef4444"
                strokeWidth={2.5}
                dot={false}
                name="Reference"
                strokeDasharray="5 5"
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Chart 3: Rear Guard */}
      <div className="rounded-md border bg-background/50 p-4">
        <div className="text-sm font-semibold text-foreground mb-2">Guard Distance</div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
            <XAxis
              dataKey="t"
              type="number"
              domain={useNormalizedTime ? [0, 1] : ["dataMin", "dataMax"]}
              label={{ value: useNormalizedTime ? "Time (normalized)" : "Time (ms)", position: "insideBottom", offset: -5 }}
              stroke="currentColor"
              style={{ fontSize: "12px" }}
            />
            <YAxis 
              label={{ value: "Distance", angle: -90, position: "insideLeft" }} 
              stroke="currentColor"
              style={{ fontSize: "12px" }}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: "hsl(var(--background))", 
                border: "1px solid hsl(var(--border))",
                borderRadius: "6px"
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="guardCam"
              stroke="#3b82f6"
              strokeWidth={2.5}
              dot={false}
              name="Your Performance"
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="guardRef"
              stroke="#ef4444"
              strokeWidth={2.5}
              dot={false}
              name="Reference"
              strokeDasharray="5 5"
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
