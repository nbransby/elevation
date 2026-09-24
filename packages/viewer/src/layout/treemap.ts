import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";
import { cmp } from "./graph";

export interface TreemapItem {
  id: string;
  value: number;
}

export interface LocalRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Node {
  id: string | null;
  value: number;
  children?: Node[];
}

/**
 * Squarified treemap of `items` into [0, width] × [0, depth]. The area is shared out as if the
 * floor held `capacity` in total, so room areas stay proportional to lines of code across every
 * floor of a building; the unused part is an empty cell placed last.
 */
export function floorTreemap(
  items: readonly TreemapItem[],
  width: number,
  depth: number,
  capacity: number,
  gap: number,
): Map<string, LocalRect> {
  const children: Node[] = [...items]
    .sort((a, b) => b.value - a.value || cmp(a.id, b.id))
    .map((i) => ({ id: i.id, value: i.value }));
  const used = children.reduce((s, c) => s + c.value, 0);
  const spare = capacity - used;
  if (spare > used * 1e-6) children.push({ id: null, value: spare });

  const root = hierarchy<Node>({ id: null, value: 0, children }).sum((d) => (d.children ? 0 : d.value));
  const laidOut = treemap<Node>()
    .tile(treemapSquarify)
    .size([width, depth])
    .paddingInner(gap)
    .paddingOuter(gap)
    .round(false)(root);

  const out = new Map<string, LocalRect>();
  for (const leaf of laidOut.leaves()) {
    if (leaf.data.id !== null) out.set(leaf.data.id, { x0: leaf.x0, y0: leaf.y0, x1: leaf.x1, y1: leaf.y1 });
  }
  return out;
}
