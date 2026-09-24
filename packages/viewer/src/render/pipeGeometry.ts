import { BufferAttribute, Curve, TubeGeometry, Vector3 } from "three";
import type { Vec3 } from "../layout";

/**
 * A path through explicit samples. TubeGeometry samples its path uniformly, which would cut the
 * corners of a polyline; with one tubular segment per sample the tube passes exactly through
 * every sample instead.
 */
class SampledPath extends Curve<Vector3> {
  constructor(
    private readonly samples: Vector3[],
    private readonly tangents: Vector3[],
  ) {
    super();
  }

  override getPoint(t: number, target = new Vector3()): Vector3 {
    const n = this.samples.length - 1;
    const f = Math.min(Math.max(t, 0), 1) * n;
    const i = Math.min(Math.floor(f), n - 1);
    return target.copy(this.samples[i]!).lerp(this.samples[i + 1]!, f - i);
  }

  override getPointAt(u: number, target?: Vector3): Vector3 {
    return this.getPoint(u, target);
  }

  override getTangent(t: number, target = new Vector3()): Vector3 {
    const n = this.samples.length - 1;
    return target.copy(this.tangents[Math.round(Math.min(Math.max(t, 0), 1) * n)]!);
  }

  override getTangentAt(u: number, target?: Vector3): Vector3 {
    return this.getTangent(u, target);
  }
}

/** Samples a polyline, rounding each corner with a short quadratic arc. */
export function samplePolyline(
  points: readonly Vec3[],
  cornerRadius: number,
  cornerSteps = 3,
): { samples: Vector3[]; tangents: Vector3[] } {
  const pts = points.map((p) => new Vector3(p.x, p.y, p.z));
  const samples: Vector3[] = [];
  const tangents: Vector3[] = [];
  const push = (p: Vector3, t: Vector3) => {
    const last = samples[samples.length - 1];
    if (last && last.distanceToSquared(p) < 1e-12) {
      tangents[tangents.length - 1] = t.clone();
      return;
    }
    samples.push(p);
    tangents.push(t.clone());
  };
  if (pts.length < 2) return { samples: pts, tangents: pts.map(() => new Vector3(0, 1, 0)) };

  push(pts[0]!, pts[1]!.clone().sub(pts[0]!).normalize());
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const d1 = p1.clone().sub(p0);
    const d2 = p2.clone().sub(p1);
    const r = Math.min(cornerRadius, d1.length() / 2, d2.length() / 2);
    d1.normalize();
    d2.normalize();
    const a = p1.clone().addScaledVector(d1, -r);
    const b = p1.clone().addScaledVector(d2, r);
    push(a, d1);
    for (let s = 1; s < cornerSteps; s++) {
      const t = s / cornerSteps;
      const q = a.clone().multiplyScalar((1 - t) * (1 - t))
        .addScaledVector(p1, 2 * (1 - t) * t)
        .addScaledVector(b, t * t);
      const tan = p1.clone().sub(a).multiplyScalar(2 * (1 - t)).addScaledVector(b.clone().sub(p1), 2 * t).normalize();
      push(q, tan);
    }
    push(b, d2);
  }
  const last = pts[pts.length - 1]!;
  push(last, last.clone().sub(pts[pts.length - 2]!).normalize());
  return { samples, tangents };
}

/** A tube along an orthogonal polyline, with an `aDist` attribute (distance along the pipe) for dashing. */
export function createPipeGeometry(points: readonly Vec3[], radius: number, radialSegments = 6): TubeGeometry {
  const { samples, tangents } = samplePolyline(points, radius * 3);
  const segments = Math.max(1, samples.length - 1);
  const geometry = new TubeGeometry(new SampledPath(samples, tangents), segments, radius, radialSegments, false);

  const cumulative = [0];
  for (let i = 1; i < samples.length; i++) cumulative.push(cumulative[i - 1]! + samples[i]!.distanceTo(samples[i - 1]!));
  const ring = radialSegments + 1;
  const dist = new Float32Array((segments + 1) * ring);
  for (let i = 0; i <= segments; i++) dist.fill(cumulative[Math.min(i, cumulative.length - 1)]!, i * ring, (i + 1) * ring);
  geometry.setAttribute("aDist", new BufferAttribute(dist, 1));
  return geometry;
}

/** Changes whenever the geometry would, so a rerouted pipe cross-fades instead of snapping. */
export function pipeGeometryKey(points: readonly Vec3[], radius: number): string {
  return `${radius}|${points.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`).join(";")}`;
}
