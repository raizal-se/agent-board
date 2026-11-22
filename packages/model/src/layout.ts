import type * as Y from 'yjs';
import type { Layout, Zone } from './index';
import { framesMap, itemsMap, type BoardItem } from './items';

/**
 * Fixed sizes. The canvas and the CLI share them so a new block lands in a free spot.
 * Item positions are relative to their frame (a sticky outside any frame: relative to the board).
 */
export const BLOCK_W = 340;
export const BLOCK_H = 380;
export const STICKY_W = 200;
export const STICKY_H = 160;
export const DECISION_W = BLOCK_W;
export const DECISION_H = 170;
export const GRID_GAP = 32;
export const FRAME_PAD = 32;
export const FRAME_HEADER = 48;
/** Room for a zone's label above the first block in it. */
export const ZONE_LABEL_H = 28;
export const ZONE_TOP = FRAME_HEADER + ZONE_LABEL_H;
export const FRAME_GAP = 120;

/**
 * The four soft zones of a feature frame (design 3), one column each, left to right. A zone is a
 * colour area, not a box: what zone a block is in comes from its state (design 3.1). Its column is
 * only where a new block starts.
 */
export const ZONES = ['product', 'engineering', 'agreed', 'milestone'] as const satisfies readonly Zone[];
export type FrameZone = (typeof ZONES)[number];

export const FRAME_MIN_W = FRAME_PAD * 2 + ZONES.length * BLOCK_W + (ZONES.length - 1) * GRID_GAP;
export const FRAME_MIN_H = ZONE_TOP + BLOCK_H + FRAME_PAD;

export function layoutMap(doc: Y.Doc): Y.Map<Layout> {
  return doc.getMap<Layout>('layout');
}

/** Left edge of a zone's column, relative to its frame. */
export function zoneX(zone: FrameZone): number {
  return FRAME_PAD + ZONES.indexOf(zone) * (BLOCK_W + GRID_GAP);
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The zone areas of a frame of height `h`, relative to the frame. */
export function zoneRects(h: number): Record<FrameZone, Rect> {
  const out = {} as Record<FrameZone, Rect>;
  for (const z of ZONES) out[z] = { x: zoneX(z) - 12, y: FRAME_HEADER, w: BLOCK_W + 24, h: Math.max(0, h - FRAME_HEADER - FRAME_PAD + 12) };
  return out;
}

/** The size an item takes on the board, or null for items that are not drawn as nodes. */
export function sizeOf(item: Pick<BoardItem, 'kind'>): { w: number; h: number } | null {
  switch (item.kind) {
    case 'file':
      return { w: BLOCK_W, h: BLOCK_H };
    case 'sticky':
      return { w: STICKY_W, h: STICKY_H };
    case 'decision':
      return { w: DECISION_W, h: DECISION_H };
    default:
      return null;
  }
}

/** Places taken in a frame: every drawn item in it with a layout, at its own size if it was resized. */
function takenIn(doc: Y.Doc, frame: string, exceptId?: string): Rect[] {
  const layout = layoutMap(doc);
  const taken: Rect[] = [];
  for (const item of itemsMap(doc).values()) {
    if (!item || item.id === exceptId || !('frame' in item) || item.frame !== frame) continue;
    const size = sizeOf(item);
    const l = layout.get(item.id);
    if (size && l) taken.push({ x: l.x, y: l.y, w: l.w ?? size.w, h: l.h ?? size.h });
  }
  return taken;
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * The first free spot from the top of a zone's column. Hidden (gone) blocks keep their place, so a
 * file that comes back lands where it was.
 */
export function nextItemSpot(
  doc: Y.Doc,
  frame: string,
  opts: { zone?: FrameZone; w?: number; h?: number; exceptId?: string } = {},
): { x: number; y: number } {
  const want = { x: zoneX(opts.zone ?? 'product'), w: opts.w ?? BLOCK_W, h: opts.h ?? BLOCK_H };
  const taken = takenIn(doc, frame, opts.exceptId);
  const ys = [ZONE_TOP, ...taken.map((r) => r.y + r.h + GRID_GAP)].filter((y) => y >= ZONE_TOP).sort((a, b) => a - b);
  for (const y of ys) {
    if (!taken.some((r) => overlaps(r, { ...want, y }))) return { x: want.x, y };
  }
  return { x: want.x, y: ys[ys.length - 1]! };
}

/**
 * A frame's size: room for its four zones and for every item in it (hidden ones keep their
 * place). The canvas and frame placement both use this, so they agree.
 */
export function frameSize(items: Iterable<{ x: number; y: number; w?: number; h?: number }>): { w: number; h: number } {
  let w = FRAME_MIN_W;
  let h = FRAME_MIN_H;
  for (const p of items) {
    w = Math.max(w, p.x + (p.w ?? BLOCK_W) + FRAME_PAD);
    h = Math.max(h, p.y + (p.h ?? BLOCK_H) + FRAME_PAD);
  }
  return { w, h };
}

/** Frames line up left to right; a new one goes right of the rightmost. */
export function nextFrameSpot(doc: Y.Doc): Layout {
  const layout = layoutMap(doc);
  let right = -FRAME_GAP;
  for (const f of framesMap(doc).values()) {
    const l = layout.get(f.id);
    if (l) right = Math.max(right, l.x + frameSize(takenIn(doc, f.id)).w);
  }
  return { x: right + FRAME_GAP, y: 0 };
}

/** Where a frame is and how big it is now. A frame with no layout sits at the origin, as on the canvas. */
export function frameRect(doc: Y.Doc, frame: string): Rect {
  const l = layoutMap(doc).get(frame);
  return { x: l?.x ?? 0, y: l?.y ?? 0, ...frameSize(takenIn(doc, frame)) };
}

/**
 * Move frames apart so no two overlap, and save the moved positions. Frames are taken left to
 * right (then top to bottom, then by name); a frame that overlaps one before it moves right, past
 * that frame and a gap, until it is clear. A frame that is clear keeps its place, wherever it was
 * dragged. Frames grow as items are added, and a board saved with narrower frames can overlap on
 * load: run this after load and after changes. Returns how many frames moved.
 */
export function settleFrames(doc: Y.Doc): number {
  const frames = [...framesMap(doc).values()].map((f) => ({ id: f.id, name: f.name, rect: frameRect(doc, f.id) }));
  frames.sort((a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const placed: Rect[] = [];
  const moved: { id: string; x: number }[] = [];
  for (const f of frames) {
    const r = { ...f.rect };
    for (;;) {
      const hit = placed.filter((p) => overlaps(p, r));
      if (hit.length === 0) break;
      r.x = Math.max(...hit.map((p) => p.x + p.w + FRAME_GAP));
    }
    if (r.x !== f.rect.x) moved.push({ id: f.id, x: r.x });
    placed.push(r);
  }
  if (moved.length > 0) {
    const layout = layoutMap(doc);
    doc.transact(() => {
      for (const m of moved) layout.set(m.id, { ...layout.get(m.id), x: m.x, y: layout.get(m.id)?.y ?? 0 });
    });
  }
  return moved.length;
}
