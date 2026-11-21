import { describe, expect, it } from 'vitest';
import { createBoardDoc } from './index';
import { framesMap, frameId, frameNameForPath, itemsMap, type FileItem } from './items';
import { BLOCK_W, FRAME_MIN_W, FRAME_GAP, layoutMap, nextFrameSpot, nextItemSpot } from './layout';

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
});
