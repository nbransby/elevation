import type { BuildingDiff } from "../../model";
import { buildDiff } from "../builder";

/**
 * 6. Every change kind in every layer, plus context rooms, a renamed room, an added floor, a
 * removed floor and a module floor.
 */
export function allKinds(): BuildingDiff[] {
  return [
    buildDiff({
      scenario: "all-kinds",
      unresolvedCalls: 3,
      floors: [
        {
          ref: "Checkout",
          path: "src/checkout/Checkout.ts",
          name: "Checkout",
          rooms: [
            { name: "begin", change: "modified", base: 16, head: 20, layer: "pushed" },
            { name: "applyCoupon", change: "modified", base: 22, head: 15, layer: "committed" },
            { name: "applyGiftCard", change: "modified", base: 12, head: 19, layer: "uncommitted" },
            { name: "computeTotal", change: "modified", base: 18, head: 21, layer: "committed", renamedFrom: "calcTotal" },
            { name: "confirm", change: "added", size: 14, layer: "pushed" },
            { name: "retry", change: "added", size: 8, layer: "committed" },
            { name: "undo", change: "added", size: 11, layer: "uncommitted" },
            { name: "legacyTotals", change: "removed", size: 24, layer: "pushed" },
            { name: "estimateTax", change: "removed", size: 13, layer: "committed" },
            { name: "debugDump", change: "removed", size: 7, layer: "uncommitted" },
            { name: "cancel", size: 9 },
          ],
        },
        {
          ref: "Pricing",
          path: "src/pricing/Pricing.ts",
          name: "Pricing",
          rooms: [
            { name: "priceFor", change: "added", size: 17, layer: "pushed" },
            { name: "bulkDiscount", change: "added", size: 12, layer: "committed" },
            { name: "roundCents", change: "added", size: 5, layer: "uncommitted" },
          ],
        },
        {
          ref: "OldPromo",
          path: "src/legacy/OldPromo.ts",
          name: "OldPromo",
          rooms: [
            { name: "applyPromo", change: "removed", size: 20, layer: "committed" },
            { name: "isEligible", change: "removed", size: 9, layer: "committed" },
          ],
        },
        {
          ref: "format",
          path: "src/util/format.ts",
          kind: "module",
          rooms: [
            { name: "formatPrice", size: 6 },
            { name: "formatDate", change: "modified", base: 8, head: 10, layer: "uncommitted" },
          ],
        },
        {
          ref: "Cart",
          path: "src/cart/Cart.ts",
          name: "Cart",
          rooms: [
            { name: "items", size: 5 },
            { name: "subtotal", size: 12 },
          ],
        },
      ],
      pipes: [
        ["Checkout.begin", "Cart.items"],
        ["Checkout.computeTotal", "Cart.subtotal"],
        ["Checkout.computeTotal", "Pricing.priceFor", "added"],
        ["Checkout.legacyTotals", "OldPromo.applyPromo", "removed"],
        ["Checkout.applyCoupon", "OldPromo.isEligible", "removed"],
        ["Checkout.applyCoupon", "Pricing.bulkDiscount", "added"],
        ["Checkout.confirm", "format.formatPrice", "added"],
        ["Checkout.undo", "Checkout.cancel", "added"],
        ["Checkout.estimateTax", "format.formatPrice", "removed"],
        ["Checkout.applyGiftCard", "Checkout.computeTotal"],
        ["Pricing.priceFor", "Pricing.roundCents", "added"],
        ["Pricing.bulkDiscount", "format.formatDate", "added"],
        ["OldPromo.applyPromo", "format.formatDate", "removed"],
      ],
    }),
  ];
}
