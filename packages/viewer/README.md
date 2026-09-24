# @elevation/viewer

The Elevation viewer: a 3D, sketch-style view of a code change. Classes are floors, functions are rooms sized by
their length, and pipes are calls. In M0 it runs on hardcoded mock data only, with no backend or network requests.

```sh
pnpm install
pnpm dev          # http://localhost:5173/?scenario=stress
pnpm test         # layout, state, mock and camera-controller tests (Vitest, Node)
pnpm typecheck
pnpm build
```

## Scenarios

Pick one from the dropdown, or with `?scenario=<id or number>` or a bare `#<id>` (the only deep link that reaches the
viewer inside a claude.ai Artifact):

| # | id | |
|---|---|---|
| 1 | `single-class` | One class with a few rooms |
| 2 | `two-buildings` | Two unrelated classes |
| 3 | `chain` | Dependency chain A→B→C |
| 4 | `diamond` | Two floors depending on one shared floor |
| 5 | `cycles` | A two-class cycle, and a three-class cycle inside a larger building |
| 6 | `all-kinds` | Every change kind in every layer, context rooms, a rename |
| 7 | `wide-floor` | 40 rooms of 1–400 lines |
| 8 | `tall-building` | 15 floors |
| 9 | `stress` | Seeded random: 500 rooms, 800 pipes |
| 10 | `turns` | Five turns: rooms grow, appear, disappear, get renamed and change layer (`?turn=3` to start later) |

## Controls

| Input | Action |
|---|---|
| Two-finger scroll | Orbit (horizontal: yaw; vertical: pitch) |
| Pinch (ctrl + wheel) | Zoom toward the cursor |
| Shift + scroll | Pan |
| Two-finger rotate (Safari) | Yaw |
| Drag / right-drag | Orbit / pan (mouse fallback) |
| Hover | Highlight a room and its calls |
| Click | Base and working-tree source side by side |
| `B` | Toggle base / head |
| `N` or `→`, `P` or `←` | Next / previous turn |
| `F` | Frame everything |
| `Esc` | Close the source panel |

The Developer panel switches pipes between changed rooms only and all rooms, and has sliders for the layout parameters
and label threshold. "Render every frame" and "Spin camera" are there for measuring frame rate. The overlay in the top
right shows frame rate, draw calls, object counts and layout time.

## Layout

- `src/model.ts`: the `BuildingDiff` contract (PLAN.md section 4).
- `src/layout/`: pure and deterministic, with no three.js, so it also runs in Node. `layoutScene(snapshots)` lays out
  the union of all snapshots (for example every turn), so nothing moves when switching between them.
  `deriveState(layout, diff, view)` gives the per-snapshot sizes, ghosts and visibility.
- `src/render/`: three.js objects keyed by ID. Every data change is a tween (size, colour and opacity), and the
  camera is never reset.
- `src/controls/`: the trackpad-first camera controller.
- `src/mock/`: scenario builders.
- `src/ui/`: toolbar, developer panel, debug overlay, source panel and legend, all plain DOM.
