// Layout result types. Everything here is plain data: no three.js, so the layout can run and be
// tested in Node (the M6 dogfood replay imports it to check layout stability).

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface LayoutParams {
  /** Storey height: slab to slab. */
  floorHeight: number;
  /** Room box height as a fraction of the storey height. The space above is the pipe plenum. */
  roomHeightRatio: number;
  slabThickness: number;
  /** Gap between rooms inside a floor, and between the rooms and the floor edge. */
  roomGap: number;
  /** Gap between buildings in the row. */
  buildingGap: number;
  /** Riser shafts per building. */
  riserCount: number;
  /** World area of one line of code. */
  areaPerLine: number;
  /** Width / depth of a building's room area. Wider than deep reads better in the front elevation. */
  footprintAspect: number;
  pipeRadius: number;
  /** Spacing between pipes that share a riser shaft. */
  laneSpacing: number;
}

/**
 * World coordinates: x runs along the row of buildings, y is up, and each building's front face
 * sits on z = 0 with the building extending towards -z (like buildings on a street).
 */
export interface LayoutResult {
  params: LayoutParams;
  /** In row order (left to right). */
  buildings: BuildingLayout[];
  /** Ordered by building, then storey (bottom to top). */
  floors: FloorLayout[];
  /** Sorted by ID. */
  rooms: RoomLayout[];
  /** Sorted by ID. */
  pipes: PipeLayout[];
  bounds: { min: Vec3; max: Vec3 };
  /** Every room ID seen across the snapshots → its canonical ID (renames within a floor are unified). */
  canonical: Map<string, string>;
  floorById: Map<string, FloorLayout>;
  roomById: Map<string, RoomLayout>;
  pipeById: Map<string, PipeLayout>;
  /** Pipes dropped because an endpoint is not a known room. */
  danglingPipes: number;
}

export interface BuildingLayout {
  /** The ID of its ground floor. */
  id: string;
  index: number;
  /** Bottom to top, one floor per storey. */
  floorIds: string[];
  /** Left edge of the footprint. */
  x: number;
  /** Full footprint width: room area plus core. */
  width: number;
  depth: number;
  /** Width of the room area; the core strip is to its right. */
  roomsWidth: number;
  height: number;
  core: CoreLayout;
}

/** The service core: a strip along the building's right-hand side holding the riser shafts. */
export interface CoreLayout {
  x: number;
  width: number;
  risers: { x: number; z: number }[];
}

export interface FloorLayout {
  id: string;
  name: string;
  path: string;
  kind: "class" | "module";
  buildingId: string;
  storey: number;
  /** Bottom of the slab. */
  y: number;
  /** Footprint, shared by every floor in the building. */
  x: number;
  z: number;
  width: number;
  depth: number;
  /** Set when the floor is part of a dependency cycle: the IDs of the cycle's members, bottom to top. */
  cycle: string[] | null;
}

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface RoomLayout {
  /** Canonical ID. */
  id: string;
  name: string;
  floorId: string;
  /** Lines of code the cell is sized for: the largest size seen in any snapshot. */
  capacity: number;
  /** Treemap cell in world coordinates (x0 < x1, z0 < z1). */
  cell: Rect;
  /** Room floor level (top of the slab). */
  y: number;
  height: number;
}

export interface PipeLayout {
  /** `${from}->${to}` using canonical room IDs. */
  id: string;
  from: string;
  to: string;
  buildingId: string;
  /** Orthogonal polyline from the caller's roof to the callee's roof. */
  points: Vec3[];
  /** The call runs from a lower floor to a higher one, which only happens inside a cycle. */
  upward: boolean;
  sameFloor: boolean;
  /** Index into the building's risers, or null for same-floor pipes. */
  riser: number | null;
}
