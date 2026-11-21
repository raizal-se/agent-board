import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BOARD_MAPS, boardMap, createBoardDoc } from './index';

describe('createBoardDoc', () => {
  it('has every top-level map', () => {
    const doc = createBoardDoc();
    for (const name of BOARD_MAPS) expect(doc.share.has(name)).toBe(true);
  });

  it('syncs an item between two docs through updates', () => {
    const a = createBoardDoc();
    const b = createBoardDoc();
    a.on('update', (u: Uint8Array) => Y.applyUpdate(b, u));
    boardMap(a, 'items').set('flow.md', { zone: 'product' });
    expect(boardMap(b, 'items').get('flow.md')).toEqual({ zone: 'product' });
  });
});
