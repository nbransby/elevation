import type { ChangeKind } from "../model";

export interface Palette {
  dark: boolean;
  background: number;
  ground: number;
  grid: number;
  /** Outlines: the pen. */
  ink: number;
  /** The light stripe of hatching. */
  paper: number;
  slab: number;
  slabEdge: number;
  core: number;
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
  pipeUnchanged: number;
  /** Pipes running upward inside a dependency cycle. */
  upward: number;
  highlight: number;
}

export const LIGHT_PALETTE: Palette = {
  dark: false,
  background: 0xf4f0e6,
  ground: 0xebe5d7,
  grid: 0xd6cdb9,
  ink: 0x2f2b26,
  paper: 0xfbf8f1,
  slab: 0xe2dbcc,
  slabEdge: 0x7d7466,
  core: 0xa69c88,
  added: 0x3f9f5a,
  removed: 0xd0504a,
  modified: 0xe39b2d,
  unchanged: 0xd6d1c6,
  pipeUnchanged: 0x6f685c,
  upward: 0x7c5cd6,
  highlight: 0x2563eb,
};

export const DARK_PALETTE: Palette = {
  dark: true,
  background: 0x1c1b19,
  ground: 0x23211e,
  grid: 0x3a3630,
  ink: 0xe9e3d7,
  paper: 0x2a2825,
  slab: 0x3b3732,
  slabEdge: 0x9a9183,
  core: 0x7a7164,
  added: 0x52b86c,
  removed: 0xe2645d,
  modified: 0xf0aa3c,
  unchanged: 0x5d5952,
  pipeUnchanged: 0xa9a194,
  upward: 0xa283f5,
  highlight: 0x60a5fa,
};

export function changeColor(p: Palette, change: ChangeKind): number {
  return change === "unchanged" ? p.unchanged : p[change];
}
