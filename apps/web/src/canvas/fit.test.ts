import { describe, expect, it } from 'vitest';
import { contentBounds, fitTop } from './fit';

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
