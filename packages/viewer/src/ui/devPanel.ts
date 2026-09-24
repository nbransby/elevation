import type { PipeMode } from "../layout";
import { h } from "./dom";

export interface DevSettings {
  pipeMode: PipeMode;
  floorHeight: number;
  roomGap: number;
  buildingGap: number;
  riserCount: number;
  labelThreshold: number;
  /** Render every frame even when nothing changes (for measuring frame rate). */
  continuous: boolean;
  /** Slowly orbit the camera (for measuring frame rate under motion). */
  spin: boolean;
}

interface Slider {
  key: "floorHeight" | "roomGap" | "buildingGap" | "riserCount" | "labelThreshold";
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

const SLIDERS: Slider[] = [
  { key: "floorHeight", label: "Floor height", min: 1.5, max: 6, step: 0.1 },
  { key: "roomGap", label: "Room gap", min: 0, max: 1, step: 0.05 },
  { key: "buildingGap", label: "Building gap", min: 2, max: 30, step: 1 },
  { key: "riserCount", label: "Risers", min: 1, max: 8, step: 1 },
  { key: "labelThreshold", label: "Label threshold", min: 0, max: 200, step: 5, unit: "px" },
];

/** Developer controls built from plain inputs. */
export class DevPanel {
  readonly el: HTMLElement;

  constructor(initial: DevSettings, onChange: (patch: Partial<DevSettings>) => void) {
    const radio = (mode: PipeMode, label: string) =>
      h(
        "label",
        {},
        h("input", {
          type: "radio",
          name: "pipe-mode",
          value: mode,
          checked: initial.pipeMode === mode,
          onchange: () => onChange({ pipeMode: mode }),
        }),
        label,
      );

    const sliders = SLIDERS.map((s) => {
      const value = h("output", {}, format(initial[s.key], s));
      const input = h("input", {
        type: "range",
        min: s.min,
        max: s.max,
        step: s.step,
        value: initial[s.key],
        oninput: () => {
          const v = Number(input.value);
          value.textContent = format(v, s);
          onChange({ [s.key]: v });
        },
      });
      return h("label", { class: "slider" }, h("span", {}, s.label), input, value);
    });

    const check = (key: "continuous" | "spin", label: string, title: string) => {
      const box = h("input", { type: "checkbox", checked: initial[key], onchange: () => onChange({ [key]: box.checked }) });
      return h("label", { title }, box, label);
    };

    this.el = h(
      "details",
      { class: "dev-panel panel" },
      h("summary", {}, "Developer"),
      h("fieldset", {}, h("legend", {}, "Pipes"), radio("changed", "Changed rooms only"), radio("all", "All rooms")),
      h("fieldset", {}, h("legend", {}, "Layout"), ...sliders),
      h(
        "fieldset",
        {},
        h("legend", {}, "Rendering"),
        check("continuous", "Render every frame", "Normally frames are only drawn when something moves"),
        check("spin", "Spin camera", "Orbit slowly, to measure frame rate under motion"),
      ),
    );
  }
}

function format(v: number, s: Slider): string {
  const digits = s.step < 0.1 ? 2 : s.step < 1 ? 1 : 0;
  return `${v.toFixed(digits)}${s.unit ?? ""}`;
}
