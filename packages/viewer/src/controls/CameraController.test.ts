import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { CameraController, DEFAULT_CONTROLLER_OPTIONS, offsetDirection, type ControlSurface } from "./CameraController";

// Synthetic events on a plain EventTarget: no DOM needed.

const WIDTH = 800;
const HEIGHT = 600;

class FakeSurface extends EventTarget implements ControlSurface {
  readonly registered: { type: string; passive: boolean | undefined }[] = [];
  override addEventListener(type: string, listener: (e: Event) => void, options?: AddEventListenerOptions) {
    this.registered.push({ type, passive: options?.passive });
    super.addEventListener(type, listener, options);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: WIDTH, height: HEIGHT };
  }
}

function setup() {
  const surface = new FakeSurface();
  const camera = new PerspectiveCamera(45, WIDTH / HEIGHT, 0.1, 1000);
  const controller = new CameraController(camera, surface);
  controller.goal.target.set(0, 0, 0);
  controller.goal.yaw = 0.3;
  controller.goal.pitch = 0.4;
  controller.goal.distance = 50;
  controller.jumpToGoal();
  return { surface, camera, controller };
}

function dispatch(target: EventTarget, type: string, props: Record<string, number | boolean>): Event {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, props);
  target.dispatchEvent(e);
  return e;
}

const wheel = (target: EventTarget, props: Partial<Record<"deltaX" | "deltaY" | "deltaMode" | "clientX" | "clientY", number> & Record<"ctrlKey" | "shiftKey", boolean>>) =>
  dispatch(target, "wheel", { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, shiftKey: false, clientX: WIDTH / 2, clientY: HEIGHT / 2, ...props });

/** Runs the damping until settled. */
function settle(c: CameraController) {
  for (let i = 0; i < 1000 && c.update(1 / 60); i++);
}

function toNdc(camera: PerspectiveCamera, p: Vector3) {
  const v = p.clone().project(camera);
  return { x: v.x, y: v.y };
}

describe("CameraController", () => {
  it("registers non-passive listeners and prevents default scrolling and zooming", () => {
    const { surface } = setup();
    const w = surface.registered.find((r) => r.type === "wheel");
    expect(w?.passive).toBe(false);
    expect(surface.registered.map((r) => r.type)).toEqual(expect.arrayContaining(["gesturestart", "gesturechange", "gestureend"]));
    expect(wheel(surface, { deltaY: 10 }).defaultPrevented).toBe(true);
    expect(wheel(surface, { deltaY: 10, ctrlKey: true }).defaultPrevented).toBe(true);
    expect(dispatch(surface, "gesturestart", { scale: 1, rotation: 0, clientX: 0, clientY: 0 }).defaultPrevented).toBe(true);
  });

  it("orbits with two-finger scroll: deltaX turns yaw, deltaY turns pitch", () => {
    const { surface, controller } = setup();
    const k = DEFAULT_CONTROLLER_OPTIONS.rotateSpeed;
    wheel(surface, { deltaX: 100 });
    expect(controller.goal.yaw).toBeCloseTo(0.3 + 100 * k);
    expect(controller.goal.pitch).toBeCloseTo(0.4);
    wheel(surface, { deltaY: 50 });
    expect(controller.goal.pitch).toBeCloseTo(0.4 - 50 * k);
    // Orbiting never moves the target or changes the distance.
    expect(controller.goal.target.toArray()).toEqual([0, 0, 0]);
    expect(controller.goal.distance).toBe(50);
  });

  it("clamps pitch", () => {
    const { surface, controller } = setup();
    wheel(surface, { deltaY: -100000 });
    expect(controller.goal.pitch).toBe(DEFAULT_CONTROLLER_OPTIONS.maxPitch);
    wheel(surface, { deltaY: 100000 });
    expect(controller.goal.pitch).toBe(DEFAULT_CONTROLLER_OPTIONS.minPitch);
  });

  it("normalises deltaMode: lines and pages become pixels", () => {
    const a = setup();
    const b = setup();
    const c = setup();
    wheel(a.surface, { deltaX: 48, deltaMode: 0 });
    wheel(b.surface, { deltaX: 3, deltaMode: 1 });
    wheel(c.surface, { deltaX: 0.08, deltaMode: 2 });
    expect(b.controller.goal.yaw).toBeCloseTo(a.controller.goal.yaw);
    expect(c.controller.goal.yaw).toBeCloseTo(0.3 + 0.08 * HEIGHT * DEFAULT_CONTROLLER_OPTIONS.rotateSpeed);
  });

  it("zooms with pinch (ctrl + wheel) toward the cursor, keeping the point under it fixed", () => {
    const { surface, camera, controller } = setup();
    const cursor = { clientX: 620, clientY: 180 };
    const ndc = { x: (cursor.clientX / WIDTH) * 2 - 1, y: -(cursor.clientY / HEIGHT) * 2 + 1 };
    // The point under the cursor on the plane through the target facing the camera.
    const normal = offsetDirection(0.3, 0.4);
    const ray = camera.position.clone();
    const dir = new Vector3(ndc.x, ndc.y, 0.5).unproject(camera).sub(camera.position).normalize();
    const t = -normal.dot(ray) / normal.dot(dir);
    const p = ray.addScaledVector(dir, t);

    wheel(surface, { deltaY: -40, ctrlKey: true, ...cursor });
    expect(controller.goal.distance).toBeCloseTo(50 * Math.exp(-40 * DEFAULT_CONTROLLER_OPTIONS.zoomSpeed));
    expect(controller.goal.yaw).toBe(0.3);

    settle(controller);
    const after = toNdc(camera, p);
    expect(after.x).toBeCloseTo(ndc.x, 4);
    expect(after.y).toBeCloseTo(ndc.y, 4);
    expect(camera.position.distanceTo(controller.current.target)).toBeCloseTo(controller.goal.distance);
  });

  it("keeps the point under the cursor fixed at every frame of the damped zoom", () => {
    const { surface, camera, controller } = setup();
    const p = new Vector3(3, 2, -1);
    controller.pick = () => p.clone();
    const before = toNdc(camera, p);
    wheel(surface, { deltaY: 30, ctrlKey: true, clientX: 500, clientY: 250 });
    for (let i = 0; i < 5; i++) {
      controller.update(1 / 60);
      const now = toNdc(camera, p);
      expect(now.x).toBeCloseTo(before.x, 4);
      expect(now.y).toBeCloseTo(before.y, 4);
    }
  });

  it("zooms at the centre without moving the view direction", () => {
    const { surface, controller } = setup();
    wheel(surface, { deltaY: 20, ctrlKey: true });
    expect(controller.goal.distance).toBeGreaterThan(50);
    expect(controller.goal.target.length()).toBeLessThan(1e-9);
  });

  it("caps a mouse-wheel-sized pinch delta and clamps the distance", () => {
    const { surface, controller } = setup();
    wheel(surface, { deltaY: 1000, ctrlKey: true });
    expect(controller.goal.distance).toBeCloseTo(50 * Math.exp(60 * DEFAULT_CONTROLLER_OPTIONS.zoomSpeed));
    for (let i = 0; i < 100; i++) wheel(surface, { deltaY: -1000, ctrlKey: true });
    expect(controller.goal.distance).toBe(DEFAULT_CONTROLLER_OPTIONS.minDistance);
  });

  it("pans with shift + scroll in the screen plane", () => {
    const { surface, camera, controller } = setup();
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    wheel(surface, { deltaX: 100, shiftKey: true });
    const moved = controller.goal.target.clone();
    expect(moved.length()).toBeCloseTo(100 * 50 * DEFAULT_CONTROLLER_OPTIONS.panSpeed);
    expect(moved.clone().normalize().dot(right)).toBeCloseTo(1);
    wheel(surface, { deltaY: 100, shiftKey: true });
    const moved2 = controller.goal.target.clone().sub(moved).normalize();
    expect(moved2.dot(up)).toBeCloseTo(-1);
    expect(controller.goal.yaw).toBe(0.3);
    expect(controller.goal.distance).toBe(50);
  });

  it("damps motion: the camera eases towards the goal and then settles", () => {
    const { surface, controller } = setup();
    wheel(surface, { deltaX: 200 });
    const goalYaw = controller.goal.yaw;
    expect(controller.current.yaw).toBe(0.3);
    expect(controller.update(1 / 60)).toBe(true);
    expect(controller.current.yaw).toBeGreaterThan(0.3);
    expect(controller.current.yaw).toBeLessThan(goalYaw);
    settle(controller);
    expect(controller.current.yaw).toBe(goalYaw);
    expect(controller.update(1 / 60)).toBe(false);
  });

  it("adds yaw from Safari's gesturechange rotation and zooms with its scale", () => {
    const { surface, controller } = setup();
    dispatch(surface, "gesturestart", { scale: 1, rotation: 0, clientX: 400, clientY: 300 });
    dispatch(surface, "gesturechange", { scale: 1, rotation: 10, clientX: 400, clientY: 300 });
    expect(controller.goal.yaw).toBeCloseTo(0.3 + (10 * Math.PI) / 180);
    dispatch(surface, "gesturechange", { scale: 2, rotation: 10, clientX: 400, clientY: 300 });
    expect(controller.goal.distance).toBeCloseTo(25);
    // While a gesture is active, ctrl + wheel is ignored so the zoom isn't applied twice.
    wheel(surface, { deltaY: -40, ctrlKey: true });
    expect(controller.goal.distance).toBeCloseTo(25);
    dispatch(surface, "gestureend", { scale: 2, rotation: 10, clientX: 400, clientY: 300 });
    wheel(surface, { deltaY: -40, ctrlKey: true });
    expect(controller.goal.distance).toBeLessThan(25);
  });

  it("frames a box and keeps it in view", () => {
    const { camera, controller } = setup();
    const box = { min: { x: -30, y: 0, z: -10 }, max: { x: 30, y: 20, z: 0 } };
    controller.frame(box, { immediate: true, margin: 0.8 });
    let extent = 0;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const p = toNdc(camera, new Vector3(x, y, z));
          expect(Math.abs(p.x)).toBeLessThanOrEqual(0.8 + 1e-9);
          expect(Math.abs(p.y)).toBeLessThanOrEqual(0.8 + 1e-9);
          extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y));
        }
      }
    }
    // Tight: some corner touches the margin.
    expect(extent).toBeCloseTo(0.8, 2);
  });
});
