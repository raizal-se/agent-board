import { createBoardDoc, framesMap, itemsMap, layoutMap, STICKY_H, STICKY_W, ZONE_TOP, zoneX, type FileItem } from '@agent-board/model';
import { describe, expect, it } from 'vitest';
import { readBoard } from './useBoard';
import { views } from './derive';
import { noteSpot } from './place';

function board(blockY = ZONE_TOP) {
  const doc = createBoardDoc();
  doc.transact(() => {
    framesMap(doc).set('frame:a', { id: 'frame:a', name: 'a' });
    layoutMap(doc).set('frame:a', { x: 1000, y: 0 });
    const x: FileItem = { id: 'x', kind: 'file', path: 'a/x.md', frame: 'frame:a', type: 'markdown', text: '', hash: '', owner: 'me', gone: false, updatedAt: 0 };
    itemsMap(doc).set('x', x);
    layoutMap(doc).set('x', { x: zoneX('product'), y: blockY });
  });
  return doc;
}

describe('a new note', () => {
  it('goes in the middle of the view, in the frame there, when that spot is free', () => {
    // The block sits low in the frame, so the top of the column is free.
    const doc = board(ZONE_TOP + 2 * STICKY_H + 40);
    const frames = views(readBoard(doc)).frames;
    const c = { x: 1000 + zoneX('product') + 100, y: ZONE_TOP + STICKY_H / 2 };
    expect(noteSpot(doc, frames, c)).toEqual({ frame: 'frame:a', x: zoneX('product') + 100 - STICKY_W / 2, y: c.y - STICKY_H / 2 });
  });

  it('does not land on a block: it takes the first free place in the column under the centre', () => {
    const doc = board();
    const frames = views(readBoard(doc)).frames;
    const spot = noteSpot(doc, frames, { x: 1000 + zoneX('product') + 50, y: ZONE_TOP + 50 });
    expect(spot.frame).toBe('frame:a');
    expect(spot.x).toBe(zoneX('product'));
    expect(spot.y).toBeGreaterThan(ZONE_TOP + 100);
  });

  it('outside every frame it stays where the view is', () => {
    const doc = board();
    expect(noteSpot(doc, views(readBoard(doc)).frames, { x: -500, y: -500 })).toEqual({ frame: null, x: -500 - STICKY_W / 2, y: -500 - STICKY_H / 2 });
  });
});
