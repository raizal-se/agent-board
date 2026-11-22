import { AREA_PAD, AREA_TOP, BLOCK_H, BLOCK_W, createBoardDoc, FRAME_PAD, GRID_GAP, framesMap, itemsMap, layoutMap, STICKY_H, STICKY_W, type FileItem } from '@agent-board/model';
import { describe, expect, it } from 'vitest';
import { readBoard } from './useBoard';
import { views } from './derive';
import { noteSpot } from './place';

// A card's place is relative to its area (Product here, at the frame's top left); a note's to its frame.
const ZONE_TOP = AREA_TOP;
const zoneX = (_: 'product') => AREA_PAD;
/** A card's box, relative to the frame. */
const inFrame = (x: number, y: number) => ({ x: FRAME_PAD + x, y: FRAME_PAD + y });

function board(blockY = ZONE_TOP) {
  const doc = createBoardDoc();
  doc.transact(() => {
    framesMap(doc).set('frame:a', { id: 'frame:a', name: 'a' });
    layoutMap(doc).set('frame:a', { x: 1000, y: 0 });
    const x: FileItem = { id: 'x', kind: 'file', path: 'a/x.md', frame: 'frame:a', type: 'markdown', text: '', hash: '', owner: 'me', gone: false, updatedAt: 0 };
    itemsMap(doc).set('x', x);
    layoutMap(doc).set('x', { x: zoneX('product'), y: blockY, w: BLOCK_W, h: BLOCK_H });
  });
  return doc;
}

describe('a new note', () => {
  it('goes in the middle of the view, in the frame there, when that spot is free', () => {
    // The block sits low in the frame, so the top of the column is free.
    const doc = board(ZONE_TOP + 2 * STICKY_H + 40);
    const frames = views(readBoard(doc)).frames;
    const top = inFrame(zoneX('product'), ZONE_TOP);
    const c = { x: 1000 + top.x + 100, y: top.y + STICKY_H / 2 };
    expect(noteSpot(doc, frames, c)).toEqual({ frame: 'frame:a', x: top.x + 100 - STICKY_W / 2, y: top.y });
  });

  it('does not land on a block: it takes the free spot nearest the centre, not one far down the column', () => {
    // Two blocks stacked in the product column; the view centred where they meet.
    const doc = board();
    const second: FileItem = { id: 'y', kind: 'file', path: 'a/y.md', frame: 'frame:a', type: 'markdown', text: '', hash: '', owner: 'me', gone: false, updatedAt: 0 };
    doc.transact(() => {
      itemsMap(doc).set('y', second);
      layoutMap(doc).set('y', { x: zoneX('product'), y: ZONE_TOP + BLOCK_H + GRID_GAP, w: BLOCK_W, h: BLOCK_H });
    });
    const frames = views(readBoard(doc)).frames;
    const left = inFrame(zoneX('product'), 0).x;
    const c = { x: 1000 + left + BLOCK_W / 2, y: inFrame(0, ZONE_TOP + BLOCK_H + GRID_GAP / 2).y };
    const spot = noteSpot(doc, frames, c);
    expect(spot.frame).toBe('frame:a');
    for (const top of [ZONE_TOP, ZONE_TOP + BLOCK_H + GRID_GAP].map((y) => inFrame(0, y).y)) {
      const hit = spot.x < left + BLOCK_W && left < spot.x + STICKY_W && spot.y < top + BLOCK_H && top < spot.y + STICKY_H;
      expect(hit, `clear of the block at y ${top}`).toBe(false);
    }
    // Beside the blocks, level with the centre: not under both, out of the first view.
    expect(spot.x).toBeGreaterThanOrEqual(left + BLOCK_W);
    expect(Math.abs(spot.y + STICKY_H / 2 - c.y)).toBeLessThan(STICKY_H);
  });

  it('outside every frame it stays where the view is', () => {
    const doc = board();
    expect(noteSpot(doc, views(readBoard(doc)).frames, { x: -500, y: -500 })).toEqual({ frame: null, x: -500 - STICKY_W / 2, y: -500 - STICKY_H / 2 });
  });
});
