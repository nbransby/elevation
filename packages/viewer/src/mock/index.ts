import type { BuildingDiff } from "../model";
import { chain, cycles, diamond, singleClass, twoBuildings } from "./scenarios/basic";
import { allKinds } from "./scenarios/kinds";
import { tallBuilding, wideFloor } from "./scenarios/shapes";
import { stress } from "./scenarios/stress";
import { turns } from "./scenarios/turns";

export interface Scenario {
  id: string;
  title: string;
  /** One BuildingDiff per turn, in order. Most scenarios have a single turn. */
  build: () => BuildingDiff[];
}

export const SCENARIOS: readonly Scenario[] = [
  { id: "single-class", title: "1 · One class", build: singleClass },
  { id: "two-buildings", title: "2 · Two unrelated classes", build: twoBuildings },
  { id: "chain", title: "3 · Chain A→B→C", build: chain },
  { id: "diamond", title: "4 · Diamond", build: diamond },
  { id: "cycles", title: "5 · Cycles", build: cycles },
  { id: "all-kinds", title: "6 · Every change kind and layer", build: allKinds },
  { id: "wide-floor", title: "7 · Wide floor (40 rooms)", build: wideFloor },
  { id: "tall-building", title: "8 · Tall building (15 floors)", build: tallBuilding },
  { id: "stress", title: "9 · Stress (500 rooms, 800 pipes)", build: stress },
  { id: "turns", title: "10 · Sequence of turns", build: turns },
];

/** Accepts a scenario ID or its 1-based number, as used by `?scenario=`. */
export function findScenario(key: string | null | undefined): Scenario | undefined {
  if (!key) return undefined;
  const n = Number(key);
  if (Number.isInteger(n) && n >= 1 && n <= SCENARIOS.length) return SCENARIOS[n - 1];
  return SCENARIOS.find((s) => s.id === key);
}
