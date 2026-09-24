import type { BuildingDiff, ChangeKind, Floor, Layer, Pipe, Room } from "../model";
import type { LayoutResult } from "./types";
import { idResolver, pipeId } from "./universe";

// Per-snapshot visual state: given the (stable) layout and one BuildingDiff, which rooms, pipes and
// floors are present, how big each room is on the viewed side, and which are ghosted or muted.
// Pure, like the layout; colours and materials are the renderer's business.

export type Side = "base" | "head";
export type PipeMode = "changed" | "all";

export interface ViewOptions {
  side: Side;
  layers: Record<Layer, boolean>;
  pipeMode: PipeMode;
}

export const DEFAULT_VIEW: Readonly<ViewOptions> = {
  side: "head",
  layers: { pushed: true, committed: true, uncommitted: true },
  pipeMode: "changed",
};

/** Smallest room box side, so one-line functions stay visible and pickable. */
export const MIN_ROOM_SIDE = 0.15;

/** Centre x/z, bottom y. */
export interface Box {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
}

export interface RoomState {
  id: string;
  floorId: string;
  /** The room is in this snapshot. */
  present: boolean;
  room: Room | null;
  floor: Floor | null;
  change: ChangeKind;
  layer: Layer | null;
  isContext: boolean;
  /** Doesn't exist on the viewed side (added, seen from base; removed, seen from head). */
  ghost: boolean;
  /** Changed, but in a layer that is filtered out. */
  muted: boolean;
  /** Lines of code shown: the viewed side's size, or the other side's for a ghost. */
  size: number;
  box: Box;
}

export interface PipeState {
  id: string;
  from: string;
  to: string;
  present: boolean;
  change: Pipe["change"];
  ghost: boolean;
  /** Visible under the current pipe mode and layer filters (hover can still reveal it). */
  shown: boolean;
  upward: boolean;
}

export interface FloorState {
  id: string;
  present: boolean;
  floor: Floor | null;
  change: ChangeKind | null;
}

export interface SceneState {
  rooms: RoomState[];
  pipes: PipeState[];
  floors: FloorState[];
  roomById: Map<string, RoomState>;
}

export function deriveState(layout: LayoutResult, diff: BuildingDiff, view: ViewOptions): SceneState {
  const resolve = idResolver(diff, layout.canonical);

  const inDiff = new Map<string, { room: Room; floor: Floor }>();
  const floorsInDiff = new Map<string, Floor>();
  for (const f of diff.floors) {
    floorsInDiff.set(f.id, f);
    for (const r of f.rooms) {
      const id = resolve(r.id);
      if (id !== undefined) inDiff.set(id, { room: r, floor: f });
    }
  }

  const rooms: RoomState[] = layout.rooms.map((l) => {
    const hit = inDiff.get(l.id);
    const cx = (l.cell.x0 + l.cell.x1) / 2;
    const cz = (l.cell.z0 + l.cell.z1) / 2;
    if (!hit) {
      return {
        id: l.id,
        floorId: l.floorId,
        present: false,
        room: null,
        floor: null,
        change: "unchanged",
        layer: null,
        isContext: false,
        ghost: false,
        muted: false,
        size: 0,
        box: { x: cx, y: l.y, z: cz, width: 0, height: l.height, depth: 0 },
      };
    }
    const { room, floor } = hit;
    const own = view.side === "head" ? room.headSize : room.baseSize;
    const other = view.side === "head" ? room.baseSize : room.headSize;
    const ghost = own === null;
    const size = Math.max(1, own ?? other ?? 1);
    const scale = Math.sqrt(Math.min(1, size / l.capacity));
    const layer = room.layer ?? null;
    const changed = room.change !== "unchanged";
    return {
      id: l.id,
      floorId: l.floorId,
      present: true,
      room,
      floor,
      change: room.change,
      layer,
      isContext: room.isContext,
      ghost,
      muted: changed && layer !== null && !view.layers[layer],
      size,
      box: {
        x: cx,
        y: l.y,
        z: cz,
        width: Math.max(MIN_ROOM_SIDE, (l.cell.x1 - l.cell.x0) * scale),
        height: l.height,
        depth: Math.max(MIN_ROOM_SIDE, (l.cell.z1 - l.cell.z0) * scale),
      },
    };
  });
  const roomById = new Map(rooms.map((r) => [r.id, r]));

  // A rename can make a removed base call and an added head call collapse onto the same pipe;
  // together they are an unchanged call.
  const pipeChange = new Map<string, Pipe["change"]>();
  for (const p of diff.pipes) {
    const from = resolve(p.from);
    const to = resolve(p.to);
    if (from === undefined || to === undefined || from === to) continue;
    const id = pipeId(from, to);
    const prev = pipeChange.get(id);
    pipeChange.set(id, prev === undefined || prev === p.change ? p.change : "unchanged");
  }

  const active = (id: string) => {
    const r = roomById.get(id);
    return r !== undefined && r.present && r.change !== "unchanged" && !r.muted;
  };

  const pipes: PipeState[] = layout.pipes.map((l) => {
    const change = pipeChange.get(l.id);
    const present = change !== undefined;
    const ghost =
      present && ((view.side === "head" && change === "removed") || (view.side === "base" && change === "added"));
    return {
      id: l.id,
      from: l.from,
      to: l.to,
      present,
      change: change ?? "unchanged",
      ghost,
      shown: present && (view.pipeMode === "all" || active(l.from) || active(l.to)),
      upward: l.upward,
    };
  });

  const floors: FloorState[] = layout.floors.map((l) => {
    const floor = floorsInDiff.get(l.id) ?? null;
    return { id: l.id, present: floor !== null, floor, change: floor?.change ?? null };
  });

  return { rooms, pipes, floors, roomById };
}
