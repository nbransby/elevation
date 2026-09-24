import { describe, expect, it } from "vitest";
import { LAYERS, type BuildingDiff } from "../model";
import { SCENARIOS } from ".";
import { STRESS_PIPES, STRESS_ROOMS } from "./scenarios/stress";

// Checks the section-4 rules on every scenario, until M2 replaces this with the zod schema.
function checkDiff(d: BuildingDiff, label: string) {
  expect(d.version).toBe(1);
  const roomIds = new Set<string>();
  const floorIds = new Set<string>();
  for (const f of d.floors) {
    expect(floorIds.has(f.id), `${label}: duplicate floor ${f.id}`).toBe(false);
    floorIds.add(f.id);
    expect(f.id).toBe(f.kind === "module" ? `${f.path}::<module>` : `${f.path}::${f.name}`);
    for (const r of f.rooms) {
      expect(roomIds.has(r.id), `${label}: duplicate room ${r.id}`).toBe(false);
      roomIds.add(r.id);
      expect(r.id).toBe(f.kind === "module" ? `${f.path}::${r.name}` : `${f.path}::${f.name}.${r.name}`);
      switch (r.change) {
        case "added":
          expect(r.baseSize).toBeNull();
          expect(r.headSize).toBeGreaterThan(0);
          expect(r.headSource).toBeDefined();
          break;
        case "removed":
          expect(r.headSize).toBeNull();
          expect(r.baseSize).toBeGreaterThan(0);
          expect(r.baseSource).toBeDefined();
          break;
        case "modified":
          expect(r.baseSource).toBeDefined();
          expect(r.headSource).toBeDefined();
          expect(r.baseSource).not.toBe(r.headSource);
          break;
        case "unchanged":
          expect(r.baseSize).toBe(r.headSize);
          expect(r.layer).toBeUndefined();
      }
      if (r.change !== "unchanged") {
        expect(LAYERS).toContain(r.layer);
        expect(r.isContext).toBe(false);
      }
      for (const [src, size] of [[r.baseSource, r.baseSize], [r.headSource, r.headSize]] as const) {
        if (src !== undefined) expect(src.split("\n").filter((l) => l.trim() !== "").length).toBe(size);
      }
    }
    expect([...f.rooms].map((r) => r.id)).toEqual([...f.rooms].map((r) => r.id).sort());
  }
  const pipeKeys = new Set<string>();
  for (const p of d.pipes) {
    expect(roomIds.has(p.from), `${label}: pipe from unknown ${p.from}`).toBe(true);
    expect(roomIds.has(p.to), `${label}: pipe to unknown ${p.to}`).toBe(true);
    expect(pipeKeys.has(`${p.from}>${p.to}`)).toBe(false);
    pipeKeys.add(`${p.from}>${p.to}`);
    expect(p.precise).toBe(true);
  }
  expect(d.stats.rooms).toBe(roomIds.size);
  expect(d.stats.pipes).toBe(d.pipes.length);
  expect(d.stats.files).toBe(new Set(d.floors.map((f) => f.path)).size);
}

describe("mock scenarios", () => {
  it("has the ten scenarios from the plan", () => {
    expect(SCENARIOS).toHaveLength(10);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(10);
  });

  for (const s of SCENARIOS) {
    it(`${s.id} is well-formed and deterministic`, () => {
      const diffs = s.build();
      expect(diffs.length).toBeGreaterThan(0);
      diffs.forEach((d, i) => {
        checkDiff(d, `${s.id}#${i + 1}`);
        expect(d.session.turn).toBe(i + 1);
      });
      expect(JSON.stringify(s.build())).toBe(JSON.stringify(diffs));
    });
  }

  it("stress has about 500 rooms and 800 pipes", () => {
    const [d] = SCENARIOS.find((s) => s.id === "stress")!.build();
    expect(d!.stats.rooms).toBe(STRESS_ROOMS);
    expect(d!.stats.pipes).toBe(STRESS_PIPES);
  });

  it("all-kinds covers every change kind in every layer, context rooms and a rename", () => {
    const [d] = SCENARIOS.find((s) => s.id === "all-kinds")!.build();
    const rooms = d!.floors.flatMap((f) => f.rooms);
    for (const change of ["added", "removed", "modified"] as const) {
      for (const layer of LAYERS) {
        expect(rooms.some((r) => r.change === change && r.layer === layer), `${change}/${layer}`).toBe(true);
      }
    }
    expect(rooms.some((r) => r.isContext)).toBe(true);
    expect(rooms.some((r) => (r.aliases ?? []).length > 0)).toBe(true);
    expect(new Set(d!.floors.map((f) => f.change))).toEqual(new Set(["added", "removed", "modified", "unchanged"]));
    expect(new Set(d!.pipes.map((p) => p.change))).toEqual(new Set(["added", "removed", "unchanged"]));
  });

  it("the turn sequence has several turns where rooms grow, appear, disappear and change layer", () => {
    const diffs = SCENARIOS.find((s) => s.id === "turns")!.build();
    expect(diffs.length).toBeGreaterThanOrEqual(4);
    const layerOf = (d: BuildingDiff, id: string) => d.floors.flatMap((f) => f.rooms).find((r) => r.id === id)?.layer;
    const add = "src/todo/TodoList.ts::TodoList.add";
    expect(diffs.map((d) => layerOf(d, add))).toEqual(["uncommitted", "uncommitted", "committed", "pushed", "pushed"]);
  });
});

describe("layout purity", () => {
  it("has no three.js or DOM-dependent imports in src/layout", () => {
    const sources = import.meta.glob<string>("../layout/*.ts", { query: "?raw", import: "default", eager: true });
    expect(Object.keys(sources).length).toBeGreaterThan(5);
    for (const [file, text] of Object.entries(sources)) {
      expect(text, file).not.toMatch(/from ["'](three|\.\.\/render|\.\.\/controls|\.\.\/ui)/);
    }
  });
});
