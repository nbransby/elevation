import type { BuildingDiff } from "../model";
import { cmp, stackByDependency, weakComponents } from "./graph";
import { DEFAULT_LAYOUT_PARAMS } from "./params";
import { laneOffset, routePipe, type RouteEnd } from "./pipes";
import { floorTreemap, type LocalRect } from "./treemap";
import type {
  BuildingLayout,
  FloorLayout,
  LayoutParams,
  LayoutResult,
  PipeLayout,
  RoomLayout,
  Vec3,
} from "./types";
import { buildUniverse, type UniverseFloor, type UniversePipe } from "./universe";

/** Distinct heights for horizontal pipe runs in a plenum, so parallel runs don't coincide. */
const RUN_LEVELS = 4;
const CORE_MARGIN = 0.35;
const MIN_CORE_WIDTH = 1.2;

/**
 * Lays out the union of `snapshots` (for example base/head of one diff, or every turn of a
 * session) so that buildings, floors and rooms hold still when switching between them.
 * Pure and deterministic: the same input gives a deep-equal result.
 */
export function layoutScene(
  snapshots: readonly BuildingDiff[],
  params: LayoutParams = DEFAULT_LAYOUT_PARAMS,
): LayoutResult {
  const u = buildUniverse(snapshots);
  const H = params.floorHeight;
  const roomH = H * params.roomHeightRatio;
  const slab = params.slabThickness;
  const plenum = Math.max(0, H - slab - roomH);

  // Floor dependency graph: A → B if any room on A calls a room on B.
  const adjSets = new Map<string, Set<string>>();
  for (const f of u.floors) adjSets.set(f.id, new Set());
  for (const p of u.pipes) {
    const a = u.roomById.get(p.from)!.floorId;
    const b = u.roomById.get(p.to)!.floorId;
    if (a !== b) adjSets.get(a)!.add(b);
  }
  const adj = new Map<string, string[]>();
  for (const [k, v] of adjSets) adj.set(k, [...v].sort(cmp));

  const compareFloors = (a: string, b: string) => {
    const fa = u.floorById.get(a)!;
    const fb = u.floorById.get(b)!;
    return cmp(fa.path, fb.path) || cmp(fa.name, fb.name) || cmp(a, b);
  };

  interface Draft {
    order: string[];
    cycleOf: Map<string, string[]>;
    roomsWidth: number;
    depth: number;
    coreWidth: number;
    cells: Map<string, LocalRect>;
    storeyOf: Map<string, number>;
    pipes: { pipe: UniversePipe; riser: number | null; lane: number; runLevel: number }[];
    riserZ: number[];
    riserLoad: number[];
  }

  const drafts: Draft[] = [];
  for (const group of weakComponents(u.floors.map((f) => f.id), adj)) {
    const { order, cycleOf } = stackByDependency(group, adj, compareFloors);
    const storeyOf = new Map(order.map((id, i) => [id, i]));

    // Shared footprint, sized to the building's largest floor.
    const floors = order.map((id) => u.floorById.get(id)!);
    const total = (f: UniverseFloor) => f.rooms.reduce((s, r) => s + r.capacity, 0);
    const maxTotal = Math.max(1, ...floors.map(total));
    const maxRooms = Math.max(1, ...floors.map((f) => f.rooms.length));
    const area = maxTotal * params.areaPerLine;
    const padding = params.roomGap * (Math.ceil(Math.sqrt(maxRooms)) + 1);
    const roomsWidth = Math.max(2, Math.sqrt(area * params.footprintAspect) + padding);
    const depth = Math.max(2, Math.sqrt(area / params.footprintAspect) + padding);

    const cells = new Map<string, LocalRect>();
    for (const f of floors) {
      const rects = floorTreemap(
        f.rooms.map((r) => ({ id: r.id, value: r.capacity })),
        roomsWidth,
        depth,
        maxTotal,
        params.roomGap,
      );
      for (const [id, rect] of rects) cells.set(id, rect);
    }

    // Risers sit in the core, spread evenly front to back; each cross-floor pipe takes the riser
    // nearest the midpoint of its two rooms, and a lane of its own inside that shaft.
    const riserCount = Math.max(1, Math.round(params.riserCount));
    const riserZ = Array.from({ length: riserCount }, (_, r) => (-depth * (r + 0.5)) / riserCount);
    const riserLoad = riserZ.map(() => 0);
    const members = new Set(group);
    const buildingPipes = u.pipes.filter((p) => members.has(u.roomById.get(p.from)!.floorId));
    const pipes = buildingPipes.map((pipe, i) => {
      const a = u.roomById.get(pipe.from)!;
      const b = u.roomById.get(pipe.to)!;
      if (a.floorId === b.floorId) return { pipe, riser: null, lane: 0, runLevel: i % RUN_LEVELS };
      const mid = (centreZ(cells.get(a.id)) + centreZ(cells.get(b.id))) / 2;
      let riser = 0;
      for (let r = 1; r < riserCount; r++) {
        if (Math.abs(riserZ[r]! - mid) < Math.abs(riserZ[riser]! - mid)) riser = r;
      }
      return { pipe, riser, lane: riserLoad[riser]!++, runLevel: i % RUN_LEVELS };
    });
    const lanesAcross = Math.max(1, ...riserLoad.map((n) => Math.ceil(Math.sqrt(n))));
    const coreWidth = Math.max(MIN_CORE_WIDTH, lanesAcross * params.laneSpacing + 2 * CORE_MARGIN);

    drafts.push({ order, cycleOf, roomsWidth, depth, coreWidth, cells, storeyOf, pipes, riserZ, riserLoad });
  }

  // Buildings stand in a row: tallest first, then by the path of the ground floor.
  drafts.sort((a, b) => {
    const ga = u.floorById.get(a.order[0]!)!;
    const gb = u.floorById.get(b.order[0]!)!;
    return b.order.length - a.order.length || cmp(ga.path, gb.path) || cmp(ga.id, gb.id);
  });

  const rowWidth =
    drafts.reduce((s, d) => s + d.roomsWidth + d.coreWidth, 0) + params.buildingGap * Math.max(0, drafts.length - 1);
  let cursor = -rowWidth / 2;

  const buildings: BuildingLayout[] = [];
  const floors: FloorLayout[] = [];
  const rooms: RoomLayout[] = [];
  const pipes: PipeLayout[] = [];

  drafts.forEach((d, index) => {
    const bx = cursor;
    cursor += d.roomsWidth + d.coreWidth + params.buildingGap;
    const width = d.roomsWidth + d.coreWidth;
    const buildingId = d.order[0]!;
    const coreX = bx + d.roomsWidth;
    const risers = d.riserZ.map((z) => ({ x: coreX + d.coreWidth / 2, z }));

    buildings.push({
      id: buildingId,
      index,
      floorIds: d.order,
      x: bx,
      width,
      depth: d.depth,
      roomsWidth: d.roomsWidth,
      height: d.order.length * H,
      core: { x: coreX, width: d.coreWidth, risers },
    });

    for (const floorId of d.order) {
      const f = u.floorById.get(floorId)!;
      const storey = d.storeyOf.get(floorId)!;
      const y = storey * H;
      floors.push({
        id: f.id,
        name: f.name,
        path: f.path,
        kind: f.kind,
        buildingId,
        storey,
        y,
        x: bx,
        z: -d.depth,
        width,
        depth: d.depth,
        cycle: d.cycleOf.get(floorId) ?? null,
      });
      for (const r of f.rooms) {
        const c = d.cells.get(r.id) ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
        rooms.push({
          id: r.id,
          name: r.name,
          floorId: f.id,
          capacity: r.capacity,
          cell: { x0: bx + c.x0, z0: -c.y1, x1: bx + c.x1, z1: -c.y0 },
          y: y + slab,
          height: roomH,
        });
      }
    }

    // Each pipe gets its own small slot on the roof of the rooms it connects, so the pipes into a
    // busy room don't all drop onto one line.
    const slotCount = new Map<string, number>();
    const slots = d.pipes.map(({ pipe }) => {
      const out = slotCount.get(pipe.from) ?? 0;
      slotCount.set(pipe.from, out + 1);
      const inn = slotCount.get(pipe.to) ?? 0;
      slotCount.set(pipe.to, inn + 1);
      return { from: out, to: inn };
    });
    const end = (roomId: string, runLevel: number, slot: number): RouteEnd => {
      const room = u.roomById.get(roomId)!;
      const c = d.cells.get(roomId) ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
      const y = d.storeyOf.get(room.floorId)! * H;
      const reach = Math.max(0, Math.min(c.x1 - c.x0, c.y1 - c.y0) * 0.3 - params.pipeRadius);
      const off = laneOffset(slot, slotCount.get(roomId)!, params.pipeRadius * 3);
      return {
        x: bx + (c.x0 + c.x1) / 2 + clamp(off.dx, reach),
        z: -(c.y0 + c.y1) / 2 + clamp(off.dz, reach),
        roofY: y + slab + roomH,
        runY: y + slab + roomH + plenum * (0.25 + (0.5 * runLevel) / (RUN_LEVELS - 1)),
      };
    };

    for (const [i, { pipe, riser, lane, runLevel }] of d.pipes.entries()) {
      const fa = u.roomById.get(pipe.from)!.floorId;
      const fb = u.roomById.get(pipe.to)!.floorId;
      let shaft = null;
      if (riser !== null) {
        const off = laneOffset(lane, d.riserLoad[riser]!, params.laneSpacing);
        shaft = { x: risers[riser]!.x + off.dx, z: risers[riser]!.z + off.dz };
      }
      pipes.push({
        id: pipe.id,
        from: pipe.from,
        to: pipe.to,
        buildingId,
        points: routePipe(end(pipe.from, runLevel, slots[i]!.from), end(pipe.to, runLevel, slots[i]!.to), shaft),
        upward: d.storeyOf.get(fa)! < d.storeyOf.get(fb)!,
        sameFloor: fa === fb,
        riser,
      });
    }
  });

  rooms.sort((a, b) => cmp(a.id, b.id));
  pipes.sort((a, b) => cmp(a.id, b.id));

  const min: Vec3 = { x: 0, y: 0, z: 0 };
  const max: Vec3 = { x: 0, y: 0, z: 0 };
  if (buildings.length > 0) {
    min.x = buildings[0]!.x;
    const last = buildings[buildings.length - 1]!;
    max.x = last.x + last.width;
    max.y = Math.max(...buildings.map((b) => b.height));
    min.z = -Math.max(...buildings.map((b) => b.depth));
  }

  return {
    params: { ...params },
    buildings,
    floors,
    rooms,
    pipes,
    bounds: { min, max },
    canonical: u.canonical,
    floorById: new Map(floors.map((f) => [f.id, f])),
    roomById: new Map(rooms.map((r) => [r.id, r])),
    pipeById: new Map(pipes.map((p) => [p.id, p])),
    danglingPipes: u.danglingPipes,
  };
}

function clamp(v: number, reach: number): number {
  return Math.max(-reach, Math.min(reach, v));
}

function centreZ(c: LocalRect | undefined): number {
  return c ? -(c.y0 + c.y1) / 2 : 0;
}
