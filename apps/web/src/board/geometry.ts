/** A node's box in flow coordinates. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

const center = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** Where the line from the centre of `from` towards the centre of `to` crosses the border of `from`. */
export function borderPoint(from: Box, to: Box): Point {
  const c = center(from);
  const t = center(to);
  const dx = t.x - c.x;
  const dy = t.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const sx = dx === 0 ? Infinity : from.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : from.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

/**
 * A floating edge: it leaves `source` and enters `target` on the sides that face each other, on
 * the line between their centres, so edges between different pairs of blocks do not share a line.
 */
export function floatingEnds(source: Box, target: Box): { source: Point; target: Point } {
  return { source: borderPoint(source, target), target: borderPoint(target, source) };
}
