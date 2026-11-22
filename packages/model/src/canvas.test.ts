import { describe, expect, it } from 'vitest';
import { canvasMap, isCanvasShape } from './canvas';
import { BOARD_MAPS, createBoardDoc } from './index';

describe('free drawing', () => {
  it('is a board map of shapes by element id', () => {
    expect(BOARD_MAPS).toContain('canvas');
    const doc = createBoardDoc();
    canvasMap(doc).set('el1', { id: 'el1', type: 'ellipse', x: 1 });
    expect(canvasMap(doc).get('el1')).toEqual({ id: 'el1', type: 'ellipse', x: 1 });
    expect(isCanvasShape(canvasMap(doc).get('el1'))).toBe(true);
    expect(isCanvasShape({ id: 'x' })).toBe(false);
    expect(isCanvasShape(null)).toBe(false);
  });
});
