import { describe, expect, it } from "vitest";
import { allKinds } from "../mock/scenarios/kinds";
import { DEFAULT_VIEW, deriveState, layoutScene, MIN_ROOM_SIDE } from ".";

const CHECKOUT = "src/checkout/Checkout.ts::Checkout";

describe("deriveState", () => {
  const [diff] = allKinds();
  const layout = layoutScene([diff!]);
  const head = deriveState(layout, diff!, DEFAULT_VIEW);
  const base = deriveState(layout, diff!, { ...DEFAULT_VIEW, side: "base" });

  it("sizes rooms by the viewed side and ghosts rooms that don't exist there", () => {
    const added = head.roomById.get(`${CHECKOUT}.confirm`)!;
    expect(added.ghost).toBe(false);
    expect(base.roomById.get(added.id)!.ghost).toBe(true);

    const removed = head.roomById.get(`${CHECKOUT}.legacyTotals`)!;
    expect(removed.ghost).toBe(true);
    expect(removed.size).toBe(24);
    expect(base.roomById.get(removed.id)!.ghost).toBe(false);

    const shrunk = head.roomById.get(`${CHECKOUT}.applyCoupon`)!; // 22 → 15 lines
    expect(shrunk.size).toBe(15);
    expect(base.roomById.get(shrunk.id)!.size).toBe(22);
    expect(shrunk.box.width).toBeLessThan(base.roomById.get(shrunk.id)!.box.width);
    // The larger side fills the cell.
    const cell = layout.roomById.get(shrunk.id)!.cell;
    expect(base.roomById.get(shrunk.id)!.box.width).toBeCloseTo(cell.x1 - cell.x0);
  });

  it("resolves a renamed room's alias", () => {
    const renamed = head.roomById.get(`${CHECKOUT}.computeTotal`)!;
    expect(renamed.room?.aliases).toEqual([`${CHECKOUT}.calcTotal`]);
    expect(renamed.change).toBe("modified");
  });

  it("mutes changed rooms whose layer is filtered out", () => {
    const view = { ...DEFAULT_VIEW, layers: { pushed: true, committed: false, uncommitted: true } };
    const s = deriveState(layout, diff!, view);
    expect(s.roomById.get(`${CHECKOUT}.retry`)!.muted).toBe(true); // added, committed
    expect(s.roomById.get(`${CHECKOUT}.confirm`)!.muted).toBe(false); // added, pushed
    expect(s.roomById.get(`${CHECKOUT}.cancel`)!.muted).toBe(false); // context
  });

  it("shows pipes for changed rooms only by default, and all pipes on request", () => {
    const shown = head.pipes.filter((p) => p.shown).map((p) => p.id);
    // Checkout.begin (modified) → Cart.items (context) is shown; OldPromo pipes involve removed rooms.
    expect(shown).toContain(`${CHECKOUT}.begin->src/cart/Cart.ts::Cart.items`);
    const all = deriveState(layout, diff!, { ...DEFAULT_VIEW, pipeMode: "all" });
    expect(all.pipes.every((p) => p.shown === p.present)).toBe(true);
    // The pipe between two unchanged rooms is hidden unless showing all pipes.
    const both = head.pipes.find((p) => p.from.endsWith("Checkout.applyGiftCard") && p.to.endsWith("Checkout.computeTotal"))!;
    expect(both.shown).toBe(true); // both ends changed
  });

  it("ghosts removed pipes from head and added pipes from base", () => {
    const removedPipe = head.pipes.find((p) => p.change === "removed")!;
    const addedPipe = head.pipes.find((p) => p.change === "added")!;
    expect(removedPipe.ghost).toBe(true);
    expect(addedPipe.ghost).toBe(false);
    expect(base.pipes.find((p) => p.id === addedPipe.id)!.ghost).toBe(true);
  });

  it("keeps tiny rooms visible", () => {
    for (const r of head.rooms) {
      expect(r.box.width).toBeGreaterThanOrEqual(MIN_ROOM_SIDE);
      expect(r.box.depth).toBeGreaterThanOrEqual(MIN_ROOM_SIDE);
    }
  });
});
