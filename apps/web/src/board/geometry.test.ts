import { describe, expect, it } from 'vitest';
import { borderPoint, floatingEnds } from './geometry';

const box = (x: number, y: number, w = 100, h = 50) => ({ x, y, w, h });

describe('floating edge ends', () => {
  it('leaves and enters on the facing sides of side-by-side blocks', () => {
    const { source, target } = floatingEnds(box(0, 0), box(300, 0));
    expect(source).toEqual({ x: 100, y: 25 });
    expect(target).toEqual({ x: 300, y: 25 });
  });

  it('uses the top and bottom for stacked blocks', () => {
    const { source, target } = floatingEnds(box(0, 0), box(0, 200));
    expect(source).toEqual({ x: 50, y: 50 });
    expect(target).toEqual({ x: 50, y: 200 });
  });

  it('a diagonal ends on the border, on the line between the centres', () => {
    const p = borderPoint(box(0, 0, 100, 100), box(300, 100, 100, 100));
    expect(p.x).toBe(100);
    expect(p.y).toBeCloseTo(50 + 50 / 3);
  });

  it('edges between different pairs do not share a line', () => {
    const a = floatingEnds(box(0, 0), box(300, 0));
    const b = floatingEnds(box(0, 200), box(300, 400));
    expect(a.source.y).not.toBe(b.source.y);
  });
});
