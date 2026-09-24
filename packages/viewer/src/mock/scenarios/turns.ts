import type { BuildingDiff } from "../../model";
import { buildDiff, type FloorSpec, type PipeSpec } from "../builder";

// 10. A sequence of turns in one session. Across the turns rooms grow, appear, disappear, get
// renamed and move from uncommitted to committed to pushed.

const S = "turns";
const LIST = "src/todo/TodoList.ts";
const STORE = "src/todo/TodoStore.ts";
const API = "src/todo/api.ts";
const FILTER = "src/todo/Filter.ts";

export function turns(): BuildingDiff[] {
  const t1: FloorSpec[] = [
    {
      ref: "List",
      path: LIST,
      name: "TodoList",
      rooms: [
        { name: "add", change: "modified", base: 12, head: 14 },
        { name: "remove", size: 9 },
        { name: "render", size: 18 },
      ],
    },
    {
      ref: "Store",
      path: STORE,
      name: "TodoStore",
      rooms: [
        { name: "save", change: "modified", base: 10, head: 13 },
        { name: "legacySync", size: 16 },
      ],
    },
    { ref: "api", path: API, kind: "module", rooms: [{ name: "fetchTodos", size: 11 }] },
  ];
  const p1: PipeSpec[] = [
    ["List.add", "Store.save"],
    ["List.remove", "Store.save"],
    ["Store.save", "api.fetchTodos"],
  ];

  // Turn 2: `add` grows, `toggle` appears with a new call, `legacySync` is pulled in as context.
  const t2: FloorSpec[] = [
    {
      ref: "List",
      path: LIST,
      name: "TodoList",
      rooms: [
        { name: "add", change: "modified", base: 12, head: 22 },
        { name: "toggle", change: "added", size: 8 },
        { name: "remove", size: 9 },
        { name: "render", size: 18 },
      ],
    },
    {
      ref: "Store",
      path: STORE,
      name: "TodoStore",
      rooms: [
        { name: "save", change: "modified", base: 10, head: 13 },
        { name: "legacySync", size: 16 },
      ],
    },
    { ref: "api", path: API, kind: "module", rooms: [{ name: "fetchTodos", size: 11 }] },
  ];
  const p2: PipeSpec[] = [...p1, ["List.toggle", "Store.save", "added"], ["Store.save", "Store.legacySync"]];

  // Turn 3: the work so far is committed; `legacySync` is deleted (uncommitted) and a new Filter
  // floor appears.
  const t3: FloorSpec[] = [
    {
      ref: "List",
      path: LIST,
      name: "TodoList",
      rooms: [
        { name: "add", change: "modified", base: 12, head: 22, layer: "committed" },
        { name: "toggle", change: "added", size: 10, layer: "committed" },
        { name: "remove", size: 9 },
        { name: "render", change: "modified", base: 18, head: 21 },
      ],
    },
    {
      ref: "Store",
      path: STORE,
      name: "TodoStore",
      rooms: [
        { name: "save", change: "modified", base: 10, head: 13, layer: "committed" },
        { name: "legacySync", change: "removed", size: 16 },
      ],
    },
    { ref: "api", path: API, kind: "module", rooms: [{ name: "fetchTodos", size: 11 }] },
    { ref: "Filter", path: FILTER, name: "Filter", rooms: [{ name: "apply", change: "added", size: 12 }] },
  ];
  const p3: PipeSpec[] = [
    ...p1,
    ["List.toggle", "Store.save", "added"],
    ["Store.save", "Store.legacySync", "removed"],
    ["List.render", "Filter.apply", "added"],
  ];

  // Turn 4: pushed; `remove` is renamed to `delete`, `render` keeps growing.
  const t4: FloorSpec[] = [
    {
      ref: "List",
      path: LIST,
      name: "TodoList",
      rooms: [
        { name: "add", change: "modified", base: 12, head: 22, layer: "pushed" },
        { name: "toggle", change: "added", size: 10, layer: "pushed" },
        { name: "delete", change: "modified", base: 9, head: 11, renamedFrom: "remove" },
        { name: "render", change: "modified", base: 18, head: 27, layer: "committed" },
      ],
    },
    {
      ref: "Store",
      path: STORE,
      name: "TodoStore",
      rooms: [
        { name: "save", change: "modified", base: 10, head: 13, layer: "pushed" },
        { name: "legacySync", change: "removed", size: 16, layer: "pushed" },
      ],
    },
    { ref: "api", path: API, kind: "module", rooms: [{ name: "fetchTodos", size: 11 }] },
    { ref: "Filter", path: FILTER, name: "Filter", rooms: [{ name: "apply", change: "added", size: 15, layer: "committed" }] },
  ];
  const p4: PipeSpec[] = [
    ["List.add", "Store.save"],
    ["List.delete", "Store.save"],
    ["Store.save", "api.fetchTodos"],
    ["List.toggle", "Store.save", "added"],
    ["Store.save", "Store.legacySync", "removed"],
    ["List.render", "Filter.apply", "added"],
  ];

  // Turn 5: the `toggle` feature is reverted, so it disappears; `fetchTodos` is no longer needed
  // as context and disappears too; Filter grows a second room.
  const t5: FloorSpec[] = [
    {
      ref: "List",
      path: LIST,
      name: "TodoList",
      rooms: [
        { name: "add", change: "modified", base: 12, head: 22, layer: "pushed" },
        { name: "delete", change: "modified", base: 9, head: 11, renamedFrom: "remove", layer: "committed" },
        { name: "render", change: "modified", base: 18, head: 27, layer: "committed" },
      ],
    },
    {
      ref: "Store",
      path: STORE,
      name: "TodoStore",
      rooms: [
        { name: "save", change: "modified", base: 10, head: 13, layer: "pushed" },
        { name: "legacySync", change: "removed", size: 16, layer: "pushed" },
      ],
    },
    {
      ref: "Filter",
      path: FILTER,
      name: "Filter",
      rooms: [
        { name: "apply", change: "added", size: 15, layer: "committed" },
        { name: "matches", change: "added", size: 7 },
      ],
    },
  ];
  const p5: PipeSpec[] = [
    ["List.add", "Store.save"],
    ["List.delete", "Store.save"],
    ["Store.save", "Store.legacySync", "removed"],
    ["List.render", "Filter.apply", "added"],
    ["Filter.apply", "Filter.matches", "added"],
  ];

  return [
    buildDiff({ scenario: S, turn: 1, floors: t1, pipes: p1 }),
    buildDiff({ scenario: S, turn: 2, floors: t2, pipes: p2 }),
    buildDiff({ scenario: S, turn: 3, floors: t3, pipes: p3 }),
    buildDiff({ scenario: S, turn: 4, floors: t4, pipes: p4 }),
    buildDiff({ scenario: S, turn: 5, floors: t5, pipes: p5 }),
  ];
}
