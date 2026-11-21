import * as Y from 'yjs';

export type Side = 'product' | 'engineering';
export type Zone = 'product' | 'engineering' | 'agreed' | 'milestone' | 'none';

/** Top-level maps of one board document (implementation plan, section 2.2). */
export const BOARD_MAPS = ['frames', 'items', 'edges', 'devices', 'layout', 'meta'] as const;
export type BoardMapName = (typeof BOARD_MAPS)[number];

/** Position and size. Layout only: it carries no meaning (design section 3.1). */
export interface Layout {
  x: number;
  y: number;
  w?: number;
  h?: number;
  tilt?: number;
}

export function createBoardDoc(): Y.Doc {
  const doc = new Y.Doc();
  for (const name of BOARD_MAPS) doc.getMap(name);
  return doc;
}

export function boardMap<T = unknown>(doc: Y.Doc, name: BoardMapName): Y.Map<T> {
  return doc.getMap<T>(name);
}
