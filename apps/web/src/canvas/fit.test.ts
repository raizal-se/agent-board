import { describe, expect, it } from 'vitest';
import { contentBounds, firstBoardBounds, firstView, fitTop, inView, readableZoom } from './fit';

const screen = (b: { minX: number; minY: number; maxX: number; maxY: number }, f: { scrollX: number; scrollY: number; zoom: number }) => ({
  left: (b.minX + f.scrollX) * f.zoom,
  top: (b.minY + f.scrollY) * f.zoom,
  right: (b.maxX + f.scrollX) * f.zoom,
  bottom: (b.maxY + f.scrollY) * f.zoom,
});

describe('the first view', () => {
  it('on a phone, wide content fills the width and starts just under the bars, not in the middle', () => {
    const b = { minX: 100, minY: 50, maxX: 2100, maxY: 650 };
    const f = fitTop(b, { width: 390, height: 844, top: 110, pad: 8 });
    const s = screen(b, f);
    expect(s.left).toBeCloseTo(8);
    expect(s.right).toBeCloseTo(382);
    expect(s.top).toBeCloseTo(110);
    expect(s.bottom).toBeLessThan(844 / 2);
  });

  it('on a wide screen, tall content fits the height, centred left to right', () => {
    const b = { minX: 0, minY: 0, maxX: 500, maxY: 2000 };
    const f = fitTop(b, { width: 1400, height: 900, top: 100, pad: 20 });
    const s = screen(b, f);
    expect(s.top).toBeCloseTo(100);
    expect(s.bottom).toBeCloseTo(880);
    expect((s.left + s.right) / 2).toBeCloseTo(700);
  });

  it('small content is not blown up past full size', () => {
    const f = fitTop({ minX: 0, minY: 0, maxX: 200, maxY: 100 }, { width: 1400, height: 900, top: 100, pad: 20 });
    expect(f.zoom).toBe(1);
  });

  it('a box is in view only if it shows whole, under the bars', () => {
    const v = { scrollX: 0, scrollY: 0, zoom: 0.5, width: 1000, height: 800, top: 100 };
    // On screen: scene x 0..2000, y 200..1600 (the top 100 px are bars, 200 scene px at zoom 0.5).
    expect(inView({ minX: 10, minY: 250, maxX: 400, maxY: 500 }, v)).toBe(true);
    expect(inView({ minX: 10, minY: 150, maxX: 400, maxY: 500 }, v)).toBe(false);
    expect(inView({ minX: 10, minY: 1500, maxX: 400, maxY: 1700 }, v)).toBe(false);
    expect(inView({ minX: 1900, minY: 250, maxX: 2100, maxY: 500 }, v)).toBe(false);
  });

  it('keeps room free at the bottom for a selection bar there', () => {
    const b = { minX: 0, minY: 0, maxX: 500, maxY: 2000 };
    const f = fitTop(b, { width: 1400, height: 900, top: 100, pad: 20, bottom: 120 });
    expect(screen(b, f).bottom).toBeCloseTo(780);
    const v = { scrollX: 0, scrollY: 0, zoom: 1, width: 1000, height: 800, top: 100, bottom: 120 };
    expect(inView({ minX: 10, minY: 200, maxX: 400, maxY: 680 }, v)).toBe(true);
    expect(inView({ minX: 10, minY: 200, maxX: 400, maxY: 700 }, v)).toBe(false);
  });

  it('bounds cover the live elements only', () => {
    expect(contentBounds([])).toBeNull();
    expect(
      contentBounds([
        { x: 10, y: 20, width: 100, height: 50 },
        { x: -5, y: 300, width: 10, height: 10 },
        { x: 9999, y: 9999, width: 1, height: 1, isDeleted: true },
      ]),
    ).toEqual({ minX: -5, minY: 20, maxX: 110, maxY: 310 });
  });
});

describe('the first view opens on the first feature board, readable', () => {
  // A frame at 3320 and one at 0: the first is the leftmost. Each has four areas.
  const frame = (id: string, x: number) => [
    { id, type: 'frame', x, y: 0, width: 2920, height: 2200 },
    { id: `${id}~zone:product`, type: 'rectangle', x: x + 40, y: 40, width: 1404, height: 1000 },
    { id: `${id}~zone:engineering`, type: 'rectangle', x: x + 1476, y: 40, width: 1404, height: 1000 },
    { id: `${id}~zone:agreed`, type: 'rectangle', x: x + 40, y: 1072, width: 1404, height: 1000 },
  ];
  const els = [...frame('frame:ui', 3320), ...frame('frame:checkout', 0)];

  it('takes the Product and Engineering areas of the leftmost frame', () => {
    expect(firstBoardBounds(els)).toEqual({ minX: 40, minY: 40, maxX: 2880, maxY: 1040 });
    expect(firstBoardBounds([...els, { id: 'frame:checkout~zone:engineering', type: 'rectangle', x: 0, y: 0, width: 1, height: 1, isDeleted: true }])).toEqual({
      minX: 40,
      minY: 40,
      maxX: 2880,
      maxY: 1040,
    });
    // No frames yet: whatever is on the board.
    expect(firstBoardBounds([{ id: 'n', type: 'rectangle', x: 5, y: 6, width: 10, height: 10 }])).toEqual({ minX: 5, minY: 6, maxX: 15, maxY: 16 });
    expect(firstBoardBounds([])).toBeNull();
  });

  it('on a desktop both areas show across at about half size, from the top under the bars', () => {
    const b = firstBoardBounds(els)!;
    const space = { width: 1440, height: 900, top: 152, pad: 12 };
    const f = firstView(b, space, readableZoom(space, false));
    expect(f.zoom).toBeGreaterThan(0.45);
    const s = screen(b, f);
    expect(s.left).toBeGreaterThanOrEqual(12 - 0.01);
    expect(s.right).toBeLessThanOrEqual(1440 - 12 + 0.01);
    expect(s.top).toBeCloseTo(152);
  });

  it('on a narrow desktop it does not shrink past readable: Product from its left edge, Engineering off to the right', () => {
    const b = firstBoardBounds(els)!;
    const space = { width: 1000, height: 800, top: 152, pad: 12 };
    const f = firstView(b, space, readableZoom(space, false));
    expect(f.zoom).toBeCloseTo(0.45);
    const s = screen(b, f);
    expect(s.left).toBeCloseTo(12);
    expect(s.right).toBeGreaterThan(1000);
  });

  it('on a phone one card fills the width: the first card column of Product, its text readable', () => {
    const b = firstBoardBounds(els)!;
    const space = { width: 412, height: 915, top: 112, pad: 12, bottom: 120 };
    const z = readableZoom(space, true);
    // A 520 card and the area's padding on both sides fill the width.
    expect(z).toBeCloseTo((412 - 24) / (520 + 64));
    const f = firstView(b, space, z);
    expect(f.zoom).toBeCloseTo(z);
    const s = screen(b, f);
    expect(s.left).toBeCloseTo(12);
    expect(s.top).toBeCloseTo(112);
  });

  it('never past full size', () => {
    const f = firstView({ minX: 0, minY: 0, maxX: 400, maxY: 300 }, { width: 1440, height: 900, top: 152, pad: 12 }, 0.45);
    expect(f.zoom).toBe(1);
  });
});
