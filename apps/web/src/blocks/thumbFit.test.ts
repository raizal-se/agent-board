import { describe, expect, it } from 'vitest';
import { fitToContent, PAGE_W, THUMB_W, WHOLE_PAGE } from './thumbFit';

describe('fitToContent', () => {
  it('zooms a small mockup in the top left to fill the thumbnail width', () => {
    const f = fitToContent([8, 8, 600, 300]);
    expect(f.x).toBe(0);
    expect(f.y).toBe(0);
    expect(f.scale).toBeCloseTo(THUMB_W / 616);
    expect(f.scale).toBeGreaterThan(WHOLE_PAGE.scale * 2);
  });

  it('crops the empty margin of a centred card', () => {
    const f = fitToContent([440, 100, 840, 500]);
    expect(f.x).toBe(424);
    expect(f.y).toBe(84);
    expect(f.scale).toBeCloseTo(THUMB_W / 432);
  });

  it('a full-width page stays the whole page', () => {
    expect(fitToContent([0, 0, PAGE_W, 2000])).toEqual(WHOLE_PAGE);
  });

  it('never zooms past a minimum width', () => {
    expect(fitToContent([0, 0, 40, 20]).scale).toBeCloseTo(THUMB_W / 360);
  });

  it('ignores anything that is not four finite numbers', () => {
    for (const bad of [null, 'x', [1, 2, 3], [0, 0, NaN, 1], [0, 0, Infinity, 1], [10, 0, 5, 5], { 0: 1 }]) {
      expect(fitToContent(bad)).toEqual(WHOLE_PAGE);
    }
  });
});
