import type * as Y from 'yjs';
import type { Layout } from './index';
import type { FileType } from './items';

/**
 * Sizes and the shape of a feature board (design screen "1 · Board — converge"). Each feature frame
 * is one big board split 2×2 into four areas: Product (top left), Engineering (top right), Agreed
 * (bottom left) and Milestone (bottom right). The canvas and the CLI share these, so a new block
 * lands in a free spot.
 *
 * Places are free (design 3.1): a new block gets a free spot in its area once, and after that only
 * a person moves it. A block's place is relative to its area, so when an area grows the areas right
 * of it and below it move with what is in them. Notes are relative to their frame (or the board).
 */
export const BLOCK_W = 520;
/** A card's height until its content is measured on the page. */
export const BLOCK_H = 480;
/** A card grows to its content up to this; past it, the content scrolls inside the card. */
export const CARD_MAX_H = 1400;
export const CARD_MIN_H = 160;
export const STICKY_W = 200;
export const STICKY_H = 160;
export const DECISION_W = BLOCK_W;
export const DECISION_H = 170;
export const GRID_GAP = 40;
/** Room inside a frame, around its areas. Excalidraw draws the frame name above the frame. */
export const FRAME_PAD = 40;
export const AREA_GAP = 32;
/** Room inside an area at its sides and bottom. */
export const AREA_PAD = 32;
/** Room at the top of an area for its label: the first spot in an area starts below it. */
export const AREA_TOP = 64;
/** An empty area: about two and a half cards wide and two cards tall, room to add things. */
export const AREA_MIN_W = AREA_PAD * 2 + Math.round(BLOCK_W * 2.5) + GRID_GAP;
export const AREA_MIN_H = AREA_TOP + BLOCK_H * 2 + GRID_GAP + AREA_PAD;
/** Between two frames. */
export const FRAME_GAP = 400;

export const AREAS = ['product', 'engineering', 'agreed', 'milestone'] as const;
export type Area = (typeof AREAS)[number];

/** Each area's column and row in the 2×2 grid. */
const COL: Record<Area, 0 | 1> = { product: 0, engineering: 1, agreed: 0, milestone: 1 };
const ROW: Record<Area, 0 | 1> = { product: 0, engineering: 0, agreed: 1, milestone: 1 };

/** The widths of the two columns and the heights of the two rows of a frame's areas. */
export interface Grid {
  cols: [number, number];
  rows: [number, number];
}

export const MIN_GRID: Grid = { cols: [AREA_MIN_W, AREA_MIN_W], rows: [AREA_MIN_H, AREA_MIN_H] };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Something in an area, relative to the area. */
export interface AreaCell extends Rect {
  area: Area;
  id: string;
}

export function layoutMap(doc: Y.Doc): Y.Map<Layout> {
  return doc.getMap<Layout>('layout');
}

/**
 * The largest grid each frame has had, by frame id. An area grows when its content needs room and
 * never shrinks under the user: a block moved out of an area leaves the room it had.
 */
export function gridsMap(doc: Y.Doc): Y.Map<Grid> {
  return doc.getMap<Grid>('grids');
}

/** The grid for these cells: room for each of them, never less than `stored` or an empty area. */
export function gridFor(cells: Iterable<AreaCell>, stored?: Grid): Grid {
  const g: Grid = {
    cols: [Math.max(AREA_MIN_W, stored?.cols[0] ?? 0), Math.max(AREA_MIN_W, stored?.cols[1] ?? 0)],
    rows: [Math.max(AREA_MIN_H, stored?.rows[0] ?? 0), Math.max(AREA_MIN_H, stored?.rows[1] ?? 0)],
  };
  for (const c of cells) {
    g.cols[COL[c.area]] = Math.max(g.cols[COL[c.area]], Math.ceil(c.x + c.w + AREA_PAD));
    g.rows[ROW[c.area]] = Math.max(g.rows[ROW[c.area]], Math.ceil(c.y + c.h + AREA_PAD));
  }
  return g;
}

export const sameGrid = (a: Grid | undefined, b: Grid) =>
  !!a && a.cols[0] === b.cols[0] && a.cols[1] === b.cols[1] && a.rows[0] === b.rows[0] && a.rows[1] === b.rows[1];

/** An area's top left corner, relative to its frame. */
export function areaOrigin(g: Grid, area: Area): { x: number; y: number } {
  return {
    x: FRAME_PAD + (COL[area] === 1 ? g.cols[0] + AREA_GAP : 0),
    y: FRAME_PAD + (ROW[area] === 1 ? g.rows[0] + AREA_GAP : 0),
  };
}

/** An area's box, relative to its frame. */
export function areaRect(g: Grid, area: Area): Rect {
  return { ...areaOrigin(g, area), w: g.cols[COL[area]], h: g.rows[ROW[area]] };
}

/** A frame's size: its four areas, and room for the notes in it (relative to the frame). */
export function frameSizeFor(g: Grid, free: Iterable<Rect> = []): { w: number; h: number } {
  let w = FRAME_PAD * 2 + g.cols[0] + AREA_GAP + g.cols[1];
  let h = FRAME_PAD * 2 + g.rows[0] + AREA_GAP + g.rows[1];
  for (const r of free) {
    w = Math.max(w, Math.ceil(r.x + r.w + FRAME_PAD));
    h = Math.max(h, Math.ceil(r.y + r.h + FRAME_PAD));
  }
  return { w, h };
}

export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * The first free spot in an area for something of size `want`, given what is in it (relative to
 * the area): rows from the top, left to right, each at least a gap clear of the others. Spots are
 * tried below and right of each thing already there, so a moved card leaves its old room free.
 * If nothing fits the area's width, the spot is below everything (the area then grows down).
 */
export function freeSpot(taken: readonly Rect[], areaW: number, want: { w: number; h: number }): { x: number; y: number } {
  const fits = (x: number) => x + want.w + AREA_PAD <= areaW;
  const xs = new Set<number>([AREA_PAD]);
  for (let x = AREA_PAD + want.w + GRID_GAP; fits(x); x += want.w + GRID_GAP) xs.add(x);
  for (const r of taken) if (r.x + r.w + GRID_GAP >= AREA_PAD && fits(r.x + r.w + GRID_GAP)) xs.add(r.x + r.w + GRID_GAP);
  const ys = new Set<number>([AREA_TOP]);
  for (const r of taken) if (r.y + r.h + GRID_GAP >= AREA_TOP) ys.add(r.y + r.h + GRID_GAP);
  const m = GRID_GAP - 1;
  const free = (x: number, y: number) => !taken.some((r) => overlaps(r, { x: x - m, y: y - m, w: want.w + 2 * m, h: want.h + 2 * m }));
  const sortedXs = [...xs].sort((a, b) => a - b);
  for (const y of [...ys].sort((a, b) => a - b)) {
    for (const x of sortedXs) if (free(x, y)) return { x: Math.round(x), y: Math.round(y) };
  }
  const bottom = Math.max(AREA_TOP - GRID_GAP, ...taken.map((r) => r.y + r.h));
  return { x: AREA_PAD, y: Math.round(bottom + GRID_GAP) };
}

/** Roughly how tall a card is for this file, before the page measures it: for a first free spot. */
export function estimateCardH(type: FileType, text: string): number {
  const chrome = 104;
  if (type === 'html') return Math.min(CARD_MAX_H, chrome + 560);
  let h = chrome + 24;
  for (const line of text.split('\n')) {
    const t = line.trim();
    h += t === '' ? 10 : t.startsWith('#') ? 40 : Math.ceil(t.length / 72) * 22;
  }
  return Math.max(CARD_MIN_H, Math.min(CARD_MAX_H, Math.round(h)));
}
