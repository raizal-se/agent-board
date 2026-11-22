import { describe, expect, it } from 'vitest';
import { agreeItem } from './agreement';
import {
  areaOf,
  frameGeo,
  frameRect,
  isFreeIn,
  nextFrameSpot,
  nextItemSpot,
  resolveArea,
  settleAreas,
  settleFrames,
  sidesMap,
  snapId,
  switchArea,
  type AreaOverride,
} from './area';
import { createBoardDoc, type Device } from './index';
import { fileItemOf, framesMap, itemsMap, type FileItem } from './items';
import { AREA_MIN_H, AREA_MIN_W, AREA_PAD, AREA_TOP, BLOCK_W, FRAME_GAP, frameSizeFor, GRID_GAP, gridsMap, layoutMap, MIN_GRID, overlaps, type Rect } from './layout';
import { addSticky, type Person } from './native';

type Doc = ReturnType<typeof createBoardDoc>;
const raizal: Person = { name: 'Raizal', side: 'product' };
const F = 'frame:checkout';
const MIN_FRAME = frameSizeFor(MIN_GRID);

function file(id: string, over: Partial<FileItem> = {}): FileItem {
  return { id, kind: 'file', path: `checkout/${id}.md`, frame: F, type: 'markdown', text: '', hash: `h:${id}`, owner: 'Arif', gone: false, updatedAt: 0, ...over };
}

/** A board with Arif on engineering, and a frame. */
function board(): Doc {
  const doc = createBoardDoc();
  doc.getMap<Device>('devices').set('Arif', { id: 'Arif', name: 'Arif', side: 'engineering' });
  framesMap(doc).set(F, { id: F, name: 'checkout' });
  layoutMap(doc).set(F, { x: 0, y: 0 });
  return doc;
}

/** What the CLI does for a new file: the item, and a spot in its area once. */
function add(doc: Doc, f: FileItem, h = 400): void {
  itemsMap(doc).set(f.id, f);
  layoutMap(doc).set(f.id, { ...nextItemSpot(doc, f.frame, { area: areaOf(doc, f).area, h }), w: BLOCK_W, h });
}

describe('which area a block is in', () => {
  const ov = (side: 'product' | 'engineering', fileArea: 'product' | 'engineering' | null): AreaOverride => ({ item: 'a', side, by: 'Raizal', at: 5, fileArea });

  it('the file says it; with nothing said, the owner side applies', () => {
    expect(resolveArea({ area: 'engineering' }, 'product')).toEqual({ area: 'engineering', source: 'file' });
    expect(resolveArea({}, 'engineering')).toEqual({ area: 'engineering', source: 'owner side' });
    expect(resolveArea({ area: null }, 'product')).toEqual({ area: 'product', source: 'owner side' });
  });

  it('a person switch holds, with who and when, while the file says what it said', () => {
    expect(resolveArea({ area: 'engineering' }, 'product', ov('product', 'engineering'))).toEqual({ area: 'product', source: 'human', by: 'Raizal', at: 5 });
    expect(resolveArea({}, 'engineering', ov('product', null))).toMatchObject({ area: 'product', source: 'human' });
  });

  it('a new area value in the file wins over the switch', () => {
    expect(resolveArea({ area: 'product' }, 'product', ov('engineering', 'engineering'))).toEqual({ area: 'product', source: 'file' });
    expect(resolveArea({ area: 'engineering' }, 'product', ov('product', null))).toEqual({ area: 'engineering', source: 'file' });
    // The file dropped its area: that is a change too, and the owner side applies.
    expect(resolveArea({}, 'engineering', ov('product', 'product'))).toEqual({ area: 'engineering', source: 'owner side' });
  });

  it('on the doc: owner side from devices, an unknown owner is product', () => {
    const doc = board();
    expect(areaOf(doc, file('a'))).toEqual({ area: 'engineering', source: 'owner side' });
    expect(areaOf(doc, file('b', { owner: 'Nobody' }))).toEqual({ area: 'product', source: 'owner side' });
    expect(areaOf(doc, file('c', { area: 'product' }))).toEqual({ area: 'product', source: 'file' });
  });
});

describe('placing a block once', () => {
  it('a new block lands in a free spot in its own area', () => {
    const doc = board();
    add(doc, file('api'));
    add(doc, file('flow', { area: 'product' }));
    add(doc, file('db'));
    expect(layoutMap(doc).get('api')).toMatchObject({ x: AREA_PAD, y: AREA_TOP });
    expect(layoutMap(doc).get('flow')).toMatchObject({ x: AREA_PAD, y: AREA_TOP });
    expect(layoutMap(doc).get('db')).toMatchObject({ x: AREA_PAD + BLOCK_W + GRID_GAP, y: AREA_TOP });
    const geo = frameGeo(doc, F);
    expect(geo.cells.map((c) => [c.id, c.area])).toEqual([['api', 'engineering'], ['flow', 'product'], ['db', 'engineering']]);
  });

  it('later saves do not move a block, and a moved block stays where the person put it', () => {
    const doc = board();
    add(doc, file('api'));
    add(doc, file('db'));
    layoutMap(doc).set('api', { x: 700, y: 900, w: BLOCK_W, h: 400 });
    // A save rewrites the item; nothing reflows.
    itemsMap(doc).set('api', file('api', { text: 'v2', hash: 'h2' }));
    itemsMap(doc).set('db', file('db', { text: 'v2', hash: 'h3' }));
    settleAreas(doc);
    settleFrames(doc);
    expect(layoutMap(doc).get('api')).toMatchObject({ x: 700, y: 900 });
    expect(layoutMap(doc).get('db')).toMatchObject({ x: AREA_PAD + BLOCK_W + GRID_GAP, y: AREA_TOP });
    // The next new block takes the spot api left.
    expect(nextItemSpot(doc, F, { area: 'engineering', h: 400 })).toEqual({ x: AREA_PAD, y: AREA_TOP });
  });

  it('a spot is free when nothing in the frame overlaps it', () => {
    const doc = board();
    add(doc, file('api'));
    const eng = frameGeo(doc, F).areas.engineering;
    const at = { x: eng.x + AREA_PAD + 10, y: eng.y + AREA_TOP + 10, w: 50, h: 50 };
    expect(isFreeIn(doc, F, at)).toBe(false);
    expect(isFreeIn(doc, F, at, 'api')).toBe(true);
    expect(isFreeIn(doc, 'frame:other', at)).toBe(true);
  });
});

describe('areas grow and never shrink', () => {
  it('a tall block grows its row; settleAreas keeps it after the block moves away', () => {
    const doc = board();
    add(doc, file('api'), 1400);
    add(doc, file('db'), 1400);
    add(doc, file('more'), 1400);
    const grown = frameGeo(doc, F).grid;
    expect(grown.rows[0]).toBeGreaterThan(AREA_MIN_H);
    expect(settleAreas(doc)).toBe(1);
    expect(gridsMap(doc).get(F)).toEqual(grown);
    expect(settleAreas(doc)).toBe(0);
    // Moved back up: the area keeps its size.
    layoutMap(doc).set('more', { x: AREA_PAD, y: AREA_TOP, w: 100, h: 100 });
    layoutMap(doc).delete('db');
    layoutMap(doc).delete('api');
    expect(frameGeo(doc, F).grid).toEqual(grown);
  });

  it('a block wider than the area widens its column', () => {
    const doc = board();
    itemsMap(doc).set('wide', file('wide'));
    layoutMap(doc).set('wide', { x: AREA_PAD, y: AREA_TOP, w: AREA_MIN_W + 500, h: 400 });
    expect(frameGeo(doc, F).grid.cols[1]).toBe(AREA_PAD + AREA_MIN_W + 500 + AREA_PAD);
  });

  it('notes in a frame grow the frame, not an area', () => {
    const doc = board();
    const s = addSticky(doc, { by: raizal, frame: F, x: MIN_FRAME.w + 100, y: 50, text: 'n' });
    expect(frameGeo(doc, F).notes.map((n) => n.id)).toEqual([s]);
    expect(frameGeo(doc, F).grid).toEqual(MIN_GRID);
    expect(frameRect(doc, F).w).toBeGreaterThan(MIN_FRAME.w + 100);
  });
});

describe('switching a block area', () => {
  it('stores who and when, and moves the block to a free spot in the other area', () => {
    const doc = board();
    add(doc, file('flow', { area: 'product' }));
    add(doc, file('api'));
    expect(switchArea(doc, 'api', 'product', { by: raizal, now: 9 })).toBe(true);
    expect(sidesMap(doc).get('api')).toEqual({ item: 'api', side: 'product', by: 'Raizal', at: 9, fileArea: null });
    expect(areaOf(doc, fileItemOf(doc, 'api')!)).toEqual({ area: 'product', source: 'human', by: 'Raizal', at: 9 });
    expect(layoutMap(doc).get('api')).toMatchObject({ x: AREA_PAD + BLOCK_W + GRID_GAP, y: AREA_TOP, w: BLOCK_W, h: 400 });
    expect(switchArea(doc, 'nope', 'product', { by: raizal })).toBe(false);
  });

  it('switching to the area it is in already records the switch and does not move it', () => {
    const doc = board();
    add(doc, file('api'));
    layoutMap(doc).set('api', { x: 600, y: 300, w: BLOCK_W, h: 400 });
    switchArea(doc, 'api', 'engineering', { by: raizal, now: 1 });
    expect(layoutMap(doc).get('api')).toMatchObject({ x: 600, y: 300 });
    expect(areaOf(doc, fileItemOf(doc, 'api')!).source).toBe('human');
  });

  it('a save with the same area keeps the switch; a new area value wins', () => {
    const doc = board();
    add(doc, file('api', { area: 'engineering' }));
    switchArea(doc, 'api', 'product', { by: raizal });
    itemsMap(doc).set('api', file('api', { area: 'engineering', text: 'v2', hash: 'h2' }));
    expect(areaOf(doc, fileItemOf(doc, 'api')!)).toMatchObject({ area: 'product', source: 'human' });
    itemsMap(doc).set('api', file('api', { area: 'product', text: 'v3', hash: 'h3' }));
    expect(areaOf(doc, fileItemOf(doc, 'api')!)).toEqual({ area: 'product', source: 'file' });
  });
});

describe('snapshot cards and frames', () => {
  it('a snapshot card is in Agreed; settleAreas gives one with no spot a free one', () => {
    const doc = board();
    add(doc, file('api', { text: 'v1' }));
    agreeItem(doc, 'api', { by: raizal, now: 1 });
    expect(frameGeo(doc, F).cells.find((c) => c.id === snapId('api'))).toMatchObject({ area: 'agreed', x: AREA_PAD, y: AREA_TOP });
    layoutMap(doc).delete(snapId('api'));
    expect(settleAreas(doc)).toBeGreaterThanOrEqual(1);
    expect(layoutMap(doc).get(snapId('api'))).toEqual({ x: AREA_PAD, y: AREA_TOP });
  });

  const frame = (doc: Doc, name: string, at?: { x: number; y: number }) => {
    framesMap(doc).set(`frame:${name}`, { id: `frame:${name}`, name });
    if (at) layoutMap(doc).set(`frame:${name}`, at);
  };
  const apart = (doc: Doc) => {
    const rects: Rect[] = [...framesMap(doc).keys()].map((id) => frameRect(doc, id));
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        expect(overlaps({ x: a.x - FRAME_GAP / 2, y: a.y - FRAME_GAP / 2, w: a.w + FRAME_GAP, h: a.h + FRAME_GAP }, rects[j]!)).toBe(false);
      }
  };

  it('new frames go right of the others, a wide gap apart', () => {
    const doc = createBoardDoc();
    const a = nextFrameSpot(doc);
    frame(doc, 'a', a);
    expect(nextFrameSpot(doc)).toEqual({ x: a.x + MIN_FRAME.w + FRAME_GAP, y: 0 });
  });

  it('frames saved overlapping move right until clear, and stay', () => {
    const doc = createBoardDoc();
    frame(doc, 'checkout', { x: 0, y: 0 });
    frame(doc, 'ui', { x: 300, y: 0 });
    frame(doc, 'docs');
    expect(settleFrames(doc)).toBe(2);
    expect(layoutMap(doc).get('frame:checkout')).toEqual({ x: 0, y: 0 });
    apart(doc);
    expect(settleFrames(doc)).toBe(0);
  });

  it('a frame whose area grew pushes the frame right of it', () => {
    const doc = board();
    frame(doc, 'b', { x: MIN_FRAME.w + FRAME_GAP, y: 0 });
    expect(settleFrames(doc)).toBe(0);
    itemsMap(doc).set('wide', file('wide'));
    layoutMap(doc).set('wide', { x: AREA_PAD, y: AREA_TOP, w: AREA_MIN_W + 500, h: 400 });
    expect(settleFrames(doc)).toBe(1);
    expect(layoutMap(doc).get('frame:b')!.x).toBe(frameRect(doc, F).w + FRAME_GAP);
    apart(doc);
  });

  it('a frame dragged to a clear spot keeps it', () => {
    const doc = createBoardDoc();
    frame(doc, 'a', { x: 0, y: 0 });
    frame(doc, 'below', { x: 300, y: MIN_FRAME.h + FRAME_GAP });
    expect(settleFrames(doc)).toBe(0);
  });
});
