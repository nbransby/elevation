import type { FloorState, PipeState, RoomState } from "../layout";
import { changeColor, type Palette } from "./palette";

// Visual rules: which colour, fill pattern and opacity each state gets.
// Rooms: added = green, removed = red, modified = amber, context = light grey.
// Layer: solid = pushed, hatched = committed, outline-only = uncommitted.
// Pipes: solid if added, dashed when ghosted (removed, seen from head), faint if unchanged,
// violet if running upward inside a cycle.

export interface RoomLook {
  fill: number;
  fillOpacity: number;
  /** 0..1 strength of the committed-layer hatching. */
  hatch: number;
  edge: number;
  edgeOpacity: number;
}

export interface PipeLook {
  color: number;
  opacity: number;
  dashed: boolean;
}

export interface FloorLook {
  opacity: number;
  edge: number;
}

export function roomLook(s: RoomState, p: Palette): RoomLook {
  if (!s.present) return { fill: p.unchanged, fillOpacity: 0, hatch: 0, edge: p.ink, edgeOpacity: 0 };
  if (s.change === "unchanged") {
    return { fill: p.unchanged, fillOpacity: 0.95, hatch: 0, edge: p.ink, edgeOpacity: 0.3 };
  }
  const c = changeColor(p, s.change);
  if (s.muted) return { fill: mix(c, p.unchanged, 0.7), fillOpacity: 0.5, hatch: 0, edge: p.ink, edgeOpacity: 0.15 };
  if (s.ghost) return { fill: c, fillOpacity: 0.1, hatch: 0, edge: c, edgeOpacity: 0.55 };
  switch (s.layer) {
    case "committed":
      return { fill: c, fillOpacity: 1, hatch: 1, edge: p.ink, edgeOpacity: 0.75 };
    case "uncommitted":
      return { fill: c, fillOpacity: 0.16, hatch: 0, edge: c, edgeOpacity: 1 };
    default:
      return { fill: c, fillOpacity: 1, hatch: 0, edge: p.ink, edgeOpacity: 0.75 };
  }
}

export function pipeLook(s: PipeState, p: Palette): PipeLook {
  const color = s.upward
    ? p.upward
    : s.change === "added"
      ? p.added
      : s.change === "removed"
        ? p.removed
        : p.pipeUnchanged;
  const opacity = !s.present ? 0 : s.ghost ? 0.6 : s.change === "unchanged" ? 0.4 : 0.95;
  return { color, opacity, dashed: s.ghost };
}

/** Opacity a pipe gets when revealed by hovering one of its rooms, whatever the pipe mode. */
export function revealedOpacity(s: PipeState): number {
  return !s.present ? 0 : s.ghost ? 0.7 : 1;
}

export function floorLook(s: FloorState, p: Palette): FloorLook {
  if (!s.present) return { opacity: 0, edge: p.slabEdge };
  if (s.change === "removed") return { opacity: 0.35, edge: p.removed };
  if (s.change === "added") return { opacity: 1, edge: p.added };
  return { opacity: 1, edge: p.slabEdge };
}

/** Linear blend of two sRGB hex colours, good enough for UI tints. */
export function mix(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 0xff;
  const lerp = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
  return (lerp(16) << 16) | (lerp(8) << 8) | lerp(0);
}
