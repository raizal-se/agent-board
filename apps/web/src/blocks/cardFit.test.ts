import { CARD_MAX_H, CARD_MIN_H } from '@agent-board/model';
import { describe, expect, it } from 'vitest';
import { fitTarget } from './cardFit';

describe('a card follows its content', () => {
  // A card of 480 with 120 of header and marks: its body is 360.
  const card = { cardW: 520, cardH: 480, bodyH: 360 };

  it('grows to its content', () => {
    expect(fitTarget({ ...card, contentH: 900 })).toBe(1020);
  });

  it('shrinks to short content, not below the smallest card', () => {
    expect(fitTarget({ ...card, contentH: 200 })).toBe(320);
    expect(fitTarget({ ...card, contentH: 10 })).toBe(CARD_MIN_H);
  });

  it('stops at the cap: past it the content scrolls inside', () => {
    expect(fitTarget({ ...card, contentH: 5000 })).toBe(CARD_MAX_H);
  });

  it('leaves a card alone when it already fits, within a few pixels', () => {
    expect(fitTarget({ ...card, contentH: 360 })).toBeNull();
    expect(fitTarget({ ...card, contentH: 362.5 })).toBeNull();
  });

  it('measures nothing on a card that is not laid out (off screen, no size)', () => {
    expect(fitTarget({ cardW: 0, cardH: 0, bodyH: 0, contentH: 0 })).toBeNull();
    expect(fitTarget({ ...card, contentH: 0 })).toBeNull();
  });
});
