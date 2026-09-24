// The BuildingDiff contract between the indexer, service and viewer (PLAN.md section 4).
// Plain TypeScript for M0; M2 moves these into packages/schema and adds zod.

export type ChangeKind = "added" | "removed" | "modified" | "unchanged";
export type Layer = "pushed" | "committed" | "uncommitted";

export const LAYERS: readonly Layer[] = ["pushed", "committed", "uncommitted"];

export interface BuildingDiff {
  version: 1;
  session: { id: string; turn: number; createdAt: string };
  repo: {
    name: string;
    branch: string;
    defaultBranch: string;
    baseOid: string;
    upstreamOid: string | null;
    headOid: string;
    dirty: boolean;
  };
  stats: { files: number; rooms: number; pipes: number; unresolvedCalls: number; indexMs: number };
  /** Flat list; the viewer derives buildings and floor order. */
  floors: Floor[];
  /** Call edges. */
  pipes: Pipe[];
}

/** A class, or a module floor for a file's top-level functions. */
export interface Floor {
  /** `${path}::${Class}` or `${path}::<module>` */
  id: string;
  kind: "class" | "module";
  name: string;
  path: string;
  change: ChangeKind;
  rooms: Room[];
}

/** A function or method. */
export interface Room {
  /** Stable: `${path}::${Class}.${name}` or `${path}::${name}` */
  id: string;
  name: string;
  /** Base → working tree, overall. */
  change: ChangeKind;
  /** The latest layer that changed this room. */
  layer?: Layer;
  /** Non-blank lines of code; null if the room didn't exist. */
  baseSize: number | null;
  /** Size in the working tree. */
  headSize: number | null;
  /** Function text, changed rooms only, for the merge view. */
  baseSource?: string;
  headSource?: string;
  /** Previous IDs when a rename or move was detected. */
  aliases?: string[];
  /** True = unchanged neighbour pulled in for context. */
  isContext: boolean;
}

export interface Pipe {
  from: string;
  to: string;
  change: "added" | "removed" | "unchanged";
  /** Always true in the PoC; reserved for heuristic edges in other languages. */
  precise: boolean;
}
