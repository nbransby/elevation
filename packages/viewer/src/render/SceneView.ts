import {
  BoxGeometry,
  BufferGeometry,
  Color,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
  type TubeGeometry,
} from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { FloorLayout, FloorState, LayoutResult, PipeState, RoomState, SceneState } from "../layout";
import { createPipeMaterial, createSurfaceMaterial, type PipeMaterial, type SurfaceMaterial } from "./materials";
import type { Palette } from "./palette";
import { createPipeGeometry, pipeGeometryKey } from "./pipeGeometry";
import { floorLook, pipeLook, revealedOpacity, roomLook } from "./style";
import { approach, Tween, TRANSITION_MS } from "./tween";

const UNIT_BOX = new BoxGeometry(1, 1, 1);
const UNIT_EDGES = new EdgesGeometry(UNIT_BOX);
/** Opacity multiplier for everything unrelated to the hovered or selected room. */
const DIM = 0.18;
/** A floor label shows once a storey is at least this tall on screen. */
const FLOOR_LABEL_MIN_PX = 18;

const scratchColor = new Color();
const scratchVec = new Vector3();

function rgb(hex: number): [number, number, number] {
  scratchColor.setHex(hex);
  return [scratchColor.r, scratchColor.g, scratchColor.b];
}

// ---------------------------------------------------------------------------------------------
// Rooms. Tweened vector: centre x, bottom y, centre z, width, height, depth, fill rgb,
// fill opacity, hatch, edge rgb, edge opacity.
const enum R { X, Y, Z, W, H, D, FR, FG, FB, FO, HATCH, ER, EG, EB, EO, LEN }

class RoomView {
  readonly mesh: Mesh<BoxGeometry, SurfaceMaterial>;
  readonly edges: LineSegments<EdgesGeometry, LineBasicMaterial>;
  readonly label: CSS2DObject;
  private readonly labelName: HTMLSpanElement;
  private readonly labelSize: HTMLSpanElement;
  readonly tween: Tween;
  state: RoomState | null = null;
  removing = false;
  emph = 1;
  emphTarget = 1;
  focus = 0;
  focusTarget = 0;

  constructor(readonly id: string, initial: number[]) {
    this.mesh = new Mesh(UNIT_BOX, createSurfaceMaterial());
    this.mesh.userData.roomId = id;
    this.edges = new LineSegments(UNIT_EDGES, new LineBasicMaterial({ transparent: true }));
    const el = document.createElement("div");
    el.className = "room-label";
    this.labelName = el.appendChild(document.createElement("span"));
    this.labelSize = el.appendChild(document.createElement("span"));
    this.labelSize.className = "size";
    this.label = new CSS2DObject(el);
    this.label.center.set(0.5, 1);
    this.label.visible = false;
    this.tween = new Tween(initial);
  }

  setState(s: RoomState) {
    this.state = s;
    if (s.present && s.room) {
      this.labelName.textContent = s.room.name;
      this.labelSize.textContent = ` ${s.size}`;
    }
  }

  step(now: number, dt: number): boolean {
    const moved = this.tween.step(now);
    const e = approach(this.emph, this.emphTarget, dt);
    const f = approach(this.focus, this.focusTarget, dt);
    const changed = moved || e !== this.emph || f !== this.focus;
    this.emph = e;
    this.focus = f;
    return changed;
  }

  sync(palette: Palette) {
    const c = this.tween.cur;
    const w = Math.max(c[R.W]!, 1e-4);
    const d = Math.max(c[R.D]!, 1e-4);
    const h = c[R.H]!;
    this.mesh.position.set(c[R.X]!, c[R.Y]! + h / 2, c[R.Z]!);
    this.mesh.scale.set(w, h, d);
    this.edges.position.copy(this.mesh.position);
    this.edges.scale.copy(this.mesh.scale);
    this.label.position.set(c[R.X]!, c[R.Y]! + h, c[R.Z]!);

    const u = this.mesh.material.uniforms;
    const fillOpacity = c[R.FO]! * this.emph;
    u.uColor.value.setRGB(c[R.FR]!, c[R.FG]!, c[R.FB]!);
    u.uPaper.value.setHex(palette.paper);
    u.uOpacity.value = fillOpacity;
    u.uHatch.value = c[R.HATCH]!;
    this.mesh.material.depthWrite = fillOpacity > 0.9;

    const edge = this.edges.material;
    edge.color.setRGB(c[R.ER]!, c[R.EG]!, c[R.EB]!);
    if (this.focus > 0) edge.color.lerp(scratchColor.setHex(palette.highlight), this.focus);
    edge.opacity = Math.max(c[R.EO]! * this.emph, this.focus);

    const hasSize = c[R.W]! > 1e-3 && c[R.D]! > 1e-3;
    this.mesh.visible = hasSize && fillOpacity > 0.004;
    this.edges.visible = hasSize && edge.opacity > 0.004;
  }

  dispose() {
    this.mesh.material.dispose();
    this.edges.material.dispose();
    this.label.removeFromParent();
    this.mesh.removeFromParent();
    this.edges.removeFromParent();
  }
}

function roomVector(s: RoomState, palette: Palette): number[] {
  const look = roomLook(s, palette);
  const b = s.box;
  return [b.x, b.y, b.z, b.width, b.height, b.depth, ...rgb(look.fill), look.fillOpacity, look.hatch, ...rgb(look.edge), look.edgeOpacity];
}

/** Where a room grows from, or shrinks to: its own footprint centre, invisible. */
function collapsed(v: ArrayLike<number>): number[] {
  const out = Array.from(v);
  out[R.W] = 0;
  out[R.D] = 0;
  out[R.FO] = 0;
  out[R.EO] = 0;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Pipes. Tweened vector: rgb, opacity. Each pipe's geometry is fixed; a rerouted pipe is a new
// view that fades in while the old one fades out.
const enum P { R, G, B, O, LEN }

class PipeView {
  readonly mesh: Mesh<TubeGeometry, PipeMaterial>;
  readonly tween: Tween;
  state: PipeState | null = null;
  removing = false;
  emph = 1;
  emphTarget = 1;
  reveal = 0;
  revealTarget = 0;

  constructor(readonly id: string, readonly key: string, geometry: TubeGeometry, initial: number[]) {
    this.mesh = new Mesh(geometry, createPipeMaterial());
    this.mesh.renderOrder = 1;
    this.tween = new Tween(initial);
  }

  step(now: number, dt: number): boolean {
    const moved = this.tween.step(now);
    const e = approach(this.emph, this.emphTarget, dt);
    const r = approach(this.reveal, this.revealTarget, dt);
    const changed = moved || e !== this.emph || r !== this.reveal;
    this.emph = e;
    this.reveal = r;
    return changed;
  }

  sync() {
    const c = this.tween.cur;
    const u = this.mesh.material.uniforms;
    u.uColor.value.setRGB(c[P.R]!, c[P.G]!, c[P.B]!);
    const revealed = this.state && !this.removing ? revealedOpacity(this.state) : 0;
    const opacity = c[P.O]! * this.emph * (1 - this.reveal) + revealed * this.reveal;
    u.uOpacity.value = opacity;
    this.mesh.material.depthWrite = opacity > 0.9;
    this.mesh.visible = opacity > 0.004;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}

// ---------------------------------------------------------------------------------------------
// Floor slabs. Tweened vector: centre x, bottom y, centre z, width, height, depth, opacity, edge rgb.
const enum F { X, Y, Z, W, H, D, O, ER, EG, EB, LEN }

class FloorView {
  readonly slab: Mesh<BoxGeometry, SurfaceMaterial>;
  readonly edges: LineSegments<EdgesGeometry, LineBasicMaterial>;
  readonly label: CSS2DObject;
  readonly tween: Tween;
  layout: FloorLayout;
  state: FloorState | null = null;
  removing = false;
  emph = 1;
  emphTarget = 1;

  constructor(layout: FloorLayout, initial: number[]) {
    this.layout = layout;
    this.slab = new Mesh(UNIT_BOX, createSurfaceMaterial());
    this.edges = new LineSegments(UNIT_EDGES, new LineBasicMaterial({ transparent: true }));
    const el = document.createElement("div");
    el.className = "floor-label";
    this.label = new CSS2DObject(el);
    this.label.center.set(1, 0.5);
    this.setLayout(layout);
    this.tween = new Tween(initial);
  }

  setLayout(l: FloorLayout) {
    this.layout = l;
    const el = this.label.element;
    el.replaceChildren();
    const name = el.appendChild(document.createElement("div"));
    name.className = "name";
    name.textContent = l.kind === "module" ? `${l.name} ·module` : l.name;
    if (l.cycle) {
      const tag = name.appendChild(document.createElement("span"));
      tag.className = "cycle";
      tag.textContent = " ↻";
      tag.title = `In a dependency cycle with ${l.cycle.length - 1} other floor(s)`;
    }
    const path = el.appendChild(document.createElement("div"));
    path.className = "path";
    path.textContent = l.path;
  }

  step(now: number, dt: number): boolean {
    const moved = this.tween.step(now);
    const e = approach(this.emph, this.emphTarget, dt);
    const changed = moved || e !== this.emph;
    this.emph = e;
    return changed;
  }

  sync(palette: Palette, labelY: number) {
    const c = this.tween.cur;
    this.slab.position.set(c[F.X]!, c[F.Y]! + c[F.H]! / 2, c[F.Z]!);
    this.slab.scale.set(Math.max(c[F.W]!, 1e-4), c[F.H]!, Math.max(c[F.D]!, 1e-4));
    this.edges.position.copy(this.slab.position);
    this.edges.scale.copy(this.slab.scale);
    this.label.position.set(c[F.X]! - c[F.W]! / 2 - 0.3, c[F.Y]! + labelY, c[F.Z]! + c[F.D]! / 2);

    const opacity = c[F.O]! * (0.35 + 0.65 * this.emph);
    const u = this.slab.material.uniforms;
    u.uColor.value.setHex(palette.slab);
    u.uOpacity.value = opacity * 0.9;
    this.slab.material.depthWrite = false;
    this.edges.material.color.setRGB(c[F.ER]!, c[F.EG]!, c[F.EB]!);
    this.edges.material.opacity = opacity * 0.7;
    this.slab.visible = opacity > 0.004;
    this.edges.visible = opacity > 0.004;
    this.label.element.style.opacity = String(Math.min(1, opacity));
  }

  dispose() {
    this.slab.material.dispose();
    this.edges.material.dispose();
    this.label.removeFromParent();
    this.slab.removeFromParent();
    this.edges.removeFromParent();
  }
}

// ---------------------------------------------------------------------------------------------
// Building cores: an outline of the riser shaft strip. Tweened vector: centre x, bottom y,
// centre z, width, height, depth, opacity.
class CoreView {
  readonly lines: LineSegments<EdgesGeometry, LineBasicMaterial>;
  readonly tween: Tween;
  removing = false;

  constructor(initial: number[]) {
    this.lines = new LineSegments(UNIT_EDGES, new LineBasicMaterial({ transparent: true }));
    this.tween = new Tween(initial);
  }

  sync(palette: Palette) {
    const c = this.tween.cur;
    this.lines.position.set(c[0]!, c[1]! + c[4]! / 2, c[2]!);
    this.lines.scale.set(Math.max(c[3]!, 1e-4), Math.max(c[4]!, 1e-4), Math.max(c[5]!, 1e-4));
    this.lines.material.color.setHex(palette.core);
    this.lines.material.opacity = c[6]!;
    this.lines.visible = c[6]! > 0.004;
  }

  dispose() {
    this.lines.material.dispose();
    this.lines.removeFromParent();
  }
}

export interface SceneCounts {
  rooms: number;
  roomsVisible: number;
  pipes: number;
  pipesVisible: number;
  floors: number;
  labelsVisible: number;
}

/**
 * Owns the three.js objects for a scene and keeps them in step with the layout and the current
 * snapshot's state. Every change is a transition: rooms tween to their new size and colour, pipes
 * fade in or out, and objects that leave shrink or fade before they are removed.
 */
export class SceneView {
  readonly root = new Group();
  private readonly roomsGroup = new Group();
  private readonly pipesGroup = new Group();
  private readonly floorsGroup = new Group();
  private readonly labelsGroup = new Group();
  private readonly rooms = new Map<string, RoomView>();
  private readonly pipes = new Map<string, PipeView>();
  private readonly floors = new Map<string, FloorView>();
  private readonly cores = new Map<string, CoreView>();
  private ground: Group | null = null;
  private groundKey = "";
  private layout: LayoutResult | null = null;
  private state: SceneState | null = null;
  private focusIds: string[] = [];

  constructor(private palette: Palette) {
    this.root.add(this.floorsGroup, this.roomsGroup, this.pipesGroup, this.labelsGroup);
  }

  get currentLayout(): LayoutResult | null {
    return this.layout;
  }

  setPalette(palette: Palette, now: number) {
    this.palette = palette;
    this.groundKey = "";
    if (this.layout && this.state) this.apply(this.layout, this.state, now);
  }

  /** Moves everything towards `state` on `layout`. With `immediate`, jumps there. */
  apply(layout: LayoutResult, state: SceneState, now: number, immediate = false) {
    const dur = immediate ? 0 : TRANSITION_MS;
    const p = this.palette;
    this.layout = layout;
    this.state = state;
    this.updateGround(layout);

    const liveRooms = new Set<string>();
    for (const s of state.rooms) {
      liveRooms.add(s.id);
      const target = roomVector(s, p);
      let v = this.rooms.get(s.id);
      if (!v) {
        v = new RoomView(s.id, immediate ? target : collapsed(target));
        this.rooms.set(s.id, v);
        this.roomsGroup.add(v.mesh, v.edges);
        this.labelsGroup.add(v.label);
      }
      v.removing = false;
      v.setState(s);
      v.tween.retarget(target, now, dur);
    }
    for (const [id, v] of this.rooms) {
      if (liveRooms.has(id)) continue;
      v.removing = true;
      v.tween.retarget(collapsed(v.tween.cur), now, dur);
    }

    const radius = layout.params.pipeRadius;
    const livePipes = new Set<string>();
    for (const s of state.pipes) {
      const l = layout.pipeById.get(s.id)!;
      const key = `${s.id}#${pipeGeometryKey(l.points, radius)}`;
      livePipes.add(key);
      const look = pipeLook(s, p);
      const target = [...rgb(look.color), s.shown ? look.opacity : 0];
      let v = this.pipes.get(key);
      if (!v) {
        v = new PipeView(s.id, key, createPipeGeometry(l.points, radius), immediate ? target : [...target.slice(0, 3), 0]);
        this.pipes.set(key, v);
        this.pipesGroup.add(v.mesh);
      }
      v.removing = false;
      v.state = s;
      v.mesh.material.uniforms.uDash.value = look.dashed ? 1 : 0;
      v.tween.retarget(target, now, dur);
    }
    for (const [key, v] of this.pipes) {
      if (livePipes.has(key)) continue;
      v.removing = true;
      const c = v.tween.cur;
      v.tween.retarget([c[P.R]!, c[P.G]!, c[P.B]!, 0], now, dur);
    }

    const slab = layout.params.slabThickness;
    const liveFloors = new Set<string>();
    const floorStates = new Map(state.floors.map((f) => [f.id, f]));
    for (const l of layout.floors) {
      liveFloors.add(l.id);
      const s = floorStates.get(l.id) ?? null;
      const look = s ? floorLook(s, p) : { opacity: 0, edge: p.slabEdge };
      const target = [l.x + l.width / 2, l.y, l.z + l.depth / 2, l.width, slab, l.depth, look.opacity, ...rgb(look.edge)];
      let v = this.floors.get(l.id);
      if (!v) {
        const start = [...target];
        if (!immediate) start[F.O] = 0;
        v = new FloorView(l, start);
        this.floors.set(l.id, v);
        this.floorsGroup.add(v.slab, v.edges);
        this.labelsGroup.add(v.label);
      } else {
        v.setLayout(l);
      }
      v.removing = false;
      v.state = s;
      v.tween.retarget(target, now, dur);
    }
    for (const [id, v] of this.floors) {
      if (liveFloors.has(id)) continue;
      v.removing = true;
      const t = Array.from(v.tween.cur);
      t[F.O] = 0;
      v.tween.retarget(t, now, dur);
    }

    const liveCores = new Set<string>();
    for (const b of layout.buildings) {
      liveCores.add(b.id);
      const target = [b.core.x + b.core.width / 2, 0, -b.depth / 2, b.core.width, b.height, b.depth, 0.35];
      let v = this.cores.get(b.id);
      if (!v) {
        v = new CoreView(immediate ? target : [...target.slice(0, 6), 0]);
        this.cores.set(b.id, v);
        this.floorsGroup.add(v.lines);
      }
      v.removing = false;
      v.tween.retarget(target, now, dur);
    }
    for (const [id, v] of this.cores) {
      if (liveCores.has(id)) continue;
      v.removing = true;
      v.tween.retarget([...Array.from(v.tween.cur).slice(0, 6), 0], now, dur);
    }

    this.setFocus(this.focusIds);
    this.syncAll();
  }

  /**
   * Highlights the given rooms (hovered and/or selected), their pipes and the rooms at the other
   * end of those pipes, and dims everything else. Pipes of a focused room are revealed even when
   * the pipe mode hides them.
   */
  setFocus(ids: readonly (string | null)[]) {
    this.focusIds = ids.filter((x): x is string => x !== null && this.rooms.has(x));
    const focus = new Set(this.focusIds);
    const related = new Set(focus);
    for (const v of this.pipes.values()) {
      const s = v.state;
      if (!s || v.removing || !s.present) continue;
      if (focus.has(s.from)) related.add(s.to);
      if (focus.has(s.to)) related.add(s.from);
    }
    const any = focus.size > 0;
    for (const v of this.rooms.values()) {
      v.emphTarget = !any || related.has(v.id) ? 1 : DIM;
      v.focusTarget = focus.has(v.id) ? 1 : 0;
    }
    for (const v of this.pipes.values()) {
      const s = v.state;
      const touches = s !== null && (focus.has(s.from) || focus.has(s.to));
      v.emphTarget = !any || touches ? 1 : DIM;
      v.revealTarget = touches ? 1 : 0;
    }
    const floorsInFocus = new Set([...related].map((id) => this.rooms.get(id)?.state?.floorId));
    for (const v of this.floors.values()) v.emphTarget = !any || floorsInFocus.has(v.layout.id) ? 1 : DIM;
  }

  /** Advances transitions. Returns true if anything changed and the frame needs rendering. */
  update(now: number, dt: number): boolean {
    let changed = false;
    const p = this.palette;
    for (const [id, v] of this.rooms) {
      if (v.step(now, dt)) {
        v.sync(p);
        changed = true;
      }
      if (v.removing && !v.tween.animating) {
        v.dispose();
        this.rooms.delete(id);
        changed = true;
      }
    }
    for (const [key, v] of this.pipes) {
      if (v.step(now, dt)) {
        v.sync();
        changed = true;
      }
      if (v.removing && !v.tween.animating) {
        v.dispose();
        this.pipes.delete(key);
        changed = true;
      }
    }
    const labelY = this.floorLabelY();
    for (const [id, v] of this.floors) {
      if (v.step(now, dt)) {
        v.sync(p, labelY);
        changed = true;
      }
      if (v.removing && !v.tween.animating) {
        v.dispose();
        this.floors.delete(id);
        changed = true;
      }
    }
    for (const [id, v] of this.cores) {
      if (v.tween.step(now)) {
        v.sync(p);
        changed = true;
      }
      if (v.removing && !v.tween.animating) {
        v.dispose();
        this.cores.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  /** Shows room labels whose room is at least `thresholdPx` across on screen. */
  updateLabels(camera: PerspectiveCamera, viewportHeight: number, thresholdPx: number) {
    const focal = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
    for (const v of this.rooms.values()) {
      const c = v.tween.cur;
      let show = false;
      if (!v.removing && v.state?.present && v.mesh.visible && v.emph > 0.6) {
        const dist = scratchVec.set(c[R.X]!, c[R.Y]! + c[R.H]!, c[R.Z]!).distanceTo(camera.position);
        const px = (Math.sqrt(c[R.W]! * c[R.D]!) * focal) / Math.max(dist, 1e-3);
        show = px >= thresholdPx || v.focus > 0.5;
      }
      v.label.visible = show;
    }
    const storey = this.layout?.params.floorHeight ?? 3;
    for (const v of this.floors.values()) {
      const c = v.tween.cur;
      let show = false;
      if (!v.removing && v.state?.present) {
        const dist = scratchVec.set(c[F.X]! - c[F.W]! / 2, c[F.Y]!, c[F.Z]! + c[F.D]! / 2).distanceTo(camera.position);
        show = (storey * focal) / Math.max(dist, 1e-3) >= FLOOR_LABEL_MIN_PX;
      }
      v.label.visible = show;
    }
  }

  /** Room meshes that can be hovered or clicked. */
  pickTargets(): Object3D[] {
    const out: Object3D[] = [];
    for (const v of this.rooms.values()) {
      if (!v.removing && v.state?.present && (v.mesh.visible || v.edges.visible)) out.push(v.mesh);
    }
    return out;
  }

  roomState(id: string): RoomState | undefined {
    return this.rooms.get(id)?.state ?? undefined;
  }

  counts(): SceneCounts {
    let roomsVisible = 0;
    let pipesVisible = 0;
    let labelsVisible = 0;
    for (const v of this.rooms.values()) {
      if (v.mesh.visible || v.edges.visible) roomsVisible++;
      if (v.label.visible) labelsVisible++;
    }
    for (const v of this.pipes.values()) if (v.mesh.visible) pipesVisible++;
    for (const v of this.floors.values()) if (v.label.visible) labelsVisible++;
    return {
      rooms: this.rooms.size,
      roomsVisible,
      pipes: this.pipes.size,
      pipesVisible,
      floors: this.floors.size,
      labelsVisible,
    };
  }

  private syncAll() {
    const p = this.palette;
    const labelY = this.floorLabelY();
    for (const v of this.rooms.values()) v.sync(p);
    for (const v of this.pipes.values()) v.sync();
    for (const v of this.floors.values()) v.sync(p, labelY);
    for (const v of this.cores.values()) v.sync(p);
  }

  private floorLabelY(): number {
    const params = this.layout?.params;
    return params ? params.slabThickness + (params.floorHeight * params.roomHeightRatio) / 2 : 0.8;
  }

  private updateGround(layout: LayoutResult) {
    const { min, max } = layout.bounds;
    // Big enough that its edge stays out of view at any sensible zoom.
    const margin = Math.max(100, 2 * Math.max(max.x - min.x, max.y - min.y));
    const width = max.x - min.x + 2 * margin;
    const depth = max.z - min.z + 2 * margin;
    const cx = (min.x + max.x) / 2;
    const cz = (min.z + max.z) / 2;
    const key = [width, depth, cx, cz].map((n) => n.toFixed(1)).join(",");
    if (key === this.groundKey) return;
    this.groundKey = key;
    if (this.ground) {
      this.ground.traverse((o) => {
        if (o instanceof Mesh || o instanceof LineSegments) {
          o.geometry.dispose();
          o.material.dispose();
        }
      });
      this.ground.removeFromParent();
    }
    const g = new Group();
    const plane = new Mesh(new PlaneGeometry(width, depth), new MeshBasicMaterial({ color: this.palette.ground }));
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(cx, -0.02, cz);
    const grid = rectGrid(width, depth, Math.max(2, 2 ** Math.ceil(Math.log2(Math.max(width, depth) / 600))), this.palette.grid);
    grid.position.set(cx, -0.01, cz);
    g.add(plane, grid);
    this.ground = g;
    this.root.add(g);
  }
}

/** Ground grid lines every `step` units over a width × depth rectangle centred on the origin. */
function rectGrid(width: number, depth: number, step: number, color: number): LineSegments {
  const pos: number[] = [];
  const hx = width / 2;
  const hz = depth / 2;
  for (let x = -Math.floor(hx / step) * step; x <= hx; x += step) pos.push(x, 0, -hz, x, 0, hz);
  for (let z = -Math.floor(hz / step) * step; z <= hz; z += step) pos.push(-hx, 0, z, hx, 0, z);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(pos, 3));
  return new LineSegments(geometry, new LineBasicMaterial({ color, transparent: true, opacity: 0.55 }));
}
