import { describe, expect, it } from "vitest";
import { SCENARIOS, findScenario } from "../mock";
import { buildDiff } from "../mock/builder";
import { chain, cycles, diamond, twoBuildings } from "../mock/scenarios/basic";
import { stress } from "../mock/scenarios/stress";
import { turns } from "../mock/scenarios/turns";
import type { BuildingDiff } from "../model";
import { DEFAULT_LAYOUT_PARAMS, DEFAULT_VIEW, deriveState, layoutScene } from ".";
import type { LayoutResult } from ".";

const storeyOf = (layout: LayoutResult, name: string) => {
  const f = layout.floors.find((fl) => fl.name === name);
  if (!f) throw new Error(`no floor ${name}`);
  return f.storey;
};
const buildingOf = (layout: LayoutResult, name: string) => layout.floors.find((f) => f.name === name)!.buildingId;

describe("layoutScene", () => {
  it("puts two unrelated classes in two buildings", () => {
    const layout = layoutScene(twoBuildings());
    expect(layout.buildings).toHaveLength(2);
    expect(buildingOf(layout, "Cart")).not.toBe(buildingOf(layout, "Logger"));
    expect(storeyOf(layout, "Cart")).toBe(0);
    expect(storeyOf(layout, "Logger")).toBe(0);
    // Side by side, not overlapping.
    const [a, b] = layout.buildings;
    expect(a!.x + a!.width).toBeLessThan(b!.x);
  });

  it("stacks a chain A→B→C with C at the bottom and A at the top", () => {
    const layout = layoutScene(chain());
    expect(layout.buildings).toHaveLength(1);
    expect(storeyOf(layout, "PaymentGateway")).toBe(0);
    expect(storeyOf(layout, "CheckoutService")).toBe(1);
    expect(storeyOf(layout, "CheckoutController")).toBe(2);
    expect(layout.buildings[0]!.floorIds.map((id) => layout.floorById.get(id)!.name)).toEqual([
      "PaymentGateway",
      "CheckoutService",
      "CheckoutController",
    ]);
  });

  it("puts a diamond's shared dependency at the bottom", () => {
    const layout = layoutScene(diamond());
    expect(layout.buildings).toHaveLength(1);
    expect(storeyOf(layout, "Database")).toBe(0);
    expect(storeyOf(layout, "App")).toBe(3);
    // The two middle floors share a level: one floor per storey, tie broken by path.
    expect(storeyOf(layout, "OrderService")).toBe(1); // src/orders/… < src/users/…
    expect(storeyOf(layout, "UserService")).toBe(2);
  });

  it("stacks cycle members on adjacent floors and flags their upward pipes", () => {
    const layout = layoutScene(cycles());
    // The two-class cycle is its own building; the three-class cycle sits inside a larger one.
    expect(buildingOf(layout, "Parser")).toBe(buildingOf(layout, "Lexer"));
    expect(buildingOf(layout, "Scheduler")).not.toBe(buildingOf(layout, "Parser"));
    expect(layout.buildings).toHaveLength(2);

    const two = [storeyOf(layout, "Parser"), storeyOf(layout, "Lexer")].sort();
    expect(two[1]! - two[0]!).toBe(1);

    const three = ["Scheduler", "Worker", "Queue"].map((n) => storeyOf(layout, n)).sort();
    expect(three[1]! - three[0]!).toBe(1);
    expect(three[2]! - three[1]!).toBe(1);
    // Store is below the cycle (Queue depends on it); the module floor calling Scheduler is above.
    expect(storeyOf(layout, "Store")).toBeLessThan(three[0]!);
    expect(storeyOf(layout, "main.ts")).toBeGreaterThan(three[2]!);

    const cycleFloor = layout.floors.find((f) => f.name === "Worker")!;
    expect(cycleFloor.cycle).toHaveLength(3);
    expect(layout.floors.find((f) => f.name === "Store")!.cycle).toBeNull();

    // Every cycle has at least one upward pipe, and only pipes within a cycle run upward.
    const upward = layout.pipes.filter((p) => p.upward);
    expect(upward.length).toBeGreaterThanOrEqual(2);
    for (const p of layout.pipes) {
      const fa = layout.floorById.get(layout.roomById.get(p.from)!.floorId)!;
      const fb = layout.floorById.get(layout.roomById.get(p.to)!.floorId)!;
      expect(p.upward).toBe(fa.storey < fb.storey);
      if (p.upward) expect(fa.cycle).not.toBeNull();
      if (p.upward) expect(fa.cycle).toBe(fb.cycle);
    }
  });

  it("keeps a floor's dependencies below it in every scenario", () => {
    for (const s of SCENARIOS) {
      const layout = layoutScene(s.build());
      for (const p of layout.pipes) {
        const fa = layout.floorById.get(layout.roomById.get(p.from)!.floorId)!;
        const fb = layout.floorById.get(layout.roomById.get(p.to)!.floorId)!;
        expect(fa.buildingId, `${s.id}: pipe ${p.id} crosses buildings`).toBe(fb.buildingId);
        if (fa.cycle === null || fa.cycle !== fb.cycle) {
          expect(fa.storey, `${s.id}: ${p.id}`).toBeGreaterThanOrEqual(fb.storey);
        }
      }
    }
  });

  it("does not move any existing floor or room between turns", () => {
    const diffs = turns();
    const layout = layoutScene(diffs);
    // Floors are positioned by the layout alone, which is computed once for the whole sequence.
    // Filter and api.ts both depend on nothing; the tie is broken by path ("F" sorts before "a").
    expect(layout.floors.map((f) => f.name)).toEqual(["Filter", "api.ts", "TodoStore", "TodoList"]);
    const states = diffs.map((d) => deriveState(layout, d, DEFAULT_VIEW));
    let compared = 0;
    for (let t = 1; t < states.length; t++) {
      const prev = states[t - 1]!;
      const cur = states[t]!;
      for (const r of cur.rooms) {
        const before = prev.roomById.get(r.id)!;
        if (!r.present || !before.present) continue;
        compared++;
        expect([r.box.x, r.box.y, r.box.z], `turn ${t + 1}: ${r.id} moved`).toEqual([
          before.box.x,
          before.box.y,
          before.box.z,
        ]);
      }
    }
    expect(compared).toBeGreaterThan(10);
    // Rooms do grow, appear and disappear across the sequence.
    const add = "src/todo/TodoList.ts::TodoList.add";
    expect(states[1]!.roomById.get(add)!.box.width).toBeGreaterThan(states[0]!.roomById.get(add)!.box.width);
    const toggle = "src/todo/TodoList.ts::TodoList.toggle";
    expect(states.map((s) => s.roomById.get(toggle)!.present)).toEqual([false, true, true, true, false]);
  });

  it("does not move anything when switching between base and head", () => {
    const [diff] = cycles();
    const layout = layoutScene([diff!]);
    const head = deriveState(layout, diff!, DEFAULT_VIEW);
    const base = deriveState(layout, diff!, { ...DEFAULT_VIEW, side: "base" });
    for (const r of head.rooms) {
      const b = base.roomById.get(r.id)!;
      expect([b.box.x, b.box.y, b.box.z]).toEqual([r.box.x, r.box.y, r.box.z]);
    }
  });

  it("keeps a renamed room in its place across turns", () => {
    const diffs = turns();
    const layout = layoutScene(diffs);
    const listPath = "src/todo/TodoList.ts";
    expect(layout.canonical.get(`${listPath}::TodoList.remove`)).toBe(`${listPath}::TodoList.delete`);
    const t3 = deriveState(layout, diffs[2]!, DEFAULT_VIEW).roomById.get(`${listPath}::TodoList.delete`)!;
    const t4 = deriveState(layout, diffs[3]!, DEFAULT_VIEW).roomById.get(`${listPath}::TodoList.delete`)!;
    expect(t3.present && t4.present).toBe(true);
    expect(t3.room!.name).toBe("remove");
    expect(t4.room!.name).toBe("delete");
    expect([t3.box.x, t3.box.z]).toEqual([t4.box.x, t4.box.z]);
  });

  it("gives every floor in a building the same footprint", () => {
    const layout = layoutScene(stress());
    for (const b of layout.buildings) {
      for (const id of b.floorIds) {
        const f = layout.floorById.get(id)!;
        expect([f.x, f.z, f.width, f.depth]).toEqual([b.x, -b.depth, b.width, b.depth]);
      }
    }
  });

  it("places buildings tallest first, then by the path of the ground floor", () => {
    const layout = layoutScene(stress());
    for (let i = 1; i < layout.buildings.length; i++) {
      const a = layout.buildings[i - 1]!;
      const b = layout.buildings[i]!;
      expect(a.floorIds.length).toBeGreaterThanOrEqual(b.floorIds.length);
      if (a.floorIds.length === b.floorIds.length) {
        expect(layout.floorById.get(a.id)!.path <= layout.floorById.get(b.id)!.path).toBe(true);
      }
      expect(a.x + a.width).toBeLessThan(b.x);
    }
  });

  it("sizes rooms by lines of code, comparably across floors", () => {
    const layout = layoutScene(stress());
    const area = (id: string) => {
      const c = layout.roomById.get(id)!.cell;
      return (c.x1 - c.x0 + DEFAULT_LAYOUT_PARAMS.roomGap) * (c.z1 - c.z0 + DEFAULT_LAYOUT_PARAMS.roomGap);
    };
    // Area per line (with the gap added back) stays within a band across the whole building.
    const b = layout.buildings[0]!;
    const ratios = layout.rooms
      .filter((r) => b.floorIds.includes(r.floorId) && r.capacity >= 20)
      .map((r) => area(r.id) / r.capacity);
    const lo = Math.min(...ratios);
    const hi = Math.max(...ratios);
    expect(hi / lo).toBeLessThan(2);
  });

  it("keeps rooms inside their floor and apart from each other", () => {
    const layout = layoutScene(stress());
    const byFloor = new Map<string, LayoutResult["rooms"]>();
    for (const r of layout.rooms) byFloor.set(r.floorId, [...(byFloor.get(r.floorId) ?? []), r]);
    for (const [floorId, rooms] of byFloor) {
      const f = layout.floorById.get(floorId)!;
      const b = layout.buildings.find((x) => x.id === f.buildingId)!;
      for (const r of rooms) {
        expect(r.cell.x0).toBeGreaterThanOrEqual(f.x - 1e-9);
        expect(r.cell.x1).toBeLessThanOrEqual(f.x + b.roomsWidth + 1e-9);
        expect(r.cell.z0).toBeGreaterThanOrEqual(f.z - 1e-9);
        expect(r.cell.z1).toBeLessThanOrEqual(1e-9);
      }
      for (let i = 0; i < rooms.length; i++) {
        for (let j = i + 1; j < rooms.length; j++) {
          const a = rooms[i]!.cell;
          const c = rooms[j]!.cell;
          const overlap = Math.min(a.x1, c.x1) - Math.max(a.x0, c.x0) > 1e-9 && Math.min(a.z1, c.z1) - Math.max(a.z0, c.z0) > 1e-9;
          expect(overlap, `${rooms[i]!.id} overlaps ${rooms[j]!.id}`).toBe(false);
        }
      }
    }
  });

  it("routes pipes as orthogonal polylines from roof to roof", () => {
    const layout = layoutScene(stress());
    expect(layout.pipes.length).toBeGreaterThan(700);
    for (const p of layout.pipes) {
      expect(p.points.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < p.points.length; i++) {
        const a = p.points[i - 1]!;
        const b = p.points[i]!;
        const axes = [a.x !== b.x, a.y !== b.y, a.z !== b.z].filter(Boolean).length;
        expect(axes, `${p.id} segment ${i} is not axis-aligned`).toBe(1);
      }
      // Starts on the caller's roof and ends on the callee's, near the middle.
      for (const [roomId, q] of [[p.from, p.points[0]!], [p.to, p.points[p.points.length - 1]!]] as const) {
        const room = layout.roomById.get(roomId)!;
        const c = room.cell;
        expect(q.y).toBeCloseTo(room.y + room.height);
        expect(Math.abs(q.x - (c.x0 + c.x1) / 2)).toBeLessThanOrEqual((c.x1 - c.x0) * 0.3 + 1e-9);
        expect(Math.abs(q.z - (c.z0 + c.z1) / 2)).toBeLessThanOrEqual((c.z1 - c.z0) * 0.3 + 1e-9);
      }
      if (!p.sameFloor) {
        const b = layout.buildings.find((x) => x.id === p.buildingId)!;
        // The vertical run is inside the core.
        const vertical = p.points.find((q, i) => i > 1 && i < p.points.length - 1 && q.x >= b.core.x);
        expect(vertical, `${p.id} doesn't pass through the core`).toBeDefined();
      }
    }
  });

  it("is deterministic and independent of input order", () => {
    const a = layoutScene(stress());
    const b = layoutScene(stress());
    expect(b).toEqual(a);

    const shuffled: BuildingDiff[] = stress().map((d) => ({
      ...d,
      floors: [...d.floors].reverse().map((f) => ({ ...f, rooms: [...f.rooms].reverse() })),
      pipes: [...d.pipes].reverse(),
    }));
    const c = layoutScene(shuffled);
    expect(c.rooms).toEqual(a.rooms);
    expect(c.floors).toEqual(a.floors);
    expect(c.pipes).toEqual(a.pipes);
  });

  it("lays out the stress scenario in under 50 ms", () => {
    const diffs = stress();
    layoutScene(diffs); // warm up the JIT
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      layoutScene(diffs);
      runs.push(performance.now() - t0);
    }
    runs.sort((x, y) => x - y);
    expect(runs[2]!).toBeLessThan(50);
  });

  it("drops pipes to unknown rooms and self-calls", () => {
    const d = buildDiff({
      scenario: "dangling",
      floors: [{ path: "a.ts", name: "A", rooms: [{ name: "f" }, { name: "g" }] }],
      pipes: [["A.f", "A.g"], ["A.f", "A.f"]],
    });
    d.pipes.push({ from: "a.ts::A.f", to: "b.ts::B.h", change: "added", precise: true });
    const layout = layoutScene([d]);
    expect(layout.pipes.map((p) => p.id)).toEqual(["a.ts::A.f->a.ts::A.g"]);
    expect(layout.danglingPipes).toBe(1);
  });

  it("handles an empty diff", () => {
    const layout = layoutScene([buildDiff({ scenario: "empty", floors: [] })]);
    expect(layout.buildings).toEqual([]);
    expect(layout.bounds.min).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("finds scenarios by ID and by number", () => {
    expect(findScenario("3")?.id).toBe("chain");
    expect(findScenario("stress")?.id).toBe("stress");
    expect(findScenario("nope")).toBeUndefined();
  });
});
