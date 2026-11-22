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
