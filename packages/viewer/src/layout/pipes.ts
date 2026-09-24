import type { Vec3 } from "./types";

export interface RouteEnd {
  /** Room centre. */
  x: number;
  z: number;
  /** Roof of the room. */
  roofY: number;
  /** Height of the horizontal run in this floor's plenum. */
  runY: number;
}

export interface Shaft {
  x: number;
  z: number;
}

/**
 * Orthogonal route between two rooms. Cross-floor pipes rise from the caller's roof into its
 * plenum, run along z then x to their lane in a riser shaft, change level in the shaft, then run
 * along x then z to the callee and drop onto its roof. Same-floor pipes stay in the plenum.
 */
export function routePipe(a: RouteEnd, b: RouteEnd, shaft: Shaft | null): Vec3[] {
  const pts: Vec3[] = [{ x: a.x, y: a.roofY, z: a.z }];
  if (shaft === null) {
    pts.push(
      { x: a.x, y: a.runY, z: a.z },
      { x: b.x, y: a.runY, z: a.z },
      { x: b.x, y: a.runY, z: b.z },
    );
  } else {
    pts.push(
      { x: a.x, y: a.runY, z: a.z },
      { x: a.x, y: a.runY, z: shaft.z },
      { x: shaft.x, y: a.runY, z: shaft.z },
      { x: shaft.x, y: b.runY, z: shaft.z },
      { x: b.x, y: b.runY, z: shaft.z },
      { x: b.x, y: b.runY, z: b.z },
    );
  }
  pts.push({ x: b.x, y: b.roofY, z: b.z });
  return simplifyPolyline(pts);
}

/** Drops repeated points and points in the middle of a straight run. */
export function simplifyPolyline(points: readonly Vec3[], eps = 1e-6): Vec3[] {
  const out: Vec3[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && dist(last, p) < eps) continue;
    const prev = out[out.length - 2];
    if (prev && last && collinear(prev, last, p, eps)) out.pop();
    out.push(p);
  }
  return out;
}

/** Grid position of lane `i` of `n` inside a shaft, centred on the shaft. */
export function laneOffset(i: number, n: number, spacing: number): { dx: number; dz: number } {
  const k = Math.max(1, Math.ceil(Math.sqrt(n)));
  const col = i % k;
  const row = Math.floor(i / k);
  const rows = Math.ceil(n / k);
  return { dx: (col - (k - 1) / 2) * spacing, dz: (row - (rows - 1) / 2) * spacing };
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function collinear(a: Vec3, b: Vec3, c: Vec3, eps: number): boolean {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - b.x, vy = c.y - b.y, vz = c.z - b.z;
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  // Same direction only; a reversal is a real (if degenerate) corner.
  return Math.hypot(cx, cy, cz) < eps && ux * vx + uy * vy + uz * vz > 0;
}
