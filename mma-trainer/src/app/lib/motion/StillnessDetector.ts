import type { PoseFrame } from "@/app/components/pose/PoseCameraOverlay";

/**
 * Utility function to normalize landmark points to body-relative coordinates.
 * This is a simplified version that StillnessDetector needs.
 */
function normalizeLandmarkPoints(
  landmarks: any,
  opts?: {
    mirrorX?: boolean;
  }
): ((i: number) => { x: number; y: number; z: number } | null) {
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
  const ls0 = { x: (lShoulder.x - hipCenter.x) * invScale, y: (lShoulder.y - hipCenter.y) * invScale };
  const rs0 = { x: (rShoulder.x - hipCenter.x) * invScale, y: (rShoulder.y - hipCenter.y) * invScale };
  const dx = rs0.x - ls0.x;
  const dy = rs0.y - ls0.y;
  const rot = -Math.atan2(dy, dx);
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

function dist3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = values.reduce((acc, v) => acc + v, 0);
  return s / values.length;
}

/**
 * Robust stillness detector with noise floor calibration and hysteresis.
 * Uses stable landmarks (mid-hips, mid-shoulders, nose) to avoid jitter.
 */
export class StillnessDetector {
  private smoothedMotion: number = 0;
  private lastUpdateMs: number | null = null;
  private noiseFloor: number = 0;
  private stillnessStartMs: number | null = null;
  private currentState: "moving" | "still" = "moving";
  private readonly holdMs: number;
  private readonly emaAlpha: number;
  private readonly debounceMs: number;
  private readonly BASE_STILL_THRESH: number = 0.1; // Base threshold (units/sec)
  
  // Dynamic thresholds (computed from noise floor)
  private stillThresh: number = this.BASE_STILL_THRESH;
  private moveThresh: number = this.BASE_STILL_THRESH * 1.6;
  
  // Calibration state
  private calibrationStartMs: number | null = null;
  private calibrationMotions: number[] = [];
  private readonly CALIBRATION_DURATION_MS = 1000; // 1.0s calibration period
  private isCalibrating: boolean = false;

  private recentFrames: PoseFrame[] = [];
  private movingSinceMs: number | null = null; // Track when motion went above moveThresh (for debounce)

  constructor(opts: {
    holdMs: number; // Required continuous stillness duration (ms)
    emaAlpha?: number; // EMA smoothing factor (0-1, higher = faster response)
    debounceMs?: number; // Debounce time before resetting progress (ms)
  }) {
    this.holdMs = opts.holdMs;
    this.emaAlpha = opts.emaAlpha ?? 0.15; // Default: moderate smoothing
    this.debounceMs = opts.debounceMs ?? 250; // Default: 250ms debounce
  }

  /**
   * Start calibration when entering stillness_hold phase.
   * Calibrates noise floor over 1.0s while user is "supposed to be still".
   */
  startCalibration(): void {
    this.isCalibrating = true;
    this.calibrationStartMs = Date.now();
    this.calibrationMotions = [];
    this.stillnessStartMs = null; // Don't start countdown during calibration
  }

  /**
   * Compute motion using stable landmarks: mid-hips, mid-shoulders, and nose.
   * Returns mean distance of these landmarks from previous frame (normalized) / dt.
   */
  private computeMotionRaw(prev: PoseFrame, cur: PoseFrame): number {
    if (!prev.landmarks || !cur.landmarks) return 0;
    
    const dt = ((cur.wallClockMs ?? 0) - (prev.wallClockMs ?? 0)) / 1000;
    if (!Number.isFinite(dt) || dt <= 0 || dt > 1) return 0;

    const prevGet = normalizeLandmarkPoints(prev.landmarks);
    const curGet = normalizeLandmarkPoints(cur.landmarks);
    
    // Stable landmarks: mid-hips, mid-shoulders, nose
    const lHip = prevGet(23);
    const rHip = prevGet(24);
    const lShoulder = prevGet(11);
    const rShoulder = prevGet(12);
    const nose = prevGet(0); // MediaPipe nose landmark
    
    const lHipCur = curGet(23);
    const rHipCur = curGet(24);
    const lShoulderCur = curGet(11);
    const rShoulderCur = curGet(12);
    const noseCur = curGet(0);
    
    // Compute mid-points
    const midHipPrev = lHip && rHip ? {
      x: (lHip.x + rHip.x) / 2,
      y: (lHip.y + rHip.y) / 2,
      z: (lHip.z + rHip.z) / 2,
    } : null;
    
    const midHipCur = lHipCur && rHipCur ? {
      x: (lHipCur.x + rHipCur.x) / 2,
      y: (lHipCur.y + rHipCur.y) / 2,
      z: (lHipCur.z + rHipCur.z) / 2,
    } : null;
    
    const midShoulderPrev = lShoulder && rShoulder ? {
      x: (lShoulder.x + rShoulder.x) / 2,
      y: (lShoulder.y + rShoulder.y) / 2,
      z: (lShoulder.z + rShoulder.z) / 2,
    } : null;
    
    const midShoulderCur = lShoulderCur && rShoulderCur ? {
      x: (lShoulderCur.x + rShoulderCur.x) / 2,
      y: (lShoulderCur.y + rShoulderCur.y) / 2,
      z: (lShoulderCur.z + rShoulderCur.z) / 2,
    } : null;
    
    // Compute distances for each stable landmark
    const distances: number[] = [];
    if (midHipPrev && midHipCur) {
      distances.push(dist3(midHipPrev, midHipCur) / dt);
    }
    if (midShoulderPrev && midShoulderCur) {
      distances.push(dist3(midShoulderPrev, midShoulderCur) / dt);
    }
    if (nose && noseCur) {
      distances.push(dist3(nose, noseCur) / dt);
    }
    
    // Return mean distance (motion raw)
    return distances.length > 0 ? mean(distances) ?? 0 : 0;
  }

  /**
   * Update detector with a new frame.
   * Returns current state and progress toward stillness.
   */
  update(frame: PoseFrame): {
    state: "moving" | "still";
    stillnessProgress01: number; // 0..1 progress toward required stillness duration
    motion: number; // Current smoothed motion
    noiseFloor: number;
    isCalibrating: boolean;
    stillThresh: number;
    moveThresh: number;
  } {
    if (!frame.landmarks || typeof frame.wallClockMs !== "number") {
      return {
        state: this.currentState,
        stillnessProgress01: this.stillnessStartMs != null ? Math.min(1, (Date.now() - this.stillnessStartMs) / this.holdMs) : 0,
        motion: this.smoothedMotion,
        noiseFloor: this.noiseFloor,
        isCalibrating: this.isCalibrating,
        stillThresh: this.stillThresh,
        moveThresh: this.moveThresh,
      };
    }

    const now = frame.wallClockMs;
    
    // Get previous frame for motion computation
    if (this.recentFrames.length === 0) {
      this.recentFrames.push(frame);
      return {
        state: this.currentState,
        stillnessProgress01: 0,
        motion: 0,
        noiseFloor: this.noiseFloor,
        isCalibrating: this.isCalibrating,
        stillThresh: this.stillThresh,
        moveThresh: this.moveThresh,
      };
    }
    
    const prev = this.recentFrames[this.recentFrames.length - 1];
    this.recentFrames.push(frame);
    const cutoff = now - 500; // Keep last 500ms
    this.recentFrames = this.recentFrames.filter((f) => (f.wallClockMs ?? 0) >= cutoff);

    // Compute raw motion from stable landmarks
    const motionRaw = this.computeMotionRaw(prev, frame);

    // Update smoothed motion with EMA
    if (this.lastUpdateMs == null) {
      this.smoothedMotion = motionRaw;
      this.lastUpdateMs = now;
    } else {
      const dt = now - this.lastUpdateMs;
      if (dt > 0 && dt < 1000) {
        // Apply EMA smoothing
        this.smoothedMotion = this.emaAlpha * motionRaw + (1 - this.emaAlpha) * this.smoothedMotion;
      } else {
        // Reset on large gaps
        this.smoothedMotion = motionRaw;
      }
      this.lastUpdateMs = now;
    }

    // Handle calibration phase
    if (this.isCalibrating && this.calibrationStartMs != null) {
      this.calibrationMotions.push(this.smoothedMotion);
      const calibrationElapsed = now - this.calibrationStartMs;
      
      if (calibrationElapsed >= this.CALIBRATION_DURATION_MS) {
        // Calibration complete: compute noise floor as median
        if (this.calibrationMotions.length > 0) {
          const sorted = [...this.calibrationMotions].sort((a, b) => a - b);
          const medianIdx = Math.floor(sorted.length / 2);
          this.noiseFloor = sorted[medianIdx] ?? this.BASE_STILL_THRESH;
          
          // Compute dynamic thresholds
          this.stillThresh = Math.max(this.BASE_STILL_THRESH, this.noiseFloor * 2.5);
          this.moveThresh = this.stillThresh * 1.6; // Hysteresis
        }
        
        this.isCalibrating = false;
        this.calibrationStartMs = null;
        this.calibrationMotions = [];
        this.stillnessStartMs = now; // Start countdown after calibration
      }
      
      return {
        state: "still", // During calibration, treat as still
        stillnessProgress01: 0,
        motion: this.smoothedMotion,
        noiseFloor: this.noiseFloor,
        isCalibrating: true,
        stillThresh: this.stillThresh,
        moveThresh: this.moveThresh,
      };
    }

    // State machine with hysteresis and debounce
    // Progress increases while motionSmooth <= stillThresh continuously
    // If motionSmooth >= moveThresh continuously for > debounceMs, reset progress
    
    if (this.smoothedMotion <= this.stillThresh) {
      // Motion is below still threshold: progress can increase
      this.movingSinceMs = null; // Clear move tracking
      
      if (this.currentState === "moving") {
        // Transition from moving to still
        this.currentState = "still";
        if (this.stillnessStartMs == null) {
          this.stillnessStartMs = now;
        }
      } else {
        // Already in still state: continue countdown (progress increases)
        if (this.stillnessStartMs == null) {
          this.stillnessStartMs = now;
        }
      }
    } else if (this.smoothedMotion >= this.moveThresh) {
      // Motion is above move threshold: check if we should reset progress
      if (this.movingSinceMs == null) {
        // Start tracking when motion went above threshold
        this.movingSinceMs = now;
      } else {
        // Check if motion has been above threshold continuously for debounceMs
        const timeAboveThresh = now - this.movingSinceMs;
        if (timeAboveThresh >= this.debounceMs) {
          // Motion has been above threshold for debounceMs: reset progress
          this.currentState = "moving";
          this.stillnessStartMs = null; // Reset progress to 0
          this.movingSinceMs = null;
        }
      }
    } else {
      // Motion is between thresholds (hysteresis zone): maintain current state
      // Minor spikes that don't cross moveThresh won't reset countdown
      // If we were tracking movement, clear it (spike didn't last)
      if (this.movingSinceMs != null && this.smoothedMotion < this.moveThresh) {
        this.movingSinceMs = null; // Spike didn't last, don't reset
      }
    }

    // Compute stillness progress (0..1)
    let stillnessProgress01 = 0;
    if (this.currentState === "still" && this.stillnessStartMs != null && !this.isCalibrating) {
      const elapsed = now - this.stillnessStartMs;
      stillnessProgress01 = Math.min(1, elapsed / this.holdMs);
    }

    return {
      state: this.currentState,
      stillnessProgress01,
      motion: this.smoothedMotion,
      noiseFloor: this.noiseFloor,
      isCalibrating: this.isCalibrating,
      stillThresh: this.stillThresh,
      moveThresh: this.moveThresh,
    };
  }

  /**
   * Reset detector state (call when starting new attempt).
   */
  reset(): void {
    this.smoothedMotion = 0;
    this.lastUpdateMs = null;
    this.stillnessStartMs = null;
    this.currentState = "moving";
    this.recentFrames = [];
    this.movingSinceMs = null;
    this.isCalibrating = false;
    this.calibrationStartMs = null;
    this.calibrationMotions = [];
    // Reset thresholds to defaults
    this.stillThresh = this.BASE_STILL_THRESH;
    this.moveThresh = this.BASE_STILL_THRESH * 1.6;
    this.noiseFloor = 0;
  }
}
