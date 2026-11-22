import { BLOCK_W, FRAME_HEADER, GRID_GAP, isFreeIn, nextItemSpot, STICKY_H, STICKY_W, ZONES, zoneX } from '@agent-board/model';
import type * as Y from 'yjs';
import type { FrameView } from './derive';

interface Point {
  x: number;
  y: number;
}

export function frameAt(frames: FrameView[], p: Point): FrameView | undefined {
  return frames.find((f) => p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + f.h);
}

/**
 * Where a new note goes for a view centred on `c` (scene point): centred there, inside the frame
 * there if any. Blocks are drawn above the canvas, so a note must not land on one: if the spot is
 * taken, it goes to the first free place in the zone column under `c`.
 */
export function noteSpot(doc: Y.Doc, frames: FrameView[], c: Point): { frame: string | null; x: number; y: number } {
  const at = { x: Math.round(c.x - STICKY_W / 2), y: Math.round(c.y - STICKY_H / 2) };
  const f = frameAt(frames, c);
  if (!f) return { frame: null, ...at };
  const rel = { x: Math.max(0, at.x - f.x), y: Math.max(FRAME_HEADER, at.y - f.y) };
  if (isFreeIn(doc, f.frame.id, { ...rel, w: STICKY_W, h: STICKY_H })) return { frame: f.frame.id, ...rel };
  const cx = c.x - f.x;
  const zone = ZONES.find((z) => cx < zoneX(z) + BLOCK_W + GRID_GAP / 2) ?? ZONES[ZONES.length - 1]!;
  return { frame: f.frame.id, ...nextItemSpot(doc, f.frame.id, { zone, w: STICKY_W, h: STICKY_H }) };
}
