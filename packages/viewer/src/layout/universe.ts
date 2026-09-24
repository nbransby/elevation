import type { BuildingDiff } from "../model";
import { cmp } from "./graph";

// The universe is the union of every snapshot the layout has to hold still for: all floors, all
// rooms and all pipes that appear in any of them. Laying out the union (rather than each snapshot
// on its own) keeps buildings, floor order and room positions stable across base/head and turns.

export interface UniverseRoom {
  id: string;
  name: string;
  floorId: string;
  /** Largest size seen in any snapshot, base or head. */
  capacity: number;
}

export interface UniverseFloor {
  id: string;
  name: string;
  path: string;
  kind: "class" | "module";
  /** Sorted by ID. */
  rooms: UniverseRoom[];
}

export interface UniversePipe {
  id: string;
  from: string;
  to: string;
}

export interface Universe {
  /** Sorted by ID. */
  floors: UniverseFloor[];
  floorById: Map<string, UniverseFloor>;
  roomById: Map<string, UniverseRoom>;
  /** Sorted by ID; canonical endpoints; self-calls dropped. */
  pipes: UniversePipe[];
  /** Room ID → canonical room ID, for every room ID in any snapshot. */
  canonical: Map<string, string>;
  danglingPipes: number;
}

export function pipeId(from: string, to: string): string {
  return `${from}->${to}`;
}

/**
 * Returns a function resolving an ID used inside `diff` (a room ID, or an alias left behind by a
 * rename) to its canonical room ID, or undefined if the diff has no such room.
 */
export function idResolver(
  diff: BuildingDiff,
  canonical: ReadonlyMap<string, string>,
): (id: string) => string | undefined {
  const local = new Map<string, string>();
  for (const f of diff.floors) for (const r of f.rooms) local.set(r.id, r.id);
  for (const f of diff.floors) {
    for (const r of f.rooms) {
      for (const a of r.aliases ?? []) if (!local.has(a)) local.set(a, r.id);
    }
  }
  return (id) => {
    const l = local.get(id);
    return l === undefined ? undefined : (canonical.get(l) ?? l);
  };
}

export function buildUniverse(diffs: readonly BuildingDiff[]): Universe {
  interface Occurrence {
    floorId: string;
    name: string;
    last: number;
    capacity: number;
  }
  const occurrences = new Map<string, Occurrence>();
  const floorMeta = new Map<string, { name: string; path: string; kind: "class" | "module" }>();

  diffs.forEach((diff, di) => {
    for (const f of diff.floors) {
      floorMeta.set(f.id, { name: f.name, path: f.path, kind: f.kind });
      for (const r of f.rooms) {
        const prev = occurrences.get(r.id);
        const capacity = Math.max(prev?.capacity ?? 0, r.baseSize ?? 0, r.headSize ?? 0);
        occurrences.set(r.id, { floorId: f.id, name: r.name, last: di, capacity });
      }
    }
  });

  // A room renamed between snapshots appears under its old ID in one and its new ID (with the old
  // one in `aliases`) in another. Unify them when they sit on the same floor so the room keeps its
  // place; a move to another file is a genuine move.
  const parent = new Map<string, string>();
  for (const id of occurrences.keys()) parent.set(id, id);
  const find = (n: string): string => {
    while (parent.get(n) !== n) n = parent.get(n)!;
    return n;
  };
  for (const diff of diffs) {
    for (const f of diff.floors) {
      for (const r of f.rooms) {
        for (const a of r.aliases ?? []) {
          const o = occurrences.get(a);
          if (!o || a === r.id || o.floorId !== f.id) continue;
          const ra = find(r.id);
          const rb = find(a);
          if (ra !== rb) parent.set(rb, ra);
        }
      }
    }
  }
  const groups = new Map<string, string[]>();
  for (const id of occurrences.keys()) {
    const root = find(id);
    let g = groups.get(root);
    if (!g) groups.set(root, (g = []));
    g.push(id);
  }

  const canonical = new Map<string, string>();
  const roomById = new Map<string, UniverseRoom>();
  for (const members of groups.values()) {
    // The canonical ID is the one used by the latest snapshot.
    let best = members[0]!;
    for (const m of members) {
      const a = occurrences.get(m)!;
      const b = occurrences.get(best)!;
      if (a.last > b.last || (a.last === b.last && m < best)) best = m;
    }
    const occ = occurrences.get(best)!;
    let capacity = 0;
    for (const m of members) {
      canonical.set(m, best);
      capacity = Math.max(capacity, occurrences.get(m)!.capacity);
    }
    roomById.set(best, { id: best, name: occ.name, floorId: occ.floorId, capacity: Math.max(1, capacity) });
  }

  const floorById = new Map<string, UniverseFloor>();
  for (const id of [...floorMeta.keys()].sort(cmp)) {
    floorById.set(id, { id, ...floorMeta.get(id)!, rooms: [] });
  }
  for (const id of [...roomById.keys()].sort(cmp)) {
    const room = roomById.get(id)!;
    floorById.get(room.floorId)!.rooms.push(room);
  }

  const pipes = new Map<string, UniversePipe>();
  const dangling = new Set<string>();
  for (const diff of diffs) {
    const resolve = idResolver(diff, canonical);
    for (const p of diff.pipes) {
      const from = resolve(p.from);
      const to = resolve(p.to);
      if (from === undefined || to === undefined) {
        dangling.add(pipeId(p.from, p.to));
        continue;
      }
      if (from === to) continue;
      const id = pipeId(from, to);
      if (!pipes.has(id)) pipes.set(id, { id, from, to });
    }
  }

  return {
    floors: [...floorById.values()],
    floorById,
    roomById,
    pipes: [...pipes.values()].sort((a, b) => cmp(a.id, b.id)),
    canonical,
    danglingPipes: dangling.size,
  };
}
