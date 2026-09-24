import type { RoomState } from "../layout";
import { h } from "./dom";

/** Frame rate, object counts and layout time. */
export class DebugOverlay {
  readonly el = h("div", { class: "debug panel", "aria-live": "off" });

  set(rows: [string, string][]) {
    this.el.replaceChildren(...rows.map(([k, v]) => h("div", {}, h("span", { class: "k" }, k), h("span", { class: "v" }, v))));
  }
}

/** Base and working-tree source of the clicked room, side by side. */
export class SourcePanel {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly title: HTMLElement;

  constructor(onClose: () => void) {
    this.title = h("h2", {});
    this.body = h("div", { class: "source-body" });
    this.el = h(
      "aside",
      { class: "source-panel panel", hidden: true, "aria-label": "Function source" },
      h("div", { class: "source-head" }, this.title, h("button", { class: "close", title: "Close (Esc)", onclick: onClose }, "×")),
      this.body,
    );
  }

  show(s: RoomState) {
    const room = s.room;
    if (!room || !s.floor) return this.hide();
    this.el.hidden = false;
    this.title.textContent = s.floor.kind === "module" ? room.name : `${s.floor.name}.${room.name}`;
    const chips = [
      h("span", { class: `chip change-${room.change}` }, room.change),
      room.layer ? h("span", { class: `chip layer-${room.layer}` }, room.layer) : null,
      room.isContext ? h("span", { class: "chip" }, "context") : null,
      h("span", { class: "chip plain" }, `${room.baseSize ?? "–"} → ${room.headSize ?? "–"} lines`),
    ];
    const aliases = room.aliases?.length
      ? h("div", { class: "aliases" }, "Renamed from ", ...room.aliases.map((a) => h("code", {}, a)))
      : null;
    const column = (label: string, text: string | undefined, missing: string) =>
      h(
        "section",
        { class: "source-col" },
        h("h3", {}, label),
        text === undefined ? h("p", { class: "missing" }, missing) : h("pre", {}, h("code", {}, text)),
      );
    const unchanged = "Unchanged; source is only included for changed functions.";
    this.body.replaceChildren(
      h("div", { class: "meta" }, h("code", { class: "path" }, s.floor.path), h("div", { class: "chips" }, ...chips), aliases),
      h(
        "div",
        { class: "source-cols" },
        column("Base", room.baseSource, room.baseSize === null ? "Not in base." : unchanged),
        column("Working tree", room.headSource, room.headSize === null ? "Deleted in the working tree." : unchanged),
      ),
    );
  }

  hide() {
    this.el.hidden = true;
  }

  get open(): boolean {
    return !this.el.hidden;
  }
}

/** Follows the cursor over a hovered room. */
export class Tooltip {
  readonly el = h("div", { class: "tooltip", hidden: true });

  show(x: number, y: number, s: RoomState) {
    const room = s.room;
    if (!room || !s.floor) return this.hide();
    const what = [room.change, room.layer, room.isContext ? "context" : null].filter(Boolean).join(" · ");
    const size = room.baseSize !== room.headSize ? `${room.baseSize ?? "–"} → ${room.headSize ?? "–"}` : `${room.headSize}`;
    this.el.replaceChildren(
      h("div", { class: "name" }, s.floor.kind === "module" ? room.name : `${s.floor.name}.${room.name}`),
      h("div", { class: "what" }, `${what} · ${size} lines`),
      h("div", { class: "path" }, s.floor.path),
    );
    this.el.hidden = false;
    this.el.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y + 14)}px)`;
  }

  hide() {
    this.el.hidden = true;
  }
}

export function legend(): HTMLElement {
  const item = (cls: string, label: string) => h("li", {}, h("span", { class: `swatch ${cls}` }), label);
  return h(
    "details",
    // Open on wide screens; collapsed on phones, where it would cover the scene.
    { class: "legend panel", open: matchMedia("(min-width: 700px)").matches },
    h("summary", {}, "Legend"),
    h(
      "div",
      { class: "legend-cols" },
      h("ul", {}, item("added", "Added"), item("removed", "Removed"), item("modified", "Modified"), item("context", "Context")),
      h("ul", {}, item("pushed", "Pushed"), item("committed", "Committed"), item("uncommitted", "Uncommitted"), item("ghost", "Not on this side")),
      h("ul", {}, item("pipe added", "Call added"), item("pipe removed", "Call removed"), item("pipe unchanged", "Call"), item("pipe upward", "Upward (cycle)")),
    ),
  );
}
