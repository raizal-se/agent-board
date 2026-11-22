import { describe, expect, it } from 'vitest';
import { frameNameForPath } from './items';
import {
  AREA_GAP,
  AREA_MIN_H,
  AREA_MIN_W,
  AREA_PAD,
  AREA_TOP,
  areaOrigin,
  areaRect,
  BLOCK_W,
  CARD_MAX_H,
  CARD_MIN_H,
  estimateCardH,
  FRAME_PAD,
  frameSizeFor,
  freeSpot,
  GRID_GAP,
  gridFor,
  MIN_GRID,
  overlaps,
} from './layout';

describe('frames', () => {
  it('a first-level folder is the frame, root files use the root name', () => {
    expect(frameNameForPath('checkout/api.md', 'payments')).toBe('checkout');
    expect(frameNameForPath('checkout/deep/x.md', 'payments')).toBe('checkout');
    expect(frameNameForPath('readme.md', 'payments')).toBe('payments');
  });
});

describe('the four areas', () => {
  it('an empty area is about two and a half cards wide and two cards tall', () => {
    expect(AREA_MIN_W).toBeGreaterThanOrEqual(BLOCK_W * 2.5);
    expect(AREA_MIN_W).toBeLessThan(BLOCK_W * 3.2);
    expect(AREA_MIN_H).toBeGreaterThanOrEqual(900);
  });

  it('product top left, engineering top right, agreed bottom left, milestone bottom right', () => {
    const g = MIN_GRID;
    const r = { product: areaRect(g, 'product'), engineering: areaRect(g, 'engineering'), agreed: areaRect(g, 'agreed'), milestone: areaRect(g, 'milestone') };
    expect(r.product).toEqual({ x: FRAME_PAD, y: FRAME_PAD, w: AREA_MIN_W, h: AREA_MIN_H });
    expect(r.engineering).toMatchObject({ x: FRAME_PAD + AREA_MIN_W + AREA_GAP, y: FRAME_PAD });
    expect(r.agreed).toMatchObject({ x: FRAME_PAD, y: FRAME_PAD + AREA_MIN_H + AREA_GAP });
    expect(r.milestone).toMatchObject({ x: r.engineering.x, y: r.agreed.y });
    const all = Object.values(r);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i]!, all[j]!)).toBe(false);
    const size = frameSizeFor(g);
    expect(r.milestone.x + r.milestone.w + FRAME_PAD).toBe(size.w);
    expect(r.milestone.y + r.milestone.h + FRAME_PAD).toBe(size.h);
  });

  it('an area grows to hold what is in it, and its row or column grows with it', () => {
    const g = gridFor([{ id: 'a', area: 'engineering', x: AREA_PAD, y: 2000, w: BLOCK_W, h: 600 }]);
    expect(g.rows[0]).toBe(2000 + 600 + AREA_PAD);
    expect(g.cols).toEqual([AREA_MIN_W, AREA_MIN_W]);
    expect(g.rows[1]).toBe(AREA_MIN_H);
    // The area beside it (same row) is as tall; the areas below move down.
    expect(areaRect(g, 'product').h).toBe(g.rows[0]);
    expect(areaOrigin(g, 'agreed').y).toBe(FRAME_PAD + g.rows[0] + AREA_GAP);
  });

  it('an area never shrinks below the grid it had', () => {
    const big = { cols: [3000, AREA_MIN_W] as [number, number], rows: [AREA_MIN_H, 2500] as [number, number] };
    expect(gridFor([], big)).toEqual(big);
    expect(gridFor([], { cols: [10, 10], rows: [10, 10] })).toEqual(MIN_GRID);
  });

  it('notes in the frame make room for themselves', () => {
    const size = frameSizeFor(MIN_GRID, [{ x: 5000, y: 10, w: 200, h: 160 }]);
    expect(size.w).toBe(5000 + 200 + FRAME_PAD);
    expect(size.h).toBe(frameSizeFor(MIN_GRID).h);
  });
});

describe('a free spot in an area', () => {
  const want = { w: BLOCK_W, h: 400 };

  it('the first spot is at the top left, under the label; the next is to its right', () => {
    const a = freeSpot([], AREA_MIN_W, want);
    expect(a).toEqual({ x: AREA_PAD, y: AREA_TOP });
    const b = freeSpot([{ ...a, ...want }], AREA_MIN_W, want);
    expect(b).toEqual({ x: AREA_PAD + BLOCK_W + GRID_GAP, y: AREA_TOP });
  });

  it('when a row is full the next spot is below, a gap clear of what is there', () => {
    const taken = [
      { x: AREA_PAD, y: AREA_TOP, w: BLOCK_W, h: 400 },
      { x: AREA_PAD + BLOCK_W + GRID_GAP, y: AREA_TOP, w: BLOCK_W, h: 700 },
    ];
    const c = freeSpot(taken, AREA_MIN_W, want);
    expect(c).toEqual({ x: AREA_PAD, y: AREA_TOP + 400 + GRID_GAP });
    for (const t of taken) expect(overlaps(t, { ...c, ...want })).toBe(false);
  });

  it('a spot a card was moved away from is free again; a moved card keeps its new place taken', () => {
    const moved = [{ x: 900, y: 600, w: BLOCK_W, h: 400 }];
    expect(freeSpot(moved, AREA_MIN_W, want)).toEqual({ x: AREA_PAD, y: AREA_TOP });
    const s = freeSpot([...moved, { x: AREA_PAD, y: AREA_TOP, ...want }], AREA_MIN_W, want);
    expect(overlaps({ ...s, ...want }, moved[0]!)).toBe(false);
  });

  it('a card wider than the area goes below everything (the area then grows)', () => {
    const s = freeSpot([{ x: AREA_PAD, y: AREA_TOP, w: 100, h: 100 }], 300, { w: 1000, h: 100 });
    expect(s).toEqual({ x: AREA_PAD, y: AREA_TOP + 100 + GRID_GAP });
  });
});

describe('a card height before it is measured', () => {
  it('follows the text, from a small card up to the cap; html gets a tall page', () => {
    expect(estimateCardH('markdown', '')).toBe(CARD_MIN_H);
    const long = Array.from({ length: 30 }, (_, i) => `line ${i} with some words in it`).join('\n');
    const short = estimateCardH('markdown', '# Title\nA line.');
    expect(estimateCardH('markdown', long)).toBeGreaterThan(short);
    expect(estimateCardH('markdown', long.repeat(20))).toBe(CARD_MAX_H);
    expect(estimateCardH('html', '<p>x</p>')).toBeGreaterThanOrEqual(600);
  });
});
