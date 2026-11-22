import { describe, expect, it } from 'vitest';
import { fitToContent, MIN_SCALE, PAGE_MAX_H, PAGE_W, THUMB_W, thumbSize, WHOLE_PAGE } from './thumbFit';

describe('fitToContent', () => {
  it('the page lays out wide enough that the thumbnail is never below 0.6 of it', () => {
    expect(WHOLE_PAGE.scale).toBeGreaterThanOrEqual(MIN_SCALE - 0.001);
    for (const box of [[0, 0, PAGE_W, 500], [0, 0, 5000, 500], [8, 8, 600, 300]]) {
      expect(fitToContent(box).scale).toBeGreaterThanOrEqual(MIN_SCALE - 0.001);
    }
  });

  it('zooms a small mockup in the top left to fill the thumbnail width', () => {
    const f = fitToContent([8, 8, 600, 300]);
    expect(f.x).toBe(0);
    expect(f.y).toBe(0);
    expect(f.scale).toBeCloseTo(THUMB_W / 616);
    expect(f.scale).toBeGreaterThan(WHOLE_PAGE.scale);
    expect(f.h).toBe(316);
  });

  it('crops the empty margin of a centred card', () => {
    const f = fitToContent([300, 100, 600, 500]);
    expect(f.x).toBe(284);
    expect(f.y).toBe(84);
    expect(f.scale).toBeCloseTo(THUMB_W / 360);
    expect(f.h).toBe(432);
  });

  it('shows a long page at its full height', () => {
    const f = fitToContent([0, 0, PAGE_W, 2600]);
    expect(f).toMatchObject({ x: 0, y: 0, h: 2616 });
    expect(f.scale).toBeCloseTo(WHOLE_PAGE.scale);
    expect(thumbSize(f)).toEqual({ w: THUMB_W, h: Math.round(2616 * f.scale) });
    expect(fitToContent([0, 0, PAGE_W, 50_000]).h).toBe(PAGE_MAX_H);
  });

  it('never zooms past a minimum width, nor shrinks below a minimum height', () => {
    const f = fitToContent([0, 0, 40, 20]);
    expect(f.scale).toBeCloseTo(THUMB_W / 360);
    expect(thumbSize(f).h).toBeGreaterThanOrEqual(120);
  });

  it('ignores anything that is not four finite numbers', () => {
    for (const bad of [null, 'x', [1, 2, 3], [0, 0, NaN, 1], [0, 0, Infinity, 1], [10, 0, 5, 5], { 0: 1 }]) {
      expect(fitToContent(bad)).toEqual(WHOLE_PAGE);
    }
  });
});
