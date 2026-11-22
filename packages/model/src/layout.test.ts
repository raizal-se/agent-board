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
  frameRect,
  frameSize,
  GRID_GAP,
  layoutMap,
  nextFrameSpot,
  nextItemSpot,
  isFreeIn,
  type Rect,
  settleFrames,
  STICKY_H,
  STICKY_W,
  ZONE_TOP,
  zoneRects,
  ZONES,
  zoneX,
  ZONE_STRIP,
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

  it('a spot is free when no item in the frame overlaps it', () => {
    const doc = createBoardDoc();
    const f = frameId('checkout');
    itemsMap(doc).set('a', item('a', f));
    layoutMap(doc).set('a', { x: zoneX('product'), y: ZONE_TOP });
    expect(isFreeIn(doc, f, { x: zoneX('product') + 10, y: ZONE_TOP + 10, w: 50, h: 50 })).toBe(false);
    expect(isFreeIn(doc, f, { x: zoneX('product') + 10, y: ZONE_TOP + 10, w: 50, h: 50 }, 'a')).toBe(true);
    expect(isFreeIn(doc, f, { x: zoneX('engineering'), y: ZONE_TOP, w: 50, h: 50 })).toBe(true);
    expect(isFreeIn(doc, frameId('other'), { x: zoneX('product'), y: ZONE_TOP, w: 50, h: 50 })).toBe(true);
  });

  it('a resized block takes its own size', () => {
    const doc = createBoardDoc();
    const f = frameId('checkout');
    itemsMap(doc).set('a', item('a', f));
    layoutMap(doc).set('a', { x: zoneX('product'), y: ZONE_TOP, w: BLOCK_W, h: 900 });
    expect(nextItemSpot(doc, f)).toEqual({ x: zoneX('product'), y: ZONE_TOP + 900 + GRID_GAP });
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
    const cells = [{ x: zoneX('milestone'), y: ZONE_TOP }];
    const z = zoneRects(1000, cells);
    expect(ZONES).toEqual(['product', 'engineering', 'agreed', 'milestone']);
    expect(Object.values(z).every((r) => !r.strip && r.w === BLOCK_W + 24)).toBe(true);
    expect(z.product.x).toBeLessThan(z.engineering.x);
    expect(z.agreed.x).toBeLessThan(z.milestone.x);
    expect(z.milestone.x + z.milestone.w).toBeLessThanOrEqual(frameSize(cells).w);
    expect(z.product.y + z.product.h).toBeLessThanOrEqual(1000);
  });

  it('empty zones after the last one in use are thin strips at the right, inside the frame', () => {
    const cells = [{ x: zoneX('product'), y: ZONE_TOP }, { x: zoneX('product'), y: ZONE_TOP + BLOCK_H + GRID_GAP }];
    const z = zoneRects(1000, cells);
    expect(z.product).toMatchObject({ strip: false, w: BLOCK_W + 24 });
    for (const k of ['engineering', 'agreed', 'milestone'] as const) expect(z[k]).toMatchObject({ strip: true, w: ZONE_STRIP - 8 });
    expect(z.engineering.x).toBeGreaterThan(z.product.x + z.product.w);
    expect(z.milestone.x).toBeGreaterThan(z.agreed.x);
    const w = frameSize(cells).w;
    expect(z.milestone.x + z.milestone.w).toBeLessThanOrEqual(w);
    // Far narrower than four full columns.
    expect(w).toBe(zoneX('product') + BLOCK_W + FRAME_PAD + 3 * ZONE_STRIP);
    expect(FRAME_MIN_W).toBe(w);

    // A block in the engineering column widens it; an empty zone between two in use stays full.
    expect(zoneRects(1000, [{ x: zoneX('engineering'), y: ZONE_TOP }]).engineering.strip).toBe(false);
    const gap = zoneRects(1000, [{ x: zoneX('product'), y: ZONE_TOP }, { x: zoneX('agreed'), y: ZONE_TOP }]);
    expect([gap.engineering.strip, gap.agreed.strip, gap.milestone.strip]).toEqual([false, false, true]);
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

  it('a frame holds its zones and grows to hold its items, each with its own size', () => {
    expect(frameSize([]).w).toBe(FRAME_MIN_W);
    expect(frameSize([{ x: zoneX('engineering'), y: ZONE_TOP }]).w).toBe(zoneX('engineering') + BLOCK_W + FRAME_PAD + 2 * ZONE_STRIP);
    expect(frameSize([{ x: 2000, y: 900 }])).toEqual({ w: 2000 + BLOCK_W + FRAME_PAD, h: 900 + BLOCK_H + FRAME_PAD });
    expect(frameSize([{ x: 2000, y: 900, w: STICKY_W, h: STICKY_H }])).toEqual({ w: 2000 + STICKY_W + FRAME_PAD, h: 900 + STICKY_H + FRAME_PAD });
  });
});

describe('settling frames', () => {
  const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const frame = (doc: ReturnType<typeof createBoardDoc>, name: string, at?: { x: number; y: number }) => {
    framesMap(doc).set(`frame:${name}`, { id: `frame:${name}`, name });
    if (at) layoutMap(doc).set(`frame:${name}`, at);
  };
  const noOverlap = (doc: ReturnType<typeof createBoardDoc>) => {
    const rects = [...framesMap(doc).keys()].map((id) => frameRect(doc, id));
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i]!, rects[j]!)).toBe(false);
  };

  it('frames saved overlapping move right until clear, in order, and stay saved', () => {
    const doc = createBoardDoc();
    // Saved by an older, narrower layout: they overlap now.
    frame(doc, 'checkout', { x: 0, y: 0 });
    frame(doc, 'ui', { x: 300, y: 0 });
    frame(doc, 'docs', { x: 600, y: 0 });
    expect(settleFrames(doc)).toBe(2);
    expect(layoutMap(doc).get('frame:checkout')).toEqual({ x: 0, y: 0 });
    expect(layoutMap(doc).get('frame:ui')).toEqual({ x: FRAME_MIN_W + FRAME_GAP, y: 0 });
    expect(layoutMap(doc).get('frame:docs')).toEqual({ x: 2 * (FRAME_MIN_W + FRAME_GAP), y: 0 });
    noOverlap(doc);
    // Already clear: nothing moves again.
    expect(settleFrames(doc)).toBe(0);
  });

  it('a frame that grew pushes the frames right of it', () => {
    const doc = createBoardDoc();
    frame(doc, 'a', { x: 0, y: 0 });
    frame(doc, 'b', { x: FRAME_MIN_W + FRAME_GAP, y: 0 });
    expect(settleFrames(doc)).toBe(0);
    itemsMap(doc).set('wide', item('wide', 'frame:a'));
    layoutMap(doc).set('wide', { x: FRAME_MIN_W, y: ZONE_TOP });
    expect(settleFrames(doc)).toBe(1);
    expect(layoutMap(doc).get('frame:b')!.x).toBe(frameSize([{ x: FRAME_MIN_W, y: ZONE_TOP }]).w + FRAME_GAP);
    noOverlap(doc);
  });

  it('a frame dragged to a clear spot keeps it; one dragged onto another moves off it', () => {
    const doc = createBoardDoc();
    frame(doc, 'a', { x: 0, y: 0 });
    frame(doc, 'below', { x: 300, y: 2000 });
    frame(doc, 'onto', { x: 500, y: 100 });
    expect(settleFrames(doc)).toBe(1);
    expect(layoutMap(doc).get('frame:below')).toEqual({ x: 300, y: 2000 });
    expect(layoutMap(doc).get('frame:onto')).toEqual({ x: FRAME_MIN_W + FRAME_GAP, y: 100 });
    noOverlap(doc);
  });

  it('a frame with no layout counts as at the origin, like on the canvas', () => {
    const doc = createBoardDoc();
    frame(doc, 'a', { x: 0, y: 0 });
    frame(doc, 'b');
    expect(settleFrames(doc)).toBe(1);
    expect(layoutMap(doc).get('frame:b')).toEqual({ x: FRAME_MIN_W + FRAME_GAP, y: 0 });
  });
});
