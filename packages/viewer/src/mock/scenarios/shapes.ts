import type { BuildingDiff, ChangeKind, Layer } from "../../model";
import { buildDiff, type PipeSpec, type RoomSpec } from "../builder";
import { createRng } from "../rng";

const VERBS = ["load", "save", "render", "parse", "sync", "merge", "diff", "apply", "resolve", "track"];
const NOUNS = ["User", "Order", "Cart", "Item", "Price", "Stock", "Invoice", "Report", "Theme", "Route"];

/** 7. A wide floor: 40 rooms whose sizes range from 1 to 400 lines. */
export function wideFloor(): BuildingDiff[] {
  const rng = createRng(7);
  const count = 40;
  const sizes = Array.from({ length: count }, (_, i) => Math.round(400 ** (i / (count - 1))));
  // Deterministic shuffle so sizes aren't sorted by name.
  for (let i = sizes.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [sizes[i], sizes[j]] = [sizes[j]!, sizes[i]!];
  }
  const kinds: ChangeKind[] = ["unchanged", "unchanged", "modified", "added", "removed"];
  const layers: Layer[] = ["pushed", "committed", "uncommitted"];
  const rooms: RoomSpec[] = sizes.map((size, i) => {
    const name = `${VERBS[i % VERBS.length]}${NOUNS[Math.floor(i / VERBS.length) % NOUNS.length]}`;
    const change = kinds[i % kinds.length]!;
    if (change === "modified") {
      return { name, change, base: size, head: Math.max(2, Math.round(size * (0.6 + rng.next()))), layer: layers[i % 3] };
    }
    return { name, change, size: Math.max(2, size), layer: change === "unchanged" ? undefined : layers[i % 3] };
  });
  const pipes: PipeSpec[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 30; i++) {
    const a = rooms[rng.int(0, count - 1)]!.name;
    const b = rooms[rng.int(0, count - 1)]!.name;
    if (a === b || seen.has(`${a}>${b}`)) continue;
    seen.add(`${a}>${b}`);
    pipes.push([`LegacyController.${a}`, `LegacyController.${b}`, rng.pick(["unchanged", "added", "removed"] as const)]);
  }
  return [
    buildDiff({
      scenario: "wide-floor",
      floors: [{ path: "src/legacy/LegacyController.ts", name: "LegacyController", rooms }],
      pipes,
    }),
  ];
}

/** 8. A tall building: 15 floors, each depending on the one below and some further down. */
export function tallBuilding(): BuildingDiff[] {
  const rng = createRng(8);
  const names = [
    "HttpServer", "Router", "Middleware", "AuthGuard", "SessionStore", "Controller", "Service", "Validator",
    "Repository", "QueryBuilder", "ConnectionPool", "Driver", "Socket", "ByteBuffer", "Clock",
  ];
  const floors = names.map((name, i) => {
    const n = rng.int(2, 5);
    const rooms: RoomSpec[] = Array.from({ length: n }, (_, j) => {
      const roomName = `${VERBS[(i + j) % VERBS.length]}${j}`;
      if (j === 0 && i % 2 === 0) return { name: roomName, change: "modified", base: rng.int(5, 30), head: rng.int(5, 40), layer: (["pushed", "committed", "uncommitted"] as const)[i % 3] };
      return { name: roomName, size: rng.int(3, 35) };
    });
    return { path: `src/stack/${name}.ts`, name, rooms };
  });
  const pipes: PipeSpec[] = [];
  for (let i = 0; i < names.length - 1; i++) {
    const a = floors[i]!;
    const b = floors[i + 1]!;
    pipes.push([`${a.name}.${a.rooms[0]!.name}`, `${b.name}.${b.rooms[0]!.name}`]);
    if (i + 3 < names.length && i % 3 === 0) {
      const c = floors[i + 3]!;
      pipes.push([`${a.name}.${a.rooms[1]!.name}`, `${c.name}.${c.rooms[1]!.name}`, "added"]);
    }
  }
  return [buildDiff({ scenario: "tall-building", floors, pipes })];
}
