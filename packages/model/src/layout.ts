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
/** New blocks fill a frame two per row, so a few frames still fit a laptop screen. */
export const FRAME_COLS = 2;
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

/**
 * A frame's size: room for its blocks (hidden ones keep their cell), and never less than one row of
 * FRAME_COLS blocks. The canvas and frame placement both use this, so they agree.
 */
export function frameSize(blocks: Iterable<{ x: number; y: number }>): { w: number; h: number } {
  let w = FRAME_MIN_W;
  let h = FRAME_MIN_H;
  for (const p of blocks) {
    w = Math.max(w, p.x + BLOCK_W + FRAME_PAD);
    h = Math.max(h, p.y + BLOCK_H + FRAME_PAD);
  }
  return { w, h };
}

/** Frames line up left to right; a new one goes right of the rightmost. */
export function nextFrameSpot(doc: Y.Doc): Layout {
  const layout = layoutMap(doc);
  const blocksOf = new Map<string, Layout[]>();
  for (const item of itemsMap(doc).values()) {
    const l = layout.get(item.id);
    if (!l) continue;
    const list = blocksOf.get(item.frame) ?? [];
    list.push(l);
    blocksOf.set(item.frame, list);
  }
  let right = -FRAME_GAP;
  for (const f of framesMap(doc).values()) {
    const l = layout.get(f.id);
    if (l) right = Math.max(right, l.x + frameSize(blocksOf.get(f.id) ?? []).w);
  }
  return { x: right + FRAME_GAP, y: 0 };
}
