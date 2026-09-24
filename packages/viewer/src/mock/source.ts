import { createRng, hashString, type Rng } from "./rng";

// Plausible-looking TypeScript for mock rooms, with exactly the requested number of non-blank lines.

const NAMES = [
  "items", "total", "user", "order", "cart", "price", "count", "result", "options", "cache",
  "key", "value", "entry", "index", "list", "config", "request", "response", "state", "next",
];
const PROPS = ["id", "size", "length", "status", "amount", "name", "items", "createdAt", "owner", "version"];
const METHODS = ["get", "set", "has", "push", "map", "filter", "find", "update", "load", "save", "resolve"];

function expr(rng: Rng): string {
  const a = rng.pick(NAMES);
  const b = rng.pick(NAMES);
  const p = rng.pick(PROPS);
  const m = rng.pick(METHODS);
  return rng.pick([
    `${a}.${m}(${b})`,
    `${a}.${p} + ${b}.${p}`,
    `await this.${a}.${m}(${b}.${p})`,
    `${a}.filter((x) => x.${p} > 0)`,
    `new Map<string, number>()`,
    `Math.max(${a}.${p}, ${b}.${p})`,
    `${a}?.${p} ?? ${b}`,
    `[...${a}, ${b}]`,
    `{ ...${a}, ${p}: ${b} }`,
  ]);
}

function statement(rng: Rng): string {
  const a = rng.pick(NAMES);
  return rng.pick([
    `const ${a}${rng.int(1, 9)} = ${expr(rng)};`,
    `this.${a} = ${expr(rng)};`,
    `${a}.${rng.pick(METHODS)}(${expr(rng)});`,
    `log.debug("${a}", ${rng.pick(NAMES)});`,
  ]);
}

function body(rng: Rng, n: number, indent: string): string[] {
  const lines: string[] = [];
  while (lines.length < n) {
    const left = n - lines.length;
    if (left === 1) {
      lines.push(`${indent}return ${expr(rng)};`);
    } else if (left >= 4 && rng.chance(0.2)) {
      const c = `${rng.pick(NAMES)}.${rng.pick(PROPS)} ${rng.pick([">", "===", "!=="])} ${rng.pick(["0", "null", "undefined"])}`;
      lines.push(`${indent}if (${c}) {`, `${indent}  ${statement(rng)}`, `${indent}}`);
    } else {
      lines.push(`${indent}${statement(rng)}`);
    }
  }
  return lines;
}

export interface SourceSpec {
  name: string;
  /** Methods are indented and have no `function` keyword. */
  method: boolean;
  lines: number;
}

function render(spec: SourceSpec, bodyLines: string[], seed: string, extraArg = false): string {
  const rng = createRng(hashString(`${seed}#sig`));
  const args = `${rng.pick(NAMES)}: ${rng.pick(["string", "number", "Order", "User", "Options"])}${extraArg ? ", opts?: Options" : ""}`;
  const ret = rng.pick(["void", "number", "string", "Promise<void>", "boolean"]);
  const indent = spec.method ? "  " : "";
  const head = spec.method ? `${indent}${spec.name}(${args}): ${ret} {` : `export function ${spec.name}(${args}): ${ret} {`;
  return [head, ...bodyLines, `${indent}}`].join("\n");
}

/** One function's text, `lines` non-blank lines long (at least 2: signature and closing brace). */
export function fakeSource(spec: SourceSpec, seed: string): string {
  const n = Math.max(0, spec.lines - 2);
  const indent = spec.method ? "    " : "  ";
  return render(spec, body(createRng(hashString(seed)), n, indent), seed);
}

/**
 * Base and head text for a modified function: mostly the same lines, with some edited and the
 * body grown or shrunk to the head size. `baseName` differs from `head.name` for a rename.
 */
export function fakeSourcePair(base: SourceSpec, head: SourceSpec, seed: string): { base: string; head: string } {
  const indent = head.method ? "    " : "  ";
  const bn = Math.max(0, base.lines - 2);
  const hn = Math.max(0, head.lines - 2);
  // The same seed gives both bodies a common prefix; they diverge towards the end.
  const baseBody = body(createRng(hashString(seed)), bn, indent);
  const edit = createRng(hashString(`${seed}#edit`));
  const headBody = body(createRng(hashString(seed)), hn, indent).map((line, i) =>
    // Keep block structure intact: only edit plain statements, and always touch the first one.
    !line.trimEnd().endsWith("{") && line.trim() !== "}" && !line.trim().startsWith("return") && (edit.chance(0.25) || i === 0)
      ? `${/^\s*/.exec(line)![0]}${statement(edit)}`
      : line,
  );
  const baseText = render(base, baseBody, seed);
  const headText = render(head, headBody, seed);
  // Too short to have a body to edit: change the signature instead.
  return { base: baseText, head: headText === baseText ? render(head, headBody, seed, true) : headText };
}
