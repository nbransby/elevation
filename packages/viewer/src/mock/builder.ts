import type { BuildingDiff, ChangeKind, Floor, Layer, Pipe, Room } from "../model";
import { hashString } from "./rng";
import { fakeSource, fakeSourcePair } from "./source";

// A compact way to write mock BuildingDiffs. IDs, sources, floor change kinds and stats are
// derived, so scenarios only state what matters to them.

export interface RoomSpec {
  name: string;
  /** Default: unchanged. */
  change?: ChangeKind;
  /** For changed rooms. Default: uncommitted. */
  layer?: Layer;
  /** Size on every side the room exists on (unchanged: both; added: head; removed: base). */
  size?: number;
  /** Modified rooms: base and head sizes. */
  base?: number;
  head?: number;
  /** Default: true for unchanged rooms. */
  context?: boolean;
  /** Previous name on the same floor, or a full previous room ID. */
  renamedFrom?: string;
}

export interface FloorSpec {
  /** How pipes refer to the floor: `${ref}.${room}`. Default: the floor name. */
  ref?: string;
  path: string;
  /** Class name. Module floors default to the file name. */
  name?: string;
  /** Default: class. */
  kind?: "class" | "module";
  /** Default: derived from the rooms. */
  change?: ChangeKind;
  rooms: RoomSpec[];
}

/** `[from, to, change]` with rooms written `${floorRef}.${roomName}`. Change defaults to unchanged. */
export type PipeSpec = readonly [string, string, Pipe["change"]?];

export interface DiffSpec {
  scenario: string;
  turn?: number;
  branch?: string;
  floors: FloorSpec[];
  pipes?: readonly PipeSpec[];
  unresolvedCalls?: number;
}

export const MOCK_REPO = "acme-shop";

export function floorId(path: string, kind: "class" | "module", name: string): string {
  return kind === "module" ? `${path}::<module>` : `${path}::${name}`;
}

export function roomId(path: string, kind: "class" | "module", className: string, room: string): string {
  return kind === "module" ? `${path}::${room}` : `${path}::${className}.${room}`;
}

export function buildDiff(spec: DiffSpec): BuildingDiff {
  const refs = new Map<string, string>();
  const floors: Floor[] = spec.floors.map((fs) => {
    const kind = fs.kind ?? "class";
    const name = fs.name ?? fs.path.split("/").pop()!;
    const id = floorId(fs.path, kind, name);
    const rooms = fs.rooms.map((rs) => buildRoom(fs.path, kind, name, rs));
    for (const [i, r] of rooms.entries()) {
      const ref = `${fs.ref ?? name}.${fs.rooms[i]!.name}`;
      if (refs.has(ref)) throw new Error(`mock ${spec.scenario}: duplicate room ref ${ref}`);
      refs.set(ref, r.id);
    }
    rooms.sort((a, b) => cmp(a.id, b.id));
    return { id, kind, name, path: fs.path, change: fs.change ?? floorChange(rooms), rooms };
  });
  floors.sort((a, b) => cmp(a.id, b.id));

  const lookup = (ref: string) => {
    const id = refs.get(ref);
    if (id === undefined) throw new Error(`mock ${spec.scenario}: unknown room ref ${ref}`);
    return id;
  };
  const pipes: Pipe[] = (spec.pipes ?? []).map(([from, to, change]) => ({
    from: lookup(from),
    to: lookup(to),
    change: change ?? "unchanged",
    precise: true,
  }));
  pipes.sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to));
  for (let i = 1; i < pipes.length; i++) {
    if (pipes[i]!.from === pipes[i - 1]!.from && pipes[i]!.to === pipes[i - 1]!.to) {
      throw new Error(`mock ${spec.scenario}: duplicate pipe ${pipes[i]!.from} -> ${pipes[i]!.to}`);
    }
  }

  const turn = spec.turn ?? 1;
  const seed = `${spec.scenario}#${turn}`;
  const roomCount = floors.reduce((s, f) => s + f.rooms.length, 0);
  const dirty = floors.some((f) => f.rooms.some((r) => r.layer === "uncommitted"));
  return {
    version: 1,
    session: {
      id: `mock-${spec.scenario}`,
      turn,
      createdAt: new Date(Date.UTC(2026, 8, 1, 12, turn)).toISOString(),
    },
    repo: {
      name: MOCK_REPO,
      branch: spec.branch ?? "feature/checkout",
      defaultBranch: "main",
      baseOid: fakeOid(`${spec.scenario}#base`),
      upstreamOid: fakeOid(`${seed}#upstream`),
      headOid: fakeOid(`${seed}#head`),
      dirty,
    },
    stats: {
      files: new Set(floors.map((f) => f.path)).size,
      rooms: roomCount,
      pipes: pipes.length,
      unresolvedCalls: spec.unresolvedCalls ?? 0,
      indexMs: 200 + (hashString(seed) % 900),
    },
    floors,
    pipes,
  };
}

function buildRoom(path: string, kind: "class" | "module", className: string, rs: RoomSpec): Room {
  const change = rs.change ?? "unchanged";
  const id = roomId(path, kind, className, rs.name);
  const method = kind === "class";
  const size = rs.size ?? 10;
  const room: Room = { id, name: rs.name, change, baseSize: null, headSize: null, isContext: false };

  switch (change) {
    case "unchanged":
      room.baseSize = room.headSize = size;
      room.isContext = rs.context ?? true;
      return room;
    case "added":
      room.headSize = size;
      room.headSource = fakeSource({ name: rs.name, method, lines: size }, id);
      break;
    case "removed":
      room.baseSize = size;
      room.baseSource = fakeSource({ name: rs.name, method, lines: size }, id);
      break;
    case "modified": {
      room.baseSize = rs.base ?? size;
      room.headSize = rs.head ?? Math.round(room.baseSize * 1.3) + 1;
      let oldName = rs.name;
      if (rs.renamedFrom !== undefined) {
        const oldId = rs.renamedFrom.includes("::") ? rs.renamedFrom : roomId(path, kind, className, rs.renamedFrom);
        room.aliases = [oldId];
        oldName = oldId.split(/::|\./).pop()!;
      }
      const pair = fakeSourcePair(
        { name: oldName, method, lines: room.baseSize },
        { name: rs.name, method, lines: room.headSize },
        id,
      );
      room.baseSource = pair.base;
      room.headSource = pair.head;
      break;
    }
  }
  room.layer = rs.layer ?? "uncommitted";
  room.isContext = false;
  return room;
}

function floorChange(rooms: Room[]): ChangeKind {
  if (rooms.length === 0) return "unchanged";
  if (rooms.every((r) => r.change === "added")) return "added";
  if (rooms.every((r) => r.change === "removed")) return "removed";
  if (rooms.every((r) => r.change === "unchanged")) return "unchanged";
  return "modified";
}

function fakeOid(seed: string): string {
  let out = "";
  for (let i = 0; out.length < 40; i++) out += hashString(`${seed}#${i}`).toString(16).padStart(8, "0");
  return out.slice(0, 40);
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
