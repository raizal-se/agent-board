import type * as Y from 'yjs';

/**
 * Free drawing on the board: a shape, a text, a line or an arrow a person drew that is not one of
 * the board's own things (a block, a note, a decision, a link between two of them). The canvas
 * keeps it as it draws it, one entry per element id, and the board only stores it. Like layout,
 * it carries no meaning: agents do not read it and the CLI never writes it.
 */
export interface CanvasShape {
  id: string;
  type: string;
  [key: string]: unknown;
}

export function canvasMap(doc: Y.Doc): Y.Map<CanvasShape> {
  return doc.getMap<CanvasShape>('canvas');
}

export function isCanvasShape(v: unknown): v is CanvasShape {
  return !!v && typeof v === 'object' && typeof (v as CanvasShape).id === 'string' && typeof (v as CanvasShape).type === 'string';
}
