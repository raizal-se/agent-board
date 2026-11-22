import * as Y from 'yjs';

export type Side = 'product' | 'engineering';
export type Zone = 'product' | 'engineering' | 'agreed' | 'milestone' | 'none';

/** Top-level maps of one board document (implementation plan, section 2.2). */
export const BOARD_MAPS = ['frames', 'items', 'edges', 'devices', 'layout', 'meta', 'agreements', 'canvas'] as const;
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

/**
 * The board's identity, `meta.id`. The CLI sets it once, when it creates the board. A tab that
 * synced with one board must never sync into another (see CLOSE_OTHER_BOARD in the sync package).
 */
export function boardIdOf(doc: Y.Doc): string | undefined {
  const id = doc.getMap('meta').get('id');
  return typeof id === 'string' ? id : undefined;
}

export function ensureBoardId(doc: Y.Doc): string {
  const known = boardIdOf(doc);
  if (known) return known;
  const id = globalThis.crypto.randomUUID();
  doc.getMap('meta').set('id', id);
  return id;
}

export * from './items';
export * from './layout';
export * from './edges';
export * from './native';
export * from './agreement';
export * from './canvas';
export * from './diff';
export * from './export';
