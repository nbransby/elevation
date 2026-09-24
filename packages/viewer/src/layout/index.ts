// Pure layout: BuildingDiff → buildings, floor positions, room rectangles and pipe polylines.
// No three.js here, so it runs in Node too.

export { layoutScene } from "./layout";
export { DEFAULT_LAYOUT_PARAMS } from "./params";
export { deriveState, DEFAULT_VIEW, MIN_ROOM_SIDE } from "./state";
export type { Box, FloorState, PipeMode, PipeState, RoomState, SceneState, Side, ViewOptions } from "./state";
export type * from "./types";
