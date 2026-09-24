// Graph helpers for building and floor order. An edge a → b means "a depends on b" (a room on a
// calls a room on b). All functions are deterministic for a given node order and adjacency.

export type Adjacency = ReadonlyMap<string, readonly string[]>;

/** Weakly connected components, each sorted, ordered by their smallest member. */
export function weakComponents(nodes: readonly string[], adj: Adjacency): string[][] {
  const parent = new Map<string, string>();
  for (const n of nodes) parent.set(n, n);
  const find = (n: string): string => {
    let root = n;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Path compression.
    let cur = n;
    while (cur !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  for (const a of nodes) {
    for (const b of adj.get(a) ?? []) {
      if (!parent.has(b)) continue;
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
    }
  }
  const groups = new Map<string, string[]>();
  for (const n of nodes) {
    const r = find(n);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = []));
    g.push(n);
  }
  const out = [...groups.values()].map((g) => g.sort());
  out.sort((a, b) => cmp(a[0]!, b[0]!));
  return out;
}

/**
 * Strongly connected components (Tarjan, iterative). Components come out in reverse topological
 * order: each one after every component it has an edge to, so dependencies come first.
 * Members of each component are sorted.
 */
export function strongComponents(nodes: readonly string[], adj: Adjacency): string[][] {
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  const inGraph = new Set(nodes);

  const visit = (v: string) => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
  };

  for (const root of nodes) {
    if (index.has(root)) continue;
    visit(root);
    const work: { v: string; i: number }[] = [{ v: root, i: 0 }];
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const succ = adj.get(frame.v) ?? [];
      if (frame.i < succ.length) {
        const w = succ[frame.i++]!;
        if (!inGraph.has(w)) continue;
        if (!index.has(w)) {
          visit(w);
          work.push({ v: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.v, Math.min(low.get(frame.v)!, index.get(w)!));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.v, Math.min(low.get(parent.v)!, low.get(frame.v)!));
      if (low.get(frame.v) === index.get(frame.v)) {
        const component: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          component.push(w);
        } while (w !== frame.v);
        out.push(component.sort());
      }
    }
  }
  return out;
}

export interface Stack {
  /** Bottom to top. */
  order: string[];
  /** For nodes in a cycle: the cycle's members in stacked order (bottom to top). */
  cycleOf: Map<string, string[]>;
}

/**
 * Stacks nodes so each sits above everything it depends on. Cycles are collapsed (Tarjan) and
 * their members stacked on adjacent storeys. Each collapsed node gets a level: the longest path
 * down to a node with no dependencies. Levels stack bottom-up; ties within a level, and the order
 * inside a cycle, are broken by `compare`.
 */
export function stackByDependency(
  nodes: readonly string[],
  adj: Adjacency,
  compare: (a: string, b: string) => number,
): Stack {
  const sorted = [...nodes].sort(cmp);
  const components = strongComponents(sorted, adj);
  const componentOf = new Map<string, number>();
  components.forEach((c, i) => c.forEach((n) => componentOf.set(n, i)));

  // Dependencies are emitted first, so one pass computes the longest-path level.
  const level: number[] = [];
  components.forEach((members, i) => {
    let lv = 0;
    for (const v of members) {
      for (const w of adj.get(v) ?? []) {
        const j = componentOf.get(w);
        if (j === undefined || j === i) continue;
        lv = Math.max(lv, level[j]! + 1);
      }
    }
    level[i] = lv;
  });

  const ordered = components.map((members, i) => ({ members: [...members].sort(compare), level: level[i]! }));
  ordered.sort((a, b) => a.level - b.level || compare(a.members[0]!, b.members[0]!));

  const order: string[] = [];
  const cycleOf = new Map<string, string[]>();
  for (const c of ordered) {
    order.push(...c.members);
    if (c.members.length > 1) for (const m of c.members) cycleOf.set(m, c.members);
  }
  return { order, cycleOf };
}

export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
