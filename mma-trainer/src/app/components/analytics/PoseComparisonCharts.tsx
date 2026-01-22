"use client";

import { useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Switch } from "@/components/ui/switch";

type ChartDataPoint = {
  t: number; // Normalized time (0..1) or milliseconds offset
  tMs: number; // Actual milliseconds
  extCam: number | null;
  extRef: number | null;
  elbowCam: number | null;
  elbowRef: number | null;
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
    };
    rearGuardDist: number | null;
  }>;
  refSeq: Array<{
    wallClockMs: number;
    leadExtension: number | null;
    angles: {
      leftElbow?: number;
      rightElbow?: number;
    };
    rearGuardDist: number | null;
  }>;
  leadSide: "left" | "right";
  activeWindowStartMs: number | null;
  activeWindowEndMs: number | null;
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
}: PoseComparisonChartsProps) {
  const [useNormalizedTime, setUseNormalizedTime] = useState(true);

  const chartData = useMemo(() => {
    if (cameraSeq.length === 0 && refSeq.length === 0) return [];

    const leadElbowKey = leadSide === "left" ? "leftElbow" : "rightElbow";
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
          guardCam: null,
          guardRef: null,
        });
      }

      const point = dataMap.get(frame.wallClockMs)!;
      point.extCam = frame.leadExtension;
      point.elbowCam = frame.angles[leadElbowKey];
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
        closestPoint.elbowRef = frame.angles[leadElbowKey];
        closestPoint.guardRef = frame.rearGuardDist;
      } else {
        // Create new point for reference
        dataMap.set(frame.wallClockMs, {
          t: useNormalizedTime ? t : tMs,
          tMs,
          extCam: null,
          extRef: frame.leadExtension,
          elbowCam: null,
          elbowRef: frame.angles[leadElbowKey],
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-foreground">Motion Comparison</div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Normalized time (0..1)</span>
          <Switch checked={useNormalizedTime} onCheckedChange={setUseNormalizedTime} />
        </div>
      </div>

      {/* Chart 1: Lead Extension */}
      <div className="rounded-md border bg-background/50 p-4">
        <div className="text-sm font-semibold text-foreground mb-2">Lead Extension</div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="t"
              type="number"
              domain={useNormalizedTime ? [0, 1] : ["dataMin", "dataMax"]}
              label={{ value: useNormalizedTime ? "Time (normalized)" : "Time (ms)", position: "insideBottom", offset: -5 }}
            />
            <YAxis label={{ value: "Extension", angle: -90, position: "insideLeft" }} />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="extCam"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              name="Camera"
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="extRef"
              stroke="#ef4444"
              strokeWidth={2}
              dot={false}
              name="Reference"
              strokeDasharray="5 5"
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Chart 2: Lead Elbow Angle */}
      <div className="rounded-md border bg-background/50 p-4">
        <div className="text-sm font-semibold text-foreground mb-2">Lead Elbow Angle (deg)</div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="t"
              type="number"
              domain={useNormalizedTime ? [0, 1] : ["dataMin", "dataMax"]}
              label={{ value: useNormalizedTime ? "Time (normalized)" : "Time (ms)", position: "insideBottom", offset: -5 }}
            />
            <YAxis label={{ value: "Angle (deg)", angle: -90, position: "insideLeft" }} />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="elbowCam"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              name="Camera"
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="elbowRef"
              stroke="#ef4444"
              strokeWidth={2}
              dot={false}
              name="Reference"
              strokeDasharray="5 5"
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Chart 3: Rear Guard */}
      <div className="rounded-md border bg-background/50 p-4">
        <div className="text-sm font-semibold text-foreground mb-2">Rear Guard Distance</div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="t"
              type="number"
              domain={useNormalizedTime ? [0, 1] : ["dataMin", "dataMax"]}
              label={{ value: useNormalizedTime ? "Time (normalized)" : "Time (ms)", position: "insideBottom", offset: -5 }}
            />
            <YAxis label={{ value: "Distance", angle: -90, position: "insideLeft" }} />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="guardCam"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              name="Camera"
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="guardRef"
              stroke="#ef4444"
              strokeWidth={2}
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
