import { AREA_PAD, BLOCK_W } from '@agent-board/model';

/**
 * The view of the board: the first view opens on the first feature board, readable; "Fit all"
 * shows the whole board, as large as fits, from the top, centred left to right.
 */

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
  /** Room kept free at the bottom (a selection bar there), if more than `pad`. */
  bottom?: number;
}

export interface Fit {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 1;
/**
 * "Fit all" may go below Excalidraw's own floor (0.1, which only its zoom buttons, wheel and
 * pinch keep): a board of several feature boards is about 10 000 wide, so on a phone it fits
 * across only near 0.04. Excalidraw draws at any zoom set through updateScene; the next pinch
 * starts from its floor.
 */
const FIT_ALL_MIN_ZOOM = 0.01;

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
  const availH = Math.max(1, s.height - s.top - Math.max(s.pad, s.bottom ?? 0));
  const zoom = Math.min(MAX_ZOOM, Math.max(FIT_ALL_MIN_ZOOM, Math.min(availW / w, availH / h)));
  return {
    zoom,
    scrollX: (s.width / zoom - w) / 2 - b.minX,
    scrollY: s.top / zoom - b.minY,
  };
}

/** Whether the bounds show whole on screen, clear of the bars at the top (and bottom), for a view (scroll and zoom). */
export function inView(
  b: Bounds,
  v: { scrollX: number; scrollY: number; zoom: number; width: number; height: number; top: number; bottom?: number },
): boolean {
  const left = -v.scrollX;
  const top = -v.scrollY + v.top / v.zoom;
  const right = -v.scrollX + v.width / v.zoom;
  const bottom = -v.scrollY + (v.height - (v.bottom ?? 0)) / v.zoom;
  return b.minX >= left && b.minY >= top && b.maxX <= right && b.maxY <= bottom;
}

/** On a desktop the first view never goes below this zoom: card text stays readable. */
export const DESKTOP_READABLE_ZOOM = 0.45;

/**
 * The smallest zoom at which cards can be read. On a phone that is one card (with its area's
 * padding) across the width; on a desktop about half size.
 */
export function readableZoom(s: Pick<ViewSpace, 'width' | 'pad'>, narrow: boolean): number {
  if (!narrow) return DESKTOP_READABLE_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (s.width - 2 * s.pad) / (BLOCK_W + 2 * AREA_PAD)));
}

interface SceneBox {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
}

/**
 * Where the first view looks: the Product and Engineering areas of the first feature board (the
 * leftmost frame, then the topmost). With no frames, the whole board.
 */
export function firstBoardBounds(els: readonly SceneBox[]): Bounds | null {
  const live = els.filter((e) => !e.isDeleted);
  const first = live.filter((e) => e.type === 'frame').sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id))[0];
  if (!first) return contentBounds(live);
  const top = live.filter((e) => e.id === `${first.id}~zone:product` || e.id === `${first.id}~zone:engineering`);
  return contentBounds(top.length ? top : [first]);
}

/**
 * The first view: the bounds across the width, from their top just under the bars, but never
 * below `minZoom`. When they do not fit across at that zoom, they start at the left edge (Product
 * whole, Engineering off to the right) instead of being centred.
 */
export function firstView(b: Bounds, s: ViewSpace, minZoom: number): Fit {
  const w = Math.max(1, b.maxX - b.minX);
  const availW = Math.max(1, s.width - 2 * s.pad);
  const across = Math.min(MAX_ZOOM, availW / w);
  const zoom = Math.max(Math.min(minZoom, MAX_ZOOM), across);
  const scrollX = across >= zoom ? (s.width / zoom - w) / 2 - b.minX : s.pad / zoom - b.minX;
  return { zoom, scrollX, scrollY: s.top / zoom - b.minY };
}
