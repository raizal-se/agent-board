import type * as Y from 'yjs';
import type { Layout } from './index';
import { framesMap, itemsMap } from './items';

/**
 * Fixed block and grid sizes. The canvas and the CLI share them so a new block lands in a free cell.
 * Item positions are relative to their frame.
 */
export const BLOCK_W = 340;
export const BLOCK_H = 380;
export const GRID_GAP = 32;
export const FRAME_PAD = 32;
export const FRAME_HEADER = 48;
export const FRAME_COLS = 3;
export const FRAME_GAP = 120;
export const FRAME_MIN_W = FRAME_PAD * 2 + FRAME_COLS * BLOCK_W + (FRAME_COLS - 1) * GRID_GAP;
export const FRAME_MIN_H = FRAME_HEADER + FRAME_PAD + BLOCK_H;

export function layoutMap(doc: Y.Doc): Y.Map<Layout> {
  return doc.getMap<Layout>('layout');
}

function cell(index: number): { x: number; y: number } {
  const col = index % FRAME_COLS;
  const row = Math.floor(index / FRAME_COLS);
  return { x: FRAME_PAD + col * (BLOCK_W + GRID_GAP), y: FRAME_HEADER + row * (BLOCK_H + GRID_GAP) };
}

/**
 * The first grid cell in a frame that no block covers. Hidden (gone) blocks keep their cell, so a
 * file that comes back lands where it was.
 */
export function nextItemSpot(doc: Y.Doc, frame: string, exceptId?: string): { x: number; y: number } {
  const layout = layoutMap(doc);
  const taken: Layout[] = [];
  for (const item of itemsMap(doc).values()) {
    if (item.frame !== frame || item.id === exceptId) continue;
    const l = layout.get(item.id);
    if (l) taken.push(l);
  }
  for (let i = 0; ; i++) {
    const c = cell(i);
    const covered = taken.some((l) => Math.abs(l.x - c.x) < BLOCK_W && Math.abs(l.y - c.y) < BLOCK_H);
    if (!covered) return c;
  }
}

/** Frames line up left to right; a new one goes right of the rightmost. */
export function nextFrameSpot(doc: Y.Doc): Layout {
  const layout = layoutMap(doc);
  let right = -FRAME_GAP;
  for (const f of framesMap(doc).values()) {
    const l = layout.get(f.id);
    if (l) right = Math.max(right, l.x + (l.w ?? FRAME_MIN_W));
  }
  return { x: right + FRAME_GAP, y: 0, w: FRAME_MIN_W, h: FRAME_MIN_H };
}
