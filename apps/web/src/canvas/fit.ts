/** The first view of the board: the content as large as fits, from the top, centred left to right. */

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The space for the content on screen: the canvas size, less our bars at the top. */
export interface ViewSpace {
  width: number;
  height: number;
  /** Room kept free at the top for the header and selection bar. */
  top: number;
  /** Room kept free on the other sides. */
  pad: number;
}

export interface Fit {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 1;

export function contentBounds(els: Iterable<{ x: number; y: number; width: number; height: number; isDeleted?: boolean }>): Bounds | null {
  let b: Bounds | null = null;
  for (const e of els) {
    if (e.isDeleted) continue;
    const r = { minX: Math.min(e.x, e.x + e.width), minY: Math.min(e.y, e.y + e.height), maxX: Math.max(e.x, e.x + e.width), maxY: Math.max(e.y, e.y + e.height) };
    b = b ? { minX: Math.min(b.minX, r.minX), minY: Math.min(b.minY, r.minY), maxX: Math.max(b.maxX, r.maxX), maxY: Math.max(b.maxY, r.maxY) } : r;
  }
  return b;
}

/**
 * Fit the content in the space, and put it at the top. Excalidraw's own fit centres the content
 * both ways, so wide content on a tall phone screen sits in the middle with half the screen empty
 * above it. Excalidraw maps a scene point to the screen as (point + scroll) * zoom.
 */
export function fitTop(b: Bounds, s: ViewSpace): Fit {
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  const availW = Math.max(1, s.width - 2 * s.pad);
  const availH = Math.max(1, s.height - s.top - s.pad);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(availW / w, availH / h)));
  return {
    zoom,
    scrollX: (s.width / zoom - w) / 2 - b.minX,
    scrollY: s.top / zoom - b.minY,
  };
}
