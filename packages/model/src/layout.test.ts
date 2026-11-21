import { describe, expect, it } from 'vitest';
import { createBoardDoc } from './index';
import { framesMap, frameId, frameNameForPath, itemsMap, type FileItem } from './items';
import { BLOCK_W, FRAME_GAP, FRAME_MIN_W, FRAME_PAD, frameSize, layoutMap, nextFrameSpot, nextItemSpot } from './layout';

function item(id: string, frame: string): FileItem {
  return { id, kind: 'file', path: `${id}.md`, frame, type: 'markdown', text: '', hash: '', owner: 'me', gone: false, updatedAt: 0 };
}

describe('frames', () => {
  it('a first-level folder is the frame, root files use the root name', () => {
    expect(frameNameForPath('checkout/api.md', 'payments')).toBe('checkout');
    expect(frameNameForPath('checkout/deep/x.md', 'payments')).toBe('checkout');
    expect(frameNameForPath('readme.md', 'payments')).toBe('payments');
  });
});

describe('placement', () => {
  it('fills the frame grid left to right, skipping taken cells', () => {
    const doc = createBoardDoc();
    const f = frameId('checkout');
    const first = nextItemSpot(doc, f);
    itemsMap(doc).set('a', item('a', f));
    layoutMap(doc).set('a', first);
    const second = nextItemSpot(doc, f);
    expect(second.y).toBe(first.y);
    expect(second.x).toBeGreaterThanOrEqual(first.x + BLOCK_W);
    // Blocks in another frame do not take cells here.
    expect(nextItemSpot(doc, frameId('other'))).toEqual(first);
  });

  it('places new frames to the right of the others', () => {
    const doc = createBoardDoc();
    const a = nextFrameSpot(doc);
    framesMap(doc).set('frame:a', { id: 'frame:a', name: 'a' });
    layoutMap(doc).set('frame:a', a);
    expect(nextFrameSpot(doc).x).toBe(a.x + FRAME_MIN_W + FRAME_GAP);
  });

  it('a new frame goes right of a frame that grew past its first row', () => {
    const doc = createBoardDoc();
    framesMap(doc).set('frame:a', { id: 'frame:a', name: 'a' });
    layoutMap(doc).set('frame:a', { x: 0, y: 0 });
    itemsMap(doc).set('wide', item('wide', 'frame:a'));
    layoutMap(doc).set('wide', { x: 2000, y: 48 });
    expect(nextFrameSpot(doc).x).toBe(2000 + BLOCK_W + FRAME_PAD + FRAME_GAP);
  });

  it('a frame is at least one row wide and grows to hold its blocks', () => {
    expect(frameSize([]).w).toBe(FRAME_MIN_W);
    expect(frameSize([{ x: 1000, y: 900 }])).toEqual({ w: 1000 + BLOCK_W + FRAME_PAD, h: 900 + 380 + FRAME_PAD });
  });
});
