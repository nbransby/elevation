import type { LayoutParams } from "./types";

export const DEFAULT_LAYOUT_PARAMS: Readonly<LayoutParams> = {
  floorHeight: 3,
  roomHeightRatio: 0.45,
  slabThickness: 0.12,
  roomGap: 0.3,
  buildingGap: 10,
  riserCount: 3,
  areaPerLine: 0.5,
  footprintAspect: 1.5,
  pipeRadius: 0.05,
  laneSpacing: 0.16,
};
