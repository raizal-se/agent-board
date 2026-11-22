import { useSyncExternalStore } from 'react';

/**
 * Where our bars sit, and so what room the board keeps free for them. On a wide screen the header
 * and the selection bar sit at the top. On a narrow one (a phone) the selection bar sits at the
 * bottom, in reach of the thumb: a tapped block's own buttons are at its top, near the finger, and a
 * bar at the top would cover them (the header is there too).
 */
export const NARROW_QUERY = '(max-width: 640px)';

export interface BarRoom {
  /** Screen px kept free at the top. */
  top: number;
  /** Screen px kept free at the bottom. */
  bottom: number;
}

/** styles.css: the top overlay starts at 64 px, the bottom one ends 64 px up; header and bar are ~40 px each. */
export function barRoom(narrow: boolean): BarRoom {
  return narrow ? { top: 112, bottom: 120 } : { top: 152, bottom: 12 };
}

/** One line of the selection bar (styles.css: 32 px buttons, 6 px padding, 1 px border) and the gap above it. */
const SELECTION_BAR = 46;
const GAP = 6;
/** Room kept between a bar and a card. */
const MARGIN = 6;

/**
 * The room the bars take now, measured on the page, with room for the selection bar when it is
 * not shown yet (a click shows it). Never less than barRoom(). The header can wrap to two lines
 * (a phone, or a shared board with more buttons), so a fixed value can leave a card under it.
 */
export function liveBarRoom(): BarRoom {
  const narrow = isNarrow();
  const room = { ...barRoom(narrow) };
  if (typeof document === 'undefined') return room;
  const root = document.querySelector('.board-root')?.getBoundingClientRect();
  if (!root) return room;
  const hasBar = !!document.querySelector('[data-testid="selection-bar"]');
  const extra = hasBar ? 0 : SELECTION_BAR + GAP;
  const top = document.querySelector('.board-overlay-top')?.getBoundingClientRect();
  if (top && top.height > 0) room.top = Math.max(room.top, Math.ceil(top.bottom - root.top + (narrow ? 0 : extra) + MARGIN));
  const bottom = document.querySelector('.board-overlay-bottom')?.getBoundingClientRect();
  if (narrow && bottom && bottom.height > 0) room.bottom = Math.max(room.bottom, Math.ceil(root.bottom - bottom.top + extra + MARGIN));
  return room;
}

export function isNarrow(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(NARROW_QUERY).matches;
}

/** Whether the screen is narrow, and re-render when that changes (a phone turned, a window resized). */
export function useNarrow(): boolean {
  return useSyncExternalStore(
    (on) => {
      const mq = window.matchMedia?.(NARROW_QUERY);
      mq?.addEventListener('change', on);
      return () => mq?.removeEventListener('change', on);
    },
    isNarrow,
    () => false,
  );
}
