import type { BuildingDiff } from "../../model";
import { buildDiff } from "../builder";

// Scenarios 1–5: the structural basics the layout tests check.

/** 1. One class with a few rooms, including calls between rooms on the same floor. */
export function singleClass(): BuildingDiff[] {
  return [
    buildDiff({
      scenario: "single-class",
      floors: [
        {
          path: "src/cart/Cart.ts",
          name: "Cart",
          rooms: [
            { name: "constructor", size: 6 },
            { name: "addItem", change: "modified", base: 14, head: 21, layer: "committed" },
            { name: "removeItem", size: 12 },
            { name: "total", change: "added", size: 9, layer: "uncommitted" },
            { name: "clear", size: 4 },
          ],
        },
      ],
      pipes: [
        ["Cart.addItem", "Cart.total", "added"],
        ["Cart.removeItem", "Cart.total", "added"],
        ["Cart.clear", "Cart.removeItem"],
      ],
    }),
  ];
}

/** 2. Two unrelated classes: two buildings. */
export function twoBuildings(): BuildingDiff[] {
  return [
    buildDiff({
      scenario: "two-buildings",
      floors: [
        {
          path: "src/cart/Cart.ts",
          name: "Cart",
          rooms: [
            { name: "addItem", change: "modified", base: 14, head: 18 },
            { name: "removeItem", size: 12 },
            { name: "total", size: 9 },
          ],
        },
        {
          path: "src/log/Logger.ts",
          name: "Logger",
          rooms: [
            { name: "info", size: 5 },
            { name: "warn", change: "modified", base: 5, head: 8, layer: "pushed" },
            { name: "flush", change: "added", size: 16, layer: "committed" },
          ],
        },
      ],
      pipes: [
        ["Cart.addItem", "Cart.total"],
        ["Logger.warn", "Logger.flush", "added"],
      ],
    }),
  ];
}

/** 3. A dependency chain A → B → C. */
export function chain(): BuildingDiff[] {
  return [
    buildDiff({
      scenario: "chain",
      floors: [
        {
          ref: "A",
          path: "src/checkout/CheckoutController.ts",
          name: "CheckoutController",
          rooms: [
            { name: "post", change: "modified", base: 18, head: 24, layer: "committed" },
            { name: "validate", size: 11 },
          ],
        },
        {
          ref: "B",
          path: "src/checkout/CheckoutService.ts",
          name: "CheckoutService",
          rooms: [
            { name: "placeOrder", change: "modified", base: 30, head: 26, layer: "uncommitted" },
            { name: "reserveStock", size: 14 },
          ],
        },
        {
          ref: "C",
          path: "src/payments/PaymentGateway.ts",
          name: "PaymentGateway",
          rooms: [
            { name: "charge", size: 22 },
            { name: "refund", size: 17 },
          ],
        },
      ],
      pipes: [
        ["A.post", "A.validate"],
        ["A.post", "B.placeOrder"],
        ["B.placeOrder", "B.reserveStock"],
        ["B.placeOrder", "C.charge"],
        ["B.placeOrder", "C.refund", "added"],
      ],
    }),
  ];
}

/** 4. A diamond: two floors depending on one shared floor, and one floor on top of both. */
export function diamond(): BuildingDiff[] {
  return [
    buildDiff({
      scenario: "diamond",
      floors: [
        {
          ref: "App",
          path: "src/App.ts",
          name: "App",
          rooms: [{ name: "start", change: "modified", base: 12, head: 15, layer: "pushed" }],
        },
        {
          ref: "Users",
          path: "src/users/UserService.ts",
          name: "UserService",
          rooms: [
            { name: "find", size: 9 },
            { name: "create", change: "added", size: 19, layer: "committed" },
          ],
        },
        {
          ref: "Orders",
          path: "src/orders/OrderService.ts",
          name: "OrderService",
          rooms: [
            { name: "list", change: "modified", base: 10, head: 16, layer: "uncommitted" },
            { name: "cancel", size: 13 },
          ],
        },
        {
          ref: "Db",
          path: "src/db/Database.ts",
          name: "Database",
          rooms: [
            { name: "query", size: 25 },
            { name: "transaction", size: 31 },
          ],
        },
      ],
      pipes: [
        ["App.start", "Users.find"],
        ["App.start", "Orders.list"],
        ["Users.find", "Db.query"],
        ["Users.create", "Db.transaction", "added"],
        ["Orders.list", "Db.query"],
        ["Orders.cancel", "Db.transaction"],
      ],
    }),
  ];
}

/** 5. A two-class cycle on its own, and a three-class cycle inside a larger building. */
export function cycles(): BuildingDiff[] {
  return [
    buildDiff({
      scenario: "cycles",
      floors: [
        {
          ref: "Parser",
          path: "src/lang/Parser.ts",
          name: "Parser",
          rooms: [
            { name: "parseExpr", change: "modified", base: 28, head: 33, layer: "committed" },
            { name: "parseBlock", size: 19 },
          ],
        },
        {
          ref: "Lexer",
          path: "src/lang/Lexer.ts",
          name: "Lexer",
          rooms: [
            { name: "next", size: 24 },
            { name: "recover", change: "added", size: 12, layer: "uncommitted" },
          ],
        },
        {
          ref: "Main",
          path: "src/jobs/main.ts",
          kind: "module",
          rooms: [{ name: "runJobs", change: "modified", base: 8, head: 11, layer: "pushed" }],
        },
        {
          ref: "Scheduler",
          path: "src/jobs/Scheduler.ts",
          name: "Scheduler",
          rooms: [
            { name: "tick", change: "modified", base: 15, head: 22, layer: "uncommitted" },
            { name: "enqueue", size: 9 },
          ],
        },
        {
          ref: "Worker",
          path: "src/jobs/Worker.ts",
          name: "Worker",
          rooms: [
            { name: "run", size: 26 },
            { name: "report", size: 7 },
          ],
        },
        {
          ref: "Queue",
          path: "src/jobs/Queue.ts",
          name: "Queue",
          rooms: [
            { name: "pop", size: 11 },
            { name: "drain", change: "added", size: 14, layer: "committed" },
          ],
        },
        {
          ref: "Store",
          path: "src/jobs/Store.ts",
          name: "Store",
          rooms: [{ name: "persist", size: 18 }],
        },
      ],
      pipes: [
        // Two-class cycle.
        ["Parser.parseExpr", "Lexer.next"],
        ["Lexer.recover", "Parser.parseBlock", "added"],
        // Three-class cycle Scheduler → Worker → Queue → Scheduler, with floors above and below.
        ["Main.runJobs", "Scheduler.tick"],
        ["Scheduler.tick", "Worker.run"],
        ["Worker.report", "Queue.pop"],
        ["Queue.drain", "Scheduler.enqueue", "added"],
        ["Queue.pop", "Store.persist"],
      ],
    }),
  ];
}
