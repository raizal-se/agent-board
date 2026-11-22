import { describe, expect, it } from 'vitest';
import { createBoardDoc } from './index';
import { framesMap, frameId, frameNameForPath, itemsMap, type FileItem } from './items';
import {
  BLOCK_H,
  BLOCK_W,
  DECISION_H,
  DECISION_W,
  FRAME_GAP,
  FRAME_MIN_W,
  FRAME_PAD,
  frameSize,
  GRID_GAP,
  layoutMap,
  nextFrameSpot,
  nextItemSpot,
  STICKY_H,
  STICKY_W,
  ZONE_TOP,
  zoneRects,
  ZONES,
  zoneX,
} from './layout';

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
  it('a new block starts at the top of its zone column, the next one goes below it', () => {
    const doc = createBoardDoc();
    const f = frameId('checkout');
    const first = nextItemSpot(doc, f);
    expect(first).toEqual({ x: zoneX('product'), y: ZONE_TOP });
    itemsMap(doc).set('a', item('a', f));
    layoutMap(doc).set('a', first);
    const second = nextItemSpot(doc, f);
    expect(second).toEqual({ x: first.x, y: first.y + BLOCK_H + GRID_GAP });
    // Another zone has its own column; blocks in another frame do not take places here.
    expect(nextItemSpot(doc, f, { zone: 'engineering' })).toEqual({ x: zoneX('engineering'), y: ZONE_TOP });
    expect(nextItemSpot(doc, frameId('other'))).toEqual(first);
  });

  it('a block dragged into a column keeps its place taken; a smaller item fits a smaller gap', () => {
    const doc = createBoardDoc();
    const f = frameId('checkout');
    itemsMap(doc).set('a', item('a', f));
    layoutMap(doc).set('a', { x: zoneX('agreed') + 20, y: ZONE_TOP + DECISION_H + 40 });
    const d = nextItemSpot(doc, f, { zone: 'agreed', w: DECISION_W, h: DECISION_H });
    expect(d).toEqual({ x: zoneX('agreed'), y: ZONE_TOP });
    const big = nextItemSpot(doc, f, { zone: 'agreed' });
    expect(big.y).toBe(ZONE_TOP + DECISION_H + 40 + BLOCK_H + GRID_GAP);
  });

  it('the zones are four columns, left to right, and fill the frame height', () => {
    const z = zoneRects(1000);
    expect(ZONES).toEqual(['product', 'engineering', 'agreed', 'milestone']);
    expect(z.product.x).toBeLessThan(z.engineering.x);
    expect(z.agreed.x).toBeLessThan(z.milestone.x);
    expect(z.milestone.x + z.milestone.w).toBeLessThanOrEqual(FRAME_MIN_W);
    expect(z.product.y + z.product.h).toBeLessThanOrEqual(1000);
  });

  it('places new frames to the right of the others', () => {
    const doc = createBoardDoc();
    const a = nextFrameSpot(doc);
    framesMap(doc).set('frame:a', { id: 'frame:a', name: 'a' });
    layoutMap(doc).set('frame:a', a);
    expect(nextFrameSpot(doc).x).toBe(a.x + FRAME_MIN_W + FRAME_GAP);
  });

  it('a new frame goes right of a frame that grew', () => {
    const doc = createBoardDoc();
    framesMap(doc).set('frame:a', { id: 'frame:a', name: 'a' });
    layoutMap(doc).set('frame:a', { x: 0, y: 0 });
    itemsMap(doc).set('wide', item('wide', 'frame:a'));
    layoutMap(doc).set('wide', { x: 2000, y: 48 });
    expect(nextFrameSpot(doc).x).toBe(2000 + BLOCK_W + FRAME_PAD + FRAME_GAP);
  });

  it('a frame holds its four zones and grows to hold its items, each with its own size', () => {
    expect(frameSize([]).w).toBe(FRAME_MIN_W);
    expect(frameSize([{ x: 2000, y: 900 }])).toEqual({ w: 2000 + BLOCK_W + FRAME_PAD, h: 900 + BLOCK_H + FRAME_PAD });
    expect(frameSize([{ x: 2000, y: 900, w: STICKY_W, h: STICKY_H }])).toEqual({ w: 2000 + STICKY_W + FRAME_PAD, h: 900 + STICKY_H + FRAME_PAD });
  });
});
