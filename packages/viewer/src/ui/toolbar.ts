import type { Side } from "../layout";
import { LAYERS, type Layer } from "../model";
import type { Scenario } from "../mock";
import { h } from "./dom";

export interface ToolbarState {
  scenarioId: string;
  turn: number;
  turnCount: number;
  side: Side;
  layers: Record<Layer, boolean>;
}

export interface ToolbarActions {
  scenario(id: string): void;
  turn(index: number): void;
  side(side: Side): void;
  layers(layers: Record<Layer, boolean>): void;
  frame(): void;
}

/** Scenario picker, turn stepper, base/head toggle and layer filters. */
export class Toolbar {
  readonly el: HTMLElement;
  private readonly select: HTMLSelectElement;
  private readonly prev: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly turnLabel: HTMLSpanElement;
  private readonly turnGroup: HTMLElement;
  private readonly sideButtons: Record<Side, HTMLButtonElement>;
  private readonly layerBoxes: Record<Layer, HTMLInputElement>;
  private state: ToolbarState;

  constructor(scenarios: readonly Scenario[], initial: ToolbarState, actions: ToolbarActions) {
    this.state = initial;
    this.select = h("select", { "aria-label": "Scenario", onchange: () => actions.scenario(this.select.value) });
    for (const s of scenarios) this.select.append(h("option", { value: s.id }, s.title));

    this.prev = h("button", { title: "Previous turn (←)", onclick: () => actions.turn(this.state.turn - 1) }, "◀");
    this.next = h("button", { title: "Next turn (→ or N)", onclick: () => actions.turn(this.state.turn + 1) }, "Next turn ▶");
    this.turnLabel = h("span", { class: "turn-label" });
    this.turnGroup = h("div", { class: "group" }, this.prev, this.turnLabel, this.next);

    const sideButton = (side: Side, label: string, title: string) =>
      h("button", { class: "seg", title, onclick: () => actions.side(side) }, label);
    this.sideButtons = {
      base: sideButton("base", "Base", "Show the base (merge-base with the default branch) — B toggles"),
      head: sideButton("head", "Head", "Show the working tree — B toggles"),
    };

    const layerLabel: Record<Layer, string> = { pushed: "Pushed", committed: "Committed", uncommitted: "Uncommitted" };
    const boxes = {} as Record<Layer, HTMLInputElement>;
    const layerEls = LAYERS.map((layer) => {
      const box = h("input", {
        type: "checkbox",
        onchange: () => actions.layers({ ...this.state.layers, [layer]: box.checked }),
      });
      boxes[layer] = box;
      return h("label", { class: `layer-toggle layer-${layer}` }, box, h("span", { class: "swatch" }), layerLabel[layer]);
    });
    this.layerBoxes = boxes;

    this.el = h(
      "header",
      { class: "toolbar panel" },
      h("div", { class: "brand" }, "Elevation", h("span", { class: "sub" }, "M0 · mock data")),
      h("div", { class: "group" }, this.select),
      this.turnGroup,
      h("div", { class: "group segmented", role: "group", "aria-label": "Side" }, this.sideButtons.base, this.sideButtons.head),
      h("div", { class: "group layers", role: "group", "aria-label": "Layers" }, ...layerEls),
      h("div", { class: "group" }, h("button", { title: "Frame everything (F)", onclick: () => actions.frame() }, "Frame")),
    );
    this.update(initial);
  }

  update(state: ToolbarState) {
    this.state = state;
    this.select.value = state.scenarioId;
    this.turnGroup.hidden = state.turnCount <= 1;
    this.turnLabel.textContent = `Turn ${state.turn + 1} / ${state.turnCount}`;
    this.prev.disabled = state.turn <= 0;
    this.next.disabled = state.turn >= state.turnCount - 1;
    for (const side of ["base", "head"] as const) this.sideButtons[side].classList.toggle("active", state.side === side);
    for (const layer of LAYERS) this.layerBoxes[layer].checked = state.layers[layer];
  }
}
