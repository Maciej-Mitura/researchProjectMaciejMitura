export type Vec3Like = { x: number; y: number; z: number };

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Angle at point b between segments (a-b) and (c-b), in degrees.
 *
 * - Uses full 3D vectors (x,y,z)
 * - Returns in (0, 180) to avoid exact 0/180 deg edge-cases that can
 *   destabilize rule thresholds (numerical clamp w/ epsilon).
 */
export function angleDeg3(a: Vec3Like, b: Vec3Like, c: Vec3Like): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v1z = a.z - b.z;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const v2z = c.z - b.z;

  const dot = v1x * v2x + v1y * v2y + v1z * v2z;
  const n1 = Math.sqrt(v1x * v1x + v1y * v1y + v1z * v1z);
  const n2 = Math.sqrt(v2x * v2x + v2y * v2y + v2z * v2z);
  if (!Number.isFinite(n1) || !Number.isFinite(n2) || n1 <= 1e-12 || n2 <= 1e-12) return NaN;

  const rawCos = dot / (n1 * n2);
  // Clamp away from exactly +/-1 to avoid returning exactly 0 or 180.
  const eps = 1e-6;
  const cos = clamp(rawCos, -1 + eps, 1 - eps);
  return (Math.acos(cos) * 180) / Math.PI;
}

