import { Color, PerspectiveCamera, Raycaster, Scene, Vector2, WebGLRenderer } from "three";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { CameraController } from "./controls/CameraController";
import {
  DEFAULT_LAYOUT_PARAMS,
  DEFAULT_VIEW,
  deriveState,
  layoutScene,
  type LayoutParams,
  type LayoutResult,
  type SceneState,
  type ViewOptions,
} from "./layout";
import { findScenario, SCENARIOS, type Scenario } from "./mock";
import type { BuildingDiff } from "./model";
import { DARK_PALETTE, LIGHT_PALETTE, type Palette } from "./render/palette";
import { SceneView } from "./render/SceneView";
import { DevPanel, type DevSettings } from "./ui/devPanel";
import { h } from "./ui/dom";
import { DebugOverlay, legend, SourcePanel, Tooltip } from "./ui/panels";
import { Toolbar } from "./ui/toolbar";

/** The front elevation, turned a little to show the building's left side and floor labels. */
const DEFAULT_YAW = -0.42;
const DEFAULT_PITCH = 0.36;
const SPIN_SPEED = 0.35; // radians per second

export class App {
  private readonly renderer: WebGLRenderer;
  private readonly labelRenderer = new CSS2DRenderer();
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(40, 1, 0.1, 2000);
  private readonly controller: CameraController;
  private readonly view: SceneView;
  private readonly raycaster = new Raycaster();
  private readonly viewport: HTMLElement;
  private readonly toolbar: Toolbar;
  private readonly sourcePanel: SourcePanel;
  private readonly tooltip = new Tooltip();
  private readonly debug = new DebugOverlay();
  private readonly darkQuery = matchMedia("(prefers-color-scheme: dark)");

  private palette: Palette;
  private scenario!: Scenario;
  private diffs: BuildingDiff[] = [];
  private turn = 0;
  private layout!: LayoutResult;
  private state!: SceneState;
  private viewOptions: ViewOptions = { ...DEFAULT_VIEW, layers: { ...DEFAULT_VIEW.layers } };
  private params: LayoutParams = { ...DEFAULT_LAYOUT_PARAMS };
  private dev: DevSettings;

  private hoverId: string | null = null;
  private selectedId: string | null = null;
  private pointer = { x: 0, y: 0, inside: false };
  private needsPick = false;
  private dirty = true;
  private width = 1;
  private height = 1;
  private lastTick = performance.now();
  private layoutMs = 0;
  private stateMs = 0;
  private renderTimes: { at: number; ms: number }[] = [];
  private lastDebug = 0;

  constructor(root: HTMLElement) {
    this.palette = this.themePalette();
    this.dev = {
      pipeMode: this.viewOptions.pipeMode,
      floorHeight: this.params.floorHeight,
      roomGap: this.params.roomGap,
      buildingGap: this.params.buildingGap,
      riserCount: this.params.riserCount,
      labelThreshold: 48,
      continuous: false,
      spin: false,
    };

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.labelRenderer.domElement.className = "labels";
    this.viewport = h("div", { class: "viewport" }, this.renderer.domElement, this.labelRenderer.domElement);

    this.view = new SceneView(this.palette);
    this.scene.add(this.view.root);

    this.controller = new CameraController(this.camera, this.viewport);
    this.controller.pick = (ndc, camera) => {
      this.raycaster.setFromCamera(ndc, camera);
      return this.raycaster.intersectObjects(this.view.pickTargets(), false)[0]?.point ?? null;
    };

    const initial = this.initialScenario();
    this.toolbar = new Toolbar(
      SCENARIOS,
      { scenarioId: initial.id, turn: 0, turnCount: 1, side: this.viewOptions.side, layers: this.viewOptions.layers },
      {
        scenario: (id) => this.loadScenario(findScenario(id) ?? SCENARIOS[0]!),
        turn: (i) => this.setTurn(i),
        side: (side) => this.setView({ side }),
        layers: (layers) => this.setView({ layers }),
        frame: () => this.frameAll(),
      },
    );
    this.sourcePanel = new SourcePanel(() => this.select(null));
    const devPanel = new DevPanel(this.dev, (patch) => this.setDev(patch));

    root.append(
      this.viewport,
      this.toolbar.el,
      h("div", { class: "bottom-left" }, legend(), devPanel.el),
      this.debug.el,
      this.sourcePanel.el,
      this.tooltip.el,
    );

    this.bindEvents();
    this.applyPalette(this.palette);
    new ResizeObserver(() => this.resize()).observe(this.viewport);
    this.resize();

    // Read before loading, which rewrites the URL.
    const turnParam = Number(new URLSearchParams(location.search).get("turn"));
    this.loadScenario(initial, true);
    if (Number.isInteger(turnParam) && turnParam > 1) this.setTurn(turnParam - 1, true);
    requestAnimationFrame(this.tick);
  }

  // ---- Data --------------------------------------------------------------------------------

  /** `?scenario=<id>`, or a bare `#<id>` (the only deep link that reaches an embedded Artifact). */
  private initialScenario(): Scenario {
    return (
      findScenario(new URLSearchParams(location.search).get("scenario")) ??
      findScenario(location.hash.slice(1)) ??
      SCENARIOS[0]!
    );
  }

  private loadScenario(scenario: Scenario, immediate = false) {
    this.scenario = scenario;
    this.diffs = scenario.build();
    this.turn = 0;
    this.hoverId = null;
    this.select(null);
    this.relayout(immediate);
    this.controller.frame(this.framingBox(), { immediate, yaw: DEFAULT_YAW, pitch: DEFAULT_PITCH });
    try {
      const url = new URL(location.href);
      url.searchParams.set("scenario", scenario.id);
      url.searchParams.delete("turn");
      url.hash = "";
      history.replaceState(null, "", url);
    } catch {
      // Some embedding frames refuse history changes; the dropdown still shows the scenario.
    }
    this.updateToolbar();
  }

  private setTurn(index: number, immediate = false) {
    const next = Math.max(0, Math.min(this.diffs.length - 1, index));
    if (next === this.turn) return;
    this.turn = next;
    this.refresh(immediate);
    this.updateToolbar();
  }

  private setView(patch: Partial<ViewOptions>) {
    this.viewOptions = { ...this.viewOptions, ...patch };
    this.refresh();
    this.updateToolbar();
  }

  private setDev(patch: Partial<DevSettings>) {
    this.dev = { ...this.dev, ...patch };
    const layoutKeys = ["floorHeight", "roomGap", "buildingGap", "riserCount"] as const;
    if (layoutKeys.some((k) => k in patch)) {
      this.params = {
        ...this.params,
        floorHeight: this.dev.floorHeight,
        roomGap: this.dev.roomGap,
        buildingGap: this.dev.buildingGap,
        riserCount: this.dev.riserCount,
      };
      this.relayout();
    } else if (patch.pipeMode) {
      this.setView({ pipeMode: patch.pipeMode });
    }
    this.dirty = true;
  }

  /** Lays out the union of every turn, so stepping through turns moves nothing. */
  private relayout(immediate = false) {
    const t0 = performance.now();
    this.layout = layoutScene(this.diffs, this.params);
    this.layoutMs = performance.now() - t0;
    this.refresh(immediate);
  }

  private refresh(immediate = false) {
    const t0 = performance.now();
    this.state = deriveState(this.layout, this.diffs[this.turn]!, this.viewOptions);
    this.stateMs = performance.now() - t0;
    this.view.apply(this.layout, this.state, performance.now(), immediate);
    if (this.selectedId) {
      const s = this.state.roomById.get(this.selectedId);
      if (s?.present) this.sourcePanel.show(s);
      else this.select(null);
    }
    this.needsPick = true;
    this.dirty = true;
  }

  private updateToolbar() {
    this.toolbar.update({
      scenarioId: this.scenario.id,
      turn: this.turn,
      turnCount: this.diffs.length,
      side: this.viewOptions.side,
      layers: this.viewOptions.layers,
    });
  }

  private frameAll() {
    this.controller.frame(this.framingBox());
  }

  /** The scene bounds, widened on the left for the floor labels that hang off each building. */
  private framingBox() {
    const { min, max } = this.layout.bounds;
    return { min: { ...min, x: min.x - 5 }, max };
  }

  // ---- Interaction -------------------------------------------------------------------------

  private bindEvents() {
    const canvas = this.viewport;
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top, inside: true };
      this.needsPick = true;
    });
    canvas.addEventListener("pointerleave", () => {
      this.pointer.inside = false;
      this.needsPick = true;
    });
    canvas.addEventListener("pointerup", (e) => {
      if (e.button !== 0 || this.controller.lastPressWasDrag) return;
      const r = canvas.getBoundingClientRect();
      this.select(this.pickRoom(e.clientX - r.left, e.clientY - r.top));
    });
    addEventListener("keydown", (e) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case "Escape":
          this.select(null);
          break;
        case "f":
        case "F":
          this.frameAll();
          break;
        case "b":
        case "B":
          this.setView({ side: this.viewOptions.side === "head" ? "base" : "head" });
          break;
        case "n":
        case "N":
        case "ArrowRight":
          this.setTurn(this.turn + 1);
          break;
        case "p":
        case "P":
        case "ArrowLeft":
          this.setTurn(this.turn - 1);
          break;
        default:
          return;
      }
      e.preventDefault();
    });
    // Follow the OS setting, unless the embedding page stamps an explicit data-theme on the root.
    const followTheme = () => {
      const p = this.themePalette();
      if (p !== this.palette) this.applyPalette(p);
    };
    this.darkQuery.addEventListener("change", followTheme);
    new MutationObserver(followTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    addEventListener("hashchange", () => {
      const s = findScenario(location.hash.slice(1));
      if (s && s !== this.scenario) this.loadScenario(s);
    });
  }

  private pickRoom(x: number, y: number): string | null {
    const ndc = new Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.view.pickTargets(), false)[0];
    return (hit?.object.userData.roomId as string | undefined) ?? null;
  }

  private select(id: string | null) {
    this.selectedId = id;
    const s = id ? this.state?.roomById.get(id) : undefined;
    if (s?.present) this.sourcePanel.show(s);
    else this.sourcePanel.hide();
    this.view.setFocus([this.hoverId, this.selectedId]);
    this.dirty = true;
  }

  private updateHover() {
    this.needsPick = false;
    const id = this.pointer.inside && !this.controller.dragging ? this.pickRoom(this.pointer.x, this.pointer.y) : null;
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.view.setFocus([this.hoverId, this.selectedId]);
      this.viewport.style.cursor = id ? "pointer" : "";
    }
    const s = id ? this.state.roomById.get(id) : undefined;
    if (s) {
      const r = this.viewport.getBoundingClientRect();
      this.tooltip.show(r.left + this.pointer.x, r.top + this.pointer.y, s);
    } else {
      this.tooltip.hide();
    }
  }

  // ---- Rendering ---------------------------------------------------------------------------

  private applyPalette(p: Palette) {
    this.palette = p;
    this.scene.background = new Color(p.background);
    const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
    const style = document.documentElement.style;
    for (const key of ["added", "removed", "modified", "unchanged", "upward", "pipeUnchanged", "ink", "paper", "highlight"] as const) {
      style.setProperty(`--${key}`, hex(p[key]));
    }
    this.view.setPalette(p, performance.now());
    this.dirty = true;
  }

  /** Same rule as the stylesheet: an explicit data-theme wins, otherwise prefers-color-scheme. */
  private themePalette(): Palette {
    const theme = document.documentElement.dataset.theme;
    const dark = theme === "dark" || (theme !== "light" && this.darkQuery.matches);
    return dark ? DARK_PALETTE : LIGHT_PALETTE;
  }

  private resize() {
    this.width = Math.max(1, this.viewport.clientWidth);
    this.height = Math.max(1, this.viewport.clientHeight);
    this.renderer.setSize(this.width, this.height);
    this.labelRenderer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  private tick = (now: number) => {
    const dt = Math.min(0.1, Math.max(0, (now - this.lastTick) / 1000));
    this.lastTick = now;
    if (this.dev.spin) this.controller.orbit(dt * SPIN_SPEED, 0);
    const cameraMoved = this.controller.update(dt);
    if (cameraMoved && this.pointer.inside) this.needsPick = true;
    if (this.needsPick) this.updateHover();
    const sceneChanged = this.view.update(now, dt);

    if (cameraMoved || sceneChanged || this.dirty || this.dev.continuous) {
      this.dirty = false;
      const t0 = performance.now();
      this.view.updateLabels(this.camera, this.height, this.dev.labelThreshold);
      this.renderer.render(this.scene, this.camera);
      this.labelRenderer.render(this.scene, this.camera);
      this.renderTimes.push({ at: now, ms: performance.now() - t0 });
    }
    if (now - this.lastDebug > 250) {
      this.lastDebug = now;
      this.updateDebug(now);
    }
    requestAnimationFrame(this.tick);
  };

  private updateDebug(now: number) {
    this.renderTimes = this.renderTimes.filter((t) => now - t.at <= 1000);
    const frames = this.renderTimes.length;
    const avg = frames ? this.renderTimes.reduce((s, t) => s + t.ms, 0) / frames : 0;
    const info = this.renderer.info.render;
    const c = this.view.counts();
    this.debug.set([
      ["fps", frames ? String(frames) : "idle"],
      ["frame cpu", `${avg.toFixed(1)} ms`],
      ["draw calls", String(info.calls)],
      ["triangles", info.triangles.toLocaleString("en")],
      ["buildings", String(this.layout.buildings.length)],
      ["floors", String(c.floors)],
      ["rooms", `${c.roomsVisible} / ${c.rooms}`],
      ["pipes", `${c.pipesVisible} / ${c.pipes}`],
      ["labels", String(c.labelsVisible)],
      ["layout", `${this.layoutMs.toFixed(1)} ms`],
      ["state", `${this.stateMs.toFixed(1)} ms`],
    ]);
  }
}
