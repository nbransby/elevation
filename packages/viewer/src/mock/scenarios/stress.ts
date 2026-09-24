import type { BuildingDiff, Layer, Pipe } from "../../model";
import { buildDiff, type FloorSpec, type PipeSpec, type RoomSpec } from "../builder";
import { createRng } from "../rng";

export const STRESS_ROOMS = 500;
export const STRESS_PIPES = 800;

const AREAS = ["billing", "catalog", "search", "auth", "ui", "infra", "reports", "admin", "misc"];
const NOUNS = ["User", "Order", "Cart", "Item", "Price", "Stock", "Invoice", "Report", "Theme", "Route", "Token", "Query"];
const ROLES = ["Service", "Store", "View", "Controller", "Client", "Cache", "Model", "Mapper"];
const VERBS = ["load", "save", "render", "parse", "sync", "merge", "diff", "apply", "resolve", "track", "emit", "fetch"];
const LAYERS: Layer[] = ["pushed", "committed", "uncommitted"];

/**
 * 9. Stress: seeded random scene of exactly 500 rooms and 800 pipes over several buildings
 * (floor counts 18, 12, 9, 7, 5, 4, 3, 2 and five single-floor buildings), with some cycles.
 */
export function stress(seed = 9): BuildingDiff[] {
  const rng = createRng(seed);
  const buildingSizes = [18, 12, 9, 7, 5, 4, 3, 2, 1, 1, 1, 1, 1];
  const floorCount = buildingSizes.reduce((a, b) => a + b, 0);

  // Room counts per floor, adjusted to hit the total exactly.
  const counts = Array.from({ length: floorCount }, () => rng.int(3, 12));
  let sum = counts.reduce((a, b) => a + b, 0);
  while (sum !== STRESS_ROOMS) {
    const i = rng.int(0, floorCount - 1);
    if (sum < STRESS_ROOMS && counts[i]! < 20) (counts[i]!++, sum++);
    else if (sum > STRESS_ROOMS && counts[i]! > 2) (counts[i]!--, sum--);
  }

  const classNames = NOUNS.flatMap((n) => ROLES.map((r) => `${n}${r}`));
  for (let i = classNames.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [classNames[i], classNames[j]] = [classNames[j]!, classNames[i]!];
  }

  const floors: FloorSpec[] = [];
  const groups: { floors: FloorSpec[]; roomCount: number }[] = [];
  let f = 0;
  buildingSizes.forEach((size, g) => {
    const group: FloorSpec[] = [];
    for (let k = 0; k < size; k++, f++) {
      const name = classNames[f]!;
      const rooms: RoomSpec[] = Array.from({ length: counts[f]! }, (_, j) => {
        const roomName = `${VERBS[j % VERBS.length]}${NOUNS[Math.floor(j / VERBS.length) % NOUNS.length]}`;
        const size = Math.round(3 + Math.exp(rng.next() * 4.2));
        if (!rng.chance(0.3)) return { name: roomName, size };
        const layer = rng.pick(LAYERS);
        const roll = rng.next();
        if (roll < 0.55) return { name: roomName, change: "modified", base: size, head: Math.max(2, Math.round(size * (0.5 + rng.next()))), layer };
        if (roll < 0.8) return { name: roomName, change: "added", size, layer };
        return { name: roomName, change: "removed", size, layer };
      });
      const floor: FloorSpec = { path: `src/${AREAS[g % AREAS.length]}/${name}.ts`, name, rooms };
      group.push(floor);
      floors.push(floor);
    }
    groups.push({ floors: group, roomCount: group.reduce((s, fl) => s + fl.rooms.length, 0) });
  });

  const pipes: PipeSpec[] = [];
  const seen = new Set<string>();
  const change = (): Pipe["change"] => {
    const r = rng.next();
    return r < 0.12 ? "added" : r < 0.2 ? "removed" : "unchanged";
  };
  const add = (a: FloorSpec, b: FloorSpec) => {
    const from = `${a.name}.${rng.pick(a.rooms).name}`;
    const to = `${b.name}.${rng.pick(b.rooms).name}`;
    if (from === to || seen.has(`${from}>${to}`)) return false;
    seen.add(`${from}>${to}`);
    pipes.push([from, to, change()]);
    return true;
  };

  // Each multi-floor building gets a random dependency rank per floor and a spanning set of pipes
  // (so it stays one building), then random calls mostly downhill, some on the same floor, and a
  // few uphill ones that make cycles.
  const ranked = groups
    .filter((g) => g.floors.length > 1)
    .map((g) => {
      const order = [...g.floors];
      for (let i = order.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
      for (let i = 1; i < order.length; i++) while (!add(order[i]!, order[rng.int(0, i - 1)]!));
      return { order, roomCount: g.roomCount };
    });
  const pickGroup = () => {
    const total = ranked.reduce((s, g) => s + g.roomCount, 0);
    let x = rng.next() * total;
    for (const g of ranked) if ((x -= g.roomCount) < 0) return g;
    return ranked[ranked.length - 1]!;
  };
  for (let attempts = 0; pipes.length < STRESS_PIPES && attempts < 100_000; attempts++) {
    const { order } = pickGroup();
    const i = rng.int(0, order.length - 1);
    const roll = rng.next();
    let j: number;
    if (roll < 0.12 || i === 0) j = i;
    else if (roll < 0.15 && i < order.length - 1) j = rng.int(i + 1, order.length - 1);
    else j = rng.int(0, i - 1);
    add(order[i]!, order[j]!);
  }

  return [buildDiff({ scenario: "stress", floors, pipes, unresolvedCalls: 17 })];
}
