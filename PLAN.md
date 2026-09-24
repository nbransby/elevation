# Elevation — build plan (PoC)

Working name: **Elevation** (after the architect's drawing of a building seen from one side). A 3D, sketch-style view of a code change, shown to the user each time a Claude Code agent finishes a turn. Classes that depend on each other form a building, and independent groups of classes stand as separate buildings. Each class is a floor (higher floors depend on lower floors), each function is a room sized by its length, and pipes between rooms show function calls. The main interaction is two-finger trackpad gestures to zoom and rotate.

It's delivered as a **Claude Code plugin plus a hosted viewer**. A `Stop` hook runs an indexer inside the session's environment (local or cloud), and the indexer uploads a `BuildingDiff` to the service. The user keeps the viewer open in the desktop app's Browser pane or in any browser tab, and it updates live after every turn.

The PoC supports **TypeScript/JavaScript only**. This repository is itself TypeScript, so the project is **dogfooded from M6 onwards**: every change to Elevation is viewed in Elevation.

The **first deliverable is a standalone viewer prototype on hardcoded mock data** (M0). It exists so rendering, layout and interaction can be iterated on quickly before any git, language analysis, service or plugin work.

This plan is written for a Claude Code session. Work through the milestones in order. Commit at the end of each one, and don't start the next until its acceptance criteria pass.

---

## 1. Scope

**In scope for the PoC**
- TypeScript and JavaScript (`.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`) only.
- Claude Code sessions in the CLI, the desktop app (local and SSH), and cloud sessions.
- Changes on the session's branch in three layers, shown together: **pushed** (merge-base with the default branch → upstream), **committed** (upstream → HEAD) and **uncommitted** (HEAD → working tree, including untracked files that aren't ignored).
- Scenes of up to about 500 rooms: the changed functions plus their direct (1-hop) callers and callees.
- A dogfooding harness that runs the whole pipeline against this repository.

**Out of scope for the PoC**
- Other languages (see section 7), a custom Claude Code pane (plugins can't add one), whole-repo views, editing code from the viewer, teams and sharing.

## 2. Architecture

```
Claude Code session (local or cloud)
  Stop hook ─► spawns indexer in the background (hook returns immediately)
                 ├─ git: merge-base, upstream, HEAD, working tree
                 ├─ TypeScript language service: structure + call hierarchy
                 └─ POST BuildingDiff ─► service ─► SSE ─► viewer (Browser pane or browser tab)
```

- **The indexer runs where the code is.** A hook runs inside the session's environment, so it has native git and the real working tree.
- **The hook must not slow Claude down.** It spawns the indexer as a detached background process and exits at once. If a newer turn finishes while an older run is still going, the older run is cancelled.
- **The service is small.** An upload endpoint, storage of the latest diffs per session, SSE for live updates, and static hosting for the viewer. The same service runs locally for development and dogfooding.
- **One viewer serves every surface.** Viewer URL: `<service>/s/<sessionId>`.
- **The `BuildingDiff` schema is the contract between the indexer, service and viewer.** Validate with zod at both ends.

## 3. Repository layout

pnpm workspaces, TypeScript everywhere, Vitest for tests.

```
packages/
  schema/     # zod schema + TS types for BuildingDiff (single source of truth)
  indexer/    # Node CLI `elevation index`: git snapshots, TS analysis, diffing, matching, output/upload
  service/    # Hono + SQLite: upload API, auth tokens, SSE, serves the viewer
  viewer/     # Vite + TypeScript + three.js, no UI framework
plugin/       # the Claude Code plugin: .claude-plugin/plugin.json, hooks/hooks.json, bundled indexer
dogfood/      # harness scripts, pinned-commit list, golden outputs
fixtures/
  ts-small/   # tiny git repo with scripted commits (base, pushed, local commits, uncommitted edits)
.claude/
  launch.json # starts the local service so the desktop Browser pane shows the viewer (see M6)
```

## 4. Data model (`packages/schema`)

```ts
type ChangeKind = "added" | "removed" | "modified" | "unchanged";
type Layer = "pushed" | "committed" | "uncommitted";

interface BuildingDiff {
  version: 1;
  session: { id: string; turn: number; createdAt: string };
  repo: { name: string; branch: string; defaultBranch: string;
          baseOid: string; upstreamOid: string | null; headOid: string; dirty: boolean };
  stats: { files: number; rooms: number; pipes: number; unresolvedCalls: number; indexMs: number };
  floors: Floor[];                  // flat list; the viewer derives buildings and floor order
  pipes: Pipe[];                    // call edges
}

interface Floor {                   // a class, or a module floor for a file's top-level functions
  id: string;                       // `${path}::${Class}` or `${path}::<module>`
  kind: "class" | "module";
  name: string;
  path: string;
  change: ChangeKind;
  rooms: Room[];
}

interface Room {                    // a function or method
  id: string;                       // stable: `${path}::${Class}.${name}` or `${path}::${name}`
  name: string;
  change: ChangeKind;               // base → working tree, overall
  layer?: Layer;                    // the latest layer that changed this room
  baseSize: number | null;          // non-blank lines of code; null if the room didn't exist
  headSize: number | null;          // size in the working tree
  baseSource?: string;              // function text, changed rooms only, for the merge view
  headSource?: string;
  aliases?: string[];               // previous IDs when a rename or move was detected
  isContext: boolean;               // true = unchanged neighbour pulled in for context
}

interface Pipe {
  from: string; to: string;
  change: "added" | "removed" | "unchanged";
  precise: boolean;                 // always true in the PoC; reserved for heuristic edges in other languages
}
```

Rules:
- Output must be deterministic: the same inputs produce byte-identical JSON (sorted arrays, no timestamps outside `session`).
- IDs must be deterministic, so the same function gets the same ID in every snapshot.
- Floor IDs include the file path, so two classes with the same name in different files stay separate floors.
- A file's top-level functions share one module floor. Files with no top-level functions get no module floor.
- A room counts as `modified` if its normalised body text differs between two snapshots. `layer` is the last layer in which it differs.
- A rename or move is detected when a removed room and an added room have body similarity of 0.8 or higher. Store it as a single `modified` room with its head ID, and record the old ID in `aliases`.

## 5. Milestones

### M0 — Prototype viewer on mock data (first deliverable)
A standalone viewer with hardcoded mock data, for fast iteration on rendering, layout and interaction. No git, no TypeScript analysis, no language servers, no WASM, no service, no database, no plugin, no network calls.

- **Stack:** Vite + TypeScript + three.js + d3-hierarchy + Vitest. Nothing else.
- **Where it lives:** `packages/viewer`, organised so the code carries forward unchanged:
  - `src/model.ts`: the `BuildingDiff` types from section 4 as plain TypeScript. M2 moves them into `packages/schema` and adds zod.
  - `src/layout/`: pure functions from `BuildingDiff` to a layout result (buildings, floor positions, room rectangles, pipe polylines). No three.js imports.
  - `src/render/`: three.js scene building from the layout result.
  - `src/controls/`: the camera controller.
  - `src/mock/`: scenarios as TypeScript modules exporting `BuildingDiff` objects.
- **Mock scenarios**, chosen from a dropdown and a `?scenario=` URL parameter:
  1. One class with a few rooms.
  2. Two unrelated classes (two buildings).
  3. A dependency chain A→B→C.
  4. A diamond (two floors depending on one shared floor).
  5. A two-class cycle, and a three-class cycle inside a larger building.
  6. Every change kind and all three layers, plus context rooms and a renamed room.
  7. A wide floor with 40 rooms of very different sizes.
  8. A tall building with 15 floors.
  9. A stress scenario generated from a seeded random number generator: about 500 rooms and 800 pipes.
  10. A sequence of turns (several `BuildingDiff`s in order) where rooms grow, appear, disappear and change layer, with a "Next turn" button to step through them and test transitions.
- **Developer controls** in a small panel built from plain HTML inputs: pipes shown for changed rooms only or for all rooms, and sliders for layout parameters (floor height, gaps, riser count, label threshold). A debug overlay shows frame rate, object counts and layout time.

**Layout and rendering**
- Layout, which must be deterministic and pure so it can be unit-tested:
  - Build the floor dependency graph: floor A depends on floor B if any room on A calls a room on B. Use the union of pipes across all snapshots so buildings and floor order stay stable.
  - Buildings are the weakly connected components of that graph. Floors with no dependencies in either direction are single-floor buildings. No pipe ever crosses between buildings.
  - Floor order within a building: higher floors depend on lower floors. Assign each floor a level by longest path from the floors it depends on (level 0 = depends on nothing within the building), then stack by level. Break ties within a level by path, then name, one floor per storey.
  - Cycles: collapse each strongly connected component (Tarjan), order the collapsed graph as above, and stack the cycle's members on adjacent floors. Draw the pipes that run upward within a cycle in a distinct style.
  - Every floor in a building shares that building's footprint, sized to its largest floor. Each floor is a squarified treemap (d3-hierarchy) of its rooms, sized by `max(baseSize, headSize)`.
  - Place buildings in a row, tallest first, then by the path of the ground floor.
  - Pipes are orthogonal polylines through a few riser shafts in the building core, each a `TubeGeometry`. Calls between rooms on the same floor run along the floor.
  - Label each floor with its name and file path.
- Rendering: three.js with one mesh per room and per pipe, flat shading, and `EdgesGeometry` outlines for the sketch look.
  - Rooms: added = green, removed = red (ghosted), modified = amber, context = light grey. The layer is shown as a fill pattern or badge: solid = pushed, hatched = committed, outline-only = uncommitted.
  - Pipes: solid if added, dashed or ghosted if removed, faint if unchanged, and a distinct colour for upward (cycle) pipes.
- Labels: `CSS2DRenderer`, shown only when the room's on-screen size is above a threshold.
- Transitions: when the data changes (base/head toggle, next turn), rooms tween to their new size and colour, and pipes fade in or out. The camera never resets.

**Interaction**
- Custom camera controller. Don't use OrbitControls.
  - `wheel` with `ctrlKey` (trackpad pinch) zooms toward the cursor.
  - `wheel` without a modifier (two-finger scroll) orbits: `deltaX` controls yaw, `deltaY` controls pitch, and pitch is clamped.
  - `wheel` with `shiftKey` pans.
  - In Safari, the `gesturechange` event's `rotation` adds yaw as a bonus.
  - Register the listener with `{ passive: false }` and call `preventDefault()`. Normalise `deltaMode`, and damp the motion.
- Hovering a room highlights it and its pipes and dims everything else. By default, show pipes only for changed rooms.
- Clicking a room opens a side panel showing its base and working-tree source side by side (plain `<pre>` blocks in M0; CodeMirror comes in M7).
- Layer filters (pushed / committed / uncommitted) and a base/head toggle.

**Accept:**
- `pnpm dev` in `packages/viewer` renders every scenario with no backend and no network requests.
- Layout unit tests cover: two unrelated classes become two buildings; a chain A→B→C stacks C at the bottom and A at the top; a diamond puts its shared dependency at the bottom; a cycle lands on adjacent floors with its upward pipes flagged; the turn sequence moves no existing floor or room between turns.
- The stress scenario lays out in under 50 ms and renders at 60 fps on a MacBook.
- Manual check of trackpad controls in Chrome and Safari. Controller unit tests feed synthetic wheel events and check the resulting camera state.

### M1 — Spike: confirm the Claude Code integration points
This is a go/no-go gate. Record the findings in `SPIKE.md`.
- In the CLI, a desktop local session and a cloud session (with the plugin enabled on the claude.ai account so it syncs), confirm that a `Stop` hook fires once per finished turn, and record the exact JSON it receives on stdin.
- Confirm a hook can spawn a detached background process that outlives the hook.
- Find a user-visible way to show the viewer URL once per session, for example a `SessionStart` hook's user-facing message. Confirm what's displayed in each surface.
- In a cloud session, confirm Node is available and the environment's network access can reach an external service. Record the configuration needed.
- Confirm `claude --plugin-dir ./plugin` loads a local plugin for development.
- Confirm the desktop Browser pane opens a localhost URL from `.claude/launch.json` and an external viewer URL.

**Accept:** `SPIKE.md` answers each point. If any is no-go, stop and report before changing the plan.

### M2 — Scaffolding, schema and fixtures
- Turn the repo into a pnpm workspace around the existing `packages/viewer`, with shared TS config, lint and Vitest.
- Create the `schema` package: move `packages/viewer/src/model.ts` into it and add the zod schema. Validate every M0 mock scenario against it in a test.
- Create a script that builds `fixtures/ts-small` as a git repo with a bare "remote": a base on `main`; a branch with pushed commits; further local commits; and uncommitted edits plus an untracked file. Together the changes add, remove, modify and rename functions and add and remove calls, across all three layers.

**Accept:** `pnpm test` passes, and the fixture script produces a repo with a known diff in each layer.

### M3 — Indexer: git snapshots and changed files
- `elevation index [--repo <dir>] [--base <ref>] [--head <ref|WORKTREE>] [--out <file>] [--upload <url>]`. Defaults: base = merge-base with the default branch, head = working tree.
- Resolve the default branch (`origin/HEAD`, falling back to `main`, then `master`), the merge-base, the upstream (if any) and HEAD.
- Read four snapshots: base, upstream and HEAD through `git show`, and the working tree from disk. Changed files are those differing in any snapshot, plus untracked non-ignored source files (`git ls-files --others --exclude-standard`).
- Cache per `(repo, snapshot OID)` so repeated runs only re-read what changed.

**Accept:** on the fixture, changed files and their layers match what the fixture script created. `--head <ref>` works, so any two commits can be compared (the dogfood replay in M6 depends on this).

### M4 — TypeScript: structure
- Use the TypeScript language service. Build one program per snapshot, sharing unchanged files. Honour the repo's `tsconfig.json` files, including project references in a monorepo like this one.
- Extract classes, methods, functions, arrow functions assigned to consts, and line ranges. Build floors and rooms, computing change kinds, layers, sizes, rename matching and source text.

**Accept:** snapshot tests show the expected change kind and layer for every room in the fixture.

### M5 — TypeScript: call edges and context
- Callees: `prepareCallHierarchy` and `provideCallHierarchyOutgoingCalls` on each changed room in the base and working-tree programs. Diff the edge sets into added, removed and unchanged pipes.
- Callers: `provideCallHierarchyIncomingCalls` on each changed room in the working tree, adding callers as context rooms. One hop only.
- Count unresolved calls in `stats`.

**Accept:** fixture snapshot tests cover the pipes. Indexing a PR-sized change in this repository takes under 10 seconds warm.

### M6 — Dogfooding harness
From this milestone on, Elevation is used to review its own changes. The viewer already exists from M0, so the harness feeds it real data straight away and every later milestone is developed against it.
- **`pnpm dogfood`**: runs the indexer on this repository's working tree, writes `.elevation/latest.json` (gitignored), and serves it from a local dev server. The viewer gains a `?source=local` data source that loads it and reloads when it changes, reusing the M0 transitions. In watch mode (`pnpm dogfood --watch`) it re-runs on file saves and on changes to `.git/HEAD` and refs, simulating a `Stop` hook after every turn.
- **Browser pane integration**: `.claude/launch.json` starts the local dev service, so a Claude Code desktop session working on this repo shows its own changes in the Browser pane. Claude can also screenshot the pane to check viewer changes it makes.
- **History replay**: `pnpm dogfood:replay [--last N]` walks this repository's own commits pairwise (each commit against its parent, plus each milestone's commits as a whole) and checks invariants on every result:
  1. The output validates against the schema.
  2. Running twice on the same inputs gives byte-identical output.
  3. Every pipe's `from` and `to` refer to rooms that exist, and no room ID is duplicated.
  4. Room IDs are stable: a function unchanged between consecutive commits keeps the same ID.
  5. Layout is stable: running the M0 layout functions (importable in Node, since they don't touch three.js) on base and head moves no floor or room.
  6. Indexing time stays within the budget; report the slowest commits.
- **Goldens**: `dogfood/pinned.txt` lists a few commit pairs from this repo. Their outputs are committed under `dogfood/golden/` and compared in CI; intentional changes are accepted with `pnpm dogfood:accept`.
- **Visual snapshots**: Playwright opens the viewer on each golden in headless Chromium and saves a screenshot, so Claude and reviewers can inspect rendering changes. They're compared with a tolerance, not pixel-exact.
- **Bug capture**: `pnpm dogfood:capture` copies the current `BuildingDiff` and the commit range into `dogfood/cases/<name>/`, so a bad result seen while dogfooding becomes a regression test.

**Accept:** `pnpm dogfood --watch` updates `.elevation/latest.json` within 5 seconds of saving a file in this repo. Replay over the repo's full history passes all invariants. Goldens run in CI.

### M7 — Viewer on real data
- Load the latest diff for a session from the service (M6's dev server until M8) and subscribe to SSE. A new diff uses the M0 transitions without resetting the camera.
- Replace the plain source panel with a CodeMirror 6 merge view (`@codemirror/merge`) of base versus working tree for the clicked function.
- A scrubber over the session's recent turns.
- Keep the mock scenarios available behind `?scenario=` for layout and rendering work.
- Fix any layout or rendering problems found on real data by first adding the case as a mock scenario, then fixing it there.

**Accept:** the fixture and the dogfood goldens render correctly, and the merge view shows the right function. Manual check in the desktop Browser pane while dogfooding.

### M8 — Service
- Hono app with SQLite. Endpoints: `POST /api/sessions/:id/diffs` (bearer token), `GET /api/sessions/:id/diffs/latest`, `GET /api/sessions/:id/events` (SSE), and static hosting of the viewer at `/s/:id`.
- Tokens: a user signs in (GitHub OAuth) and creates an upload token. Viewing a session requires being signed in as the token's owner. In local dev mode, auth is off and the service binds to localhost only.
- Keep the last 20 diffs per session for the scrubber; delete sessions after 30 days.
- Replace the M6 dev server with this service in local mode, so dogfooding exercises the real upload and SSE path.

**Accept:** integration tests cover upload, auth failures, SSE delivery and retention. Dogfooding still works end to end.

### M9 — Plugin packaging
- `plugin/` contains `.claude-plugin/plugin.json`, `hooks/hooks.json` and the bundled indexer (a single Node file built with esbuild, so there's no install step).
- `Stop` hook: spawn the indexer detached with the session ID and working directory, then exit 0.
- `SessionStart` hook: show the viewer URL for the session, using the mechanism found in M1.
- Configuration: `userConfig` with a sensitive `upload_token` and a `service_url`. For cloud sessions, also read `ELEVATION_TOKEN` and `ELEVATION_URL` from the cloud environment's variables, and document the environment's network allowlist entry.
- **Dogfood through the plugin**: develop this repo in Claude Code with `claude --plugin-dir ./plugin` and `service_url` pointing at the local service, so the plugin path is exercised on every turn of real work.

**Accept:** with the plugin installed, a session in each of the three surfaces updates the open viewer within 10 seconds of each finished turn, including sessions working on this repository.

## 6. Conventions for the session
- Put diffing, matching, layer assignment and layout in pure functions with unit tests. Keep three.js, git and TypeScript-service code thin and behind interfaces.
- Run `pnpm test` and `pnpm dogfood:replay --last 20` before every commit from M6 onwards.
- When something looks wrong while dogfooding, capture it with `pnpm dogfood:capture` before fixing it.
- Don't add dependencies beyond: typescript, zod, three, d3-hierarchy, @codemirror/*, hono, better-sqlite3, esbuild, vite, vitest, playwright.
- Update this file's milestone checkboxes as work completes, and note any deviations with a one-line reason.
- If something in this plan turns out to be wrong, such as an API not behaving as described, stop and explain the problem rather than working around it silently.

## 7. After the PoC
- **More languages**, starting with Kotlin and Swift: structure from tree-sitter (WASM grammars), call edges from installed language servers (`kotlin-lsp`, `sourcekit-lsp`) with name-based heuristic edges marked `precise: false` when no server is available. Kotlin extension functions stay on their file's module floor; Swift extensions join the type's floor within the same file. The `precise` field on pipes and the adapter boundary in the indexer are there for this.
- A local-only mode where the plugin serves the viewer on localhost, for users who don't want to upload source text.

## 8. Open questions (defaults in brackets)
- Uploading source text to a hosted service [only changed functions' text].
- Room size metric [non-blank LOC].
- Whether floors share one footprint [shared, for a clean building silhouette].
- A floor for interfaces and types [none; types aren't rooms].
- What counts as a dependency [calls only, matching the pipes; inheritance, construction and type references later].
- Very tall buildings [collapse context-only floors into a single summary floor].
