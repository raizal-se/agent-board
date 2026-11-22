import { CARD_MAX_H, CARD_MIN_H } from '@agent-board/model';
import { useEffect, useRef, useState } from 'react';
import { useBoardActions } from '../board/actions';

/** Smaller changes than this are left alone, so a card does not twitch on a pixel of rounding. */
const SLACK = 3;
/** An embed that is not drawn has no size; a narrower card is not laid out yet. */
const MIN_MEASURED_W = 200;

/**
 * The height a card should have for its content: the card's own parts (header, marks) plus the
 * content's natural height, between the smallest card and the cap. Past the cap the content scrolls
 * inside the card. Null when nothing needs to change.
 */
export function fitTarget(m: { cardW: number; cardH: number; bodyH: number; contentH: number }): number | null {
  if (m.cardW < MIN_MEASURED_W || m.contentH <= 0) return null;
  const want = Math.min(CARD_MAX_H, Math.max(CARD_MIN_H, Math.ceil(m.cardH - m.bodyH + m.contentH)));
  return Math.abs(want - m.cardH) > SLACK ? want : null;
}

/**
 * Measures a card and makes its height follow its content (see `fitTarget`). Excalidraw sizes the
 * embed to the element in scene units (the zoom is a transform), so `offsetHeight` is the card's
 * height on the board. Returns the refs to put on the card, its scrolling body and the content in
 * it, and whether the content is taller than the body (it then scrolls, with a fade).
 */
export function useCardFit(layoutId: string) {
  const { fitHeight } = useBoardActions();
  const card = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    const c = card.current;
    const b = body.current;
    const i = content.current;
    if (!c || !b || !i) return;
    const measure = () => {
      const m = { cardW: c.offsetWidth, cardH: c.offsetHeight, bodyH: b.clientHeight, contentH: i.offsetHeight };
      if (m.cardW < MIN_MEASURED_W) return;
      setOverflow(m.contentH > m.bodyH + SLACK);
      const h = fitTarget(m);
      if (h !== null) fitHeight(layoutId, h);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(c);
    ro.observe(i);
    measure();
    return () => ro.disconnect();
  }, [layoutId, fitHeight]);

  return { card, body, content, overflow };
}
