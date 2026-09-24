import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from "three";

// Trackpad-first camera: two-finger scroll orbits, pinch zooms toward the cursor, shift + scroll
// pans. Events move a goal state; `update(dt)` eases the rendered state towards it (damping).
// Directions follow "grab" semantics with macOS natural scrolling: the scene moves with the fingers.

export interface CameraState {
  target: Vector3;
  yaw: number;
  pitch: number;
  distance: number;
}

export interface ControllerOptions {
  minDistance: number;
  maxDistance: number;
  /** Radians above the horizon. */
  minPitch: number;
  maxPitch: number;
  /** Radians per pixel of scroll. */
  rotateSpeed: number;
  /** Natural-log change in distance per pixel of pinch. */
  zoomSpeed: number;
  /** Fraction of the distance per pixel of scroll. */
  panSpeed: number;
  /** Radians per pixel of pointer drag (mouse fallback). */
  dragRotateSpeed: number;
  /** Damping time constant in seconds: how quickly the camera catches up with the goal. */
  damping: number;
}

export const DEFAULT_CONTROLLER_OPTIONS: Readonly<ControllerOptions> = {
  minDistance: 2,
  maxDistance: 2000,
  minPitch: 0.03,
  maxPitch: 1.5,
  rotateSpeed: 0.004,
  zoomSpeed: 0.01,
  panSpeed: 0.0012,
  dragRotateSpeed: 0.008,
  damping: 0.09,
};

/** The element the controller listens on. Structural, so tests can pass a plain EventTarget. */
export interface ControlSurface {
  addEventListener(type: string, listener: (e: Event) => void, options?: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: (e: Event) => void, options?: EventListenerOptions): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  setPointerCapture?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
}

/** Finds the world point under a cursor (e.g. by raycasting the scene); null if nothing is hit. */
export type PickFn = (ndc: Vector2, camera: PerspectiveCamera) => Vector3 | null;

const LINE_HEIGHT = 16;
/** Pinch deltas beyond this (e.g. ctrl + mouse wheel notches) are capped. */
const MAX_ZOOM_DELTA = 60;

interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey?: boolean;
  clientX: number;
  clientY: number;
}

interface GestureLike {
  scale: number;
  rotation: number;
  clientX: number;
  clientY: number;
}

export function copyState(s: CameraState): CameraState {
  return { target: s.target.clone(), yaw: s.yaw, pitch: s.pitch, distance: s.distance };
}

/** Unit vector from the target towards the camera. */
export function offsetDirection(yaw: number, pitch: number, out = new Vector3()): Vector3 {
  return out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
}

export class CameraController {
  readonly options: ControllerOptions;
  readonly goal: CameraState;
  readonly current: CameraState;
  pick: PickFn | null = null;
  private gestureActive = false;
  private lastGestureScale = 1;
  private lastGestureRotation = 0;
  private drag: { id: number; x: number; y: number; pan: boolean } | null = null;
  private dragMoved = false;
  private needsSync = true;
  private readonly raycaster = new Raycaster();
  private readonly listeners: [string, (e: Event) => void][];

  constructor(
    readonly camera: PerspectiveCamera,
    private readonly surface: ControlSurface,
    options: Partial<ControllerOptions> = {},
  ) {
    this.options = { ...DEFAULT_CONTROLLER_OPTIONS, ...options };
    this.goal = { target: new Vector3(), yaw: -0.5, pitch: 0.4, distance: 30 };
    this.current = copyState(this.goal);
    this.listeners = [
      ["wheel", (e) => this.onWheel(e)],
      ["gesturestart", (e) => this.onGestureStart(e)],
      ["gesturechange", (e) => this.onGestureChange(e)],
      ["gestureend", (e) => this.onGestureEnd(e)],
      ["pointerdown", (e) => this.onPointerDown(e as PointerEvent)],
      ["pointermove", (e) => this.onPointerMove(e as PointerEvent)],
      ["pointerup", (e) => this.onPointerUp(e as PointerEvent)],
      ["pointercancel", (e) => this.onPointerUp(e as PointerEvent)],
      ["contextmenu", (e) => e.preventDefault()],
    ];
    // Non-passive, so preventDefault() stops the page from scrolling or zooming.
    for (const [type, fn] of this.listeners) surface.addEventListener(type, fn, { passive: false });
    this.applyToCamera();
  }

  dispose() {
    for (const [type, fn] of this.listeners) this.surface.removeEventListener(type, fn);
  }

  /** True while a pointer drag is orbiting or panning; used to tell drags from clicks. */
  get dragging(): boolean {
    return this.drag !== null;
  }

  // ---- Input ---------------------------------------------------------------------------------

  private onWheel(e: Event) {
    e.preventDefault();
    const w = e as unknown as WheelLike;
    const unit = w.deltaMode === 1 ? LINE_HEIGHT : w.deltaMode === 2 ? this.surface.getBoundingClientRect().height || 800 : 1;
    const dx = w.deltaX * unit;
    const dy = w.deltaY * unit;
    if (w.ctrlKey) {
      // Trackpad pinch arrives as ctrl + wheel. In Safari the gesture events drive zoom instead.
      if (this.gestureActive) return;
      const capped = Math.max(-MAX_ZOOM_DELTA, Math.min(MAX_ZOOM_DELTA, dy));
      this.zoomAt(w.clientX, w.clientY, Math.exp(capped * this.options.zoomSpeed));
    } else if (w.shiftKey) {
      this.pan(dx, dy);
    } else {
      this.orbit(dx * this.options.rotateSpeed, -dy * this.options.rotateSpeed);
    }
  }

  private onGestureStart(e: Event) {
    e.preventDefault();
    this.gestureActive = true;
    this.lastGestureScale = 1;
    this.lastGestureRotation = 0;
  }

  /** Safari only: pinch scale zooms, and two-finger rotation adds yaw. */
  private onGestureChange(e: Event) {
    e.preventDefault();
    const g = e as unknown as GestureLike;
    if (g.scale > 0 && this.lastGestureScale > 0) {
      this.zoomAt(g.clientX, g.clientY, this.lastGestureScale / g.scale);
    }
    this.orbit(((g.rotation - this.lastGestureRotation) * Math.PI) / 180, 0);
    this.lastGestureScale = g.scale;
    this.lastGestureRotation = g.rotation;
  }

  private onGestureEnd(e: Event) {
    e.preventDefault();
    this.gestureActive = false;
  }

  private onPointerDown(e: PointerEvent) {
    if (e.pointerType === "touch") return;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, pan: e.button === 2 || e.button === 1 || e.shiftKey };
    this.dragMoved = false;
  }

  private onPointerMove(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!this.dragMoved) {
      if (Math.hypot(dx, dy) < 4) return;
      this.dragMoved = true;
      this.surface.setPointerCapture?.(e.pointerId);
    }
    d.x = e.clientX;
    d.y = e.clientY;
    if (d.pan) this.pan(-dx, -dy);
    else this.orbit(-dx * this.options.dragRotateSpeed, dy * this.options.dragRotateSpeed);
  }

  private onPointerUp(e: PointerEvent) {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    if (this.dragMoved) this.surface.releasePointerCapture?.(e.pointerId);
    this.drag = null;
  }

  /** True if the last pointer press turned into a drag (so the release isn't a click). */
  get lastPressWasDrag(): boolean {
    return this.dragMoved;
  }

  // ---- Camera moves (all act on the goal) ----------------------------------------------------

  orbit(dYaw: number, dPitch: number) {
    this.goal.yaw += dYaw;
    this.goal.pitch = clamp(this.goal.pitch + dPitch, this.options.minPitch, this.options.maxPitch);
  }

  /** Moves the target in the screen plane; scroll deltas in pixels. */
  pan(dx: number, dy: number) {
    const s = this.goal.distance * this.options.panSpeed;
    const { right, up } = this.basis(this.goal);
    this.goal.target.addScaledVector(right, dx * s).addScaledVector(up, -dy * s);
  }

  /**
   * Scales the distance by `factor` (< 1 zooms in) about the point under the cursor, so that
   * point stays put on screen.
   */
  zoomAt(clientX: number, clientY: number, factor: number) {
    const d0 = this.goal.distance;
    const d1 = clamp(d0 * factor, this.options.minDistance, this.options.maxDistance);
    const f = d1 / d0;
    if (f === 1) return;
    const p = this.pointUnder(this.toNdc(clientX, clientY));
    this.goal.target.sub(p).multiplyScalar(f).add(p);
    this.goal.distance = d1;
  }

  /**
   * Frames an axis-aligned box so that every corner lands within `margin` of the viewport's
   * half-extent. Keeps the current viewing angle unless one is given.
   */
  frame(
    box: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } },
    opts: { immediate?: boolean; yaw?: number; pitch?: number; margin?: number } = {},
  ) {
    if (opts.yaw !== undefined) this.goal.yaw = opts.yaw;
    if (opts.pitch !== undefined) this.goal.pitch = clamp(opts.pitch, this.options.minPitch, this.options.maxPitch);
    const margin = opts.margin ?? 0.82;
    const vfov = (this.camera.fov * Math.PI) / 180;
    const tv = Math.tan(vfov / 2) * margin;
    const th = Math.tan(vfov / 2) * Math.max(0.2, this.camera.aspect) * margin;
    const center = new Vector3((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2);
    const back = offsetDirection(this.goal.yaw, this.goal.pitch);
    const { right, up } = this.basis(this.goal);
    // Camera at distance d along `back`: a corner at (x, y, z) in camera axes needs d - z >= |x| / th and |y| / tv.
    let distance = this.options.minDistance;
    const corner = new Vector3();
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          corner.set(x, y, z).sub(center);
          const zb = corner.dot(back);
          distance = Math.max(distance, zb + Math.abs(corner.dot(right)) / th, zb + Math.abs(corner.dot(up)) / tv);
        }
      }
    }
    this.goal.target.copy(center);
    this.goal.distance = clamp(distance, this.options.minDistance, this.options.maxDistance);
    if (opts.immediate) this.jumpToGoal();
  }

  jumpToGoal() {
    Object.assign(this.current, copyState(this.goal));
    this.needsSync = true;
    this.applyToCamera();
  }

  /**
   * Eases the rendered state towards the goal. Target and distance use the same weight, so a
   * zoom about a point stays a zoom about that point throughout. Returns true if the camera moved.
   */
  update(dt: number): boolean {
    const c = this.current;
    const g = this.goal;
    const eps = Math.max(1e-6, g.distance * 1e-5);
    const settled =
      c.target.distanceTo(g.target) < eps &&
      Math.abs(c.distance - g.distance) < eps &&
      Math.abs(c.yaw - g.yaw) < 1e-6 &&
      Math.abs(c.pitch - g.pitch) < 1e-6;
    if (settled) {
      if (c.target.distanceTo(g.target) > 0 || c.distance !== g.distance || c.yaw !== g.yaw || c.pitch !== g.pitch) {
        Object.assign(c, copyState(g));
        this.needsSync = true;
      }
      if (!this.needsSync) return false;
      this.applyToCamera();
      return true;
    }
    const a = dt <= 0 ? 0 : 1 - Math.exp(-dt / this.options.damping);
    c.target.lerp(g.target, a);
    c.distance += (g.distance - c.distance) * a;
    c.yaw += (g.yaw - c.yaw) * a;
    c.pitch += (g.pitch - c.pitch) * a;
    this.applyToCamera();
    return true;
  }

  /** Puts the three.js camera where the current state says. */
  applyToCamera() {
    const c = this.current;
    const cam = this.camera;
    cam.position.copy(offsetDirection(c.yaw, c.pitch).multiplyScalar(c.distance).add(c.target));
    cam.up.set(0, 1, 0);
    cam.lookAt(c.target);
    // Near plane scales with distance for depth precision at every zoom level.
    const near = clamp(c.distance / 200, 0.02, 20);
    const far = Math.max(1000, c.distance * 20);
    if (Math.abs(cam.near - near) > near * 0.05 || cam.far !== far) {
      cam.near = near;
      cam.far = far;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    this.needsSync = false;
  }

  // ---- Helpers ---------------------------------------------------------------------------------

  private toNdc(clientX: number, clientY: number): Vector2 {
    const r = this.surface.getBoundingClientRect();
    return new Vector2(((clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -((clientY - r.top) / Math.max(1, r.height)) * 2 + 1);
  }

  /** The world point under the cursor as currently rendered: a scene hit, else the target plane. */
  private pointUnder(ndc: Vector2): Vector3 {
    this.applyToCamera();
    const hit = this.pick?.(ndc, this.camera);
    if (hit) return hit;
    this.raycaster.setFromCamera(ndc, this.camera);
    const normal = offsetDirection(this.current.yaw, this.current.pitch);
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, this.current.target);
    return this.raycaster.ray.intersectPlane(plane, new Vector3()) ?? this.current.target.clone();
  }

  private basis(s: CameraState): { right: Vector3; up: Vector3 } {
    const back = offsetDirection(s.yaw, s.pitch);
    const right = new Vector3(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
    // Camera axes: right × up = back.
    const up = new Vector3().crossVectors(back, right);
    return { right, up };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
