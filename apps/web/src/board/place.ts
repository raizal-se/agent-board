import { isFreeIn, STICKY_H, STICKY_W } from '@agent-board/model';
import type * as Y from 'yjs';
import type { FrameView } from './derive';

interface Point {
  x: number;
  y: number;
}

export function frameAt(frames: FrameView[], p: Point): FrameView | undefined {
  return frames.find((f) => p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + f.h);
}

const STEP = 16;
/** Room kept between a new note and the items around it. */
const MARGIN = 16;

/**
 * Where a new note goes for a view centred on `c` (scene point): centred there, inside the frame
 * there if any. Blocks are drawn above the canvas, so a note must not land on one: if the spot is
 * taken, it goes to the free spot nearest the centre (the frame grows to the right or down for it),
 * so it stays in view.
 */
export function noteSpot(doc: Y.Doc, frames: FrameView[], c: Point): { frame: string | null; x: number; y: number } {
  const at = { x: Math.round(c.x - STICKY_W / 2), y: Math.round(c.y - STICKY_H / 2) };
  const f = frameAt(frames, c);
  if (!f) return { frame: null, ...at };
  const want = { x: Math.max(0, at.x - f.x), y: Math.max(0, at.y - f.y) };
  const free = (p: Point) => isFreeIn(doc, f.frame.id, { x: p.x - MARGIN, y: p.y - MARGIN, w: STICKY_W + 2 * MARGIN, h: STICKY_H + 2 * MARGIN });
  if (free(want)) return { frame: f.frame.id, ...want };
  // Every spot on a grid over the frame and a note's size past it; the space below it is always free.
  let best: Point | null = null;
  let bestD = Infinity;
  for (let y = 0; y <= f.h + STICKY_H; y += STEP) {
    for (let x = 0; x <= f.w + STICKY_W; x += STEP) {
      const d = Math.hypot(x - want.x, y - want.y);
      if (d < bestD && free({ x, y })) {
        best = { x, y };
        bestD = d;
      }
    }
  }
  return { frame: f.frame.id, ...(best ?? { x: want.x, y: f.h }) };
}
