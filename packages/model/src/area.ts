import type * as Y from 'yjs';
import type { Agreement } from './agreement';
import type { Device, Layout, Side } from './index';
import { fileItemOf, framesMap, isFileItem, itemsMap, type FileItem, type Frame } from './items';
import {
  AREAS,
  areaOrigin,
  areaRect,
  BLOCK_W,
  DECISION_H,
  DECISION_W,
  estimateCardH,
  FRAME_GAP,
  frameSizeFor,
  freeSpot,
  gridFor,
  GRID_GAP,
  gridsMap,
  layoutMap,
  overlaps,
  sameGrid,
  STICKY_H,
  STICKY_W,
  type Area,
  type AreaCell,
  type Grid,
  type Rect,
} from './layout';
import { isDecision, isSticky, type DecisionItem, type Person, type StickyItem } from './native';
import { MILESTONE_H, MILESTONE_W, milestonesMap, STORY_H, STORY_W, storiesMap, type MilestoneItem, type StoryItem } from './stories';

/**
 * Which area a file block is in: Product or Engineering. The file can say it (`area:` in front
 * matter, `board:area` in HTML); a person can switch it on the board; else it is the owner's side.
 *
 * The last statement wins. A person's switch holds until the file says something new: the switch
 * keeps the file's `area` value it was made against, and a save with a different value wins and
 * clears the switch. A save that leaves `area` as it was does not undo the switch.
 */

/** A person's switch of a block's area, by block id. Board-side: the CLI never writes the file for it. */
export interface AreaOverride {
  item: string;
  side: Side;
  by: string;
  at: number;
  /** The file's own `area` when the person switched (null: it said nothing). */
  fileArea: Side | null;
}

export type AreaSource = 'file' | 'owner side' | 'human';

export interface ResolvedArea {
  area: Side;
  source: AreaSource;
  /** Who switched it and when, for a person's switch. */
  by?: string;
  at?: number;
}

export function sidesMap(doc: Y.Doc): Y.Map<AreaOverride> {
  return doc.getMap<AreaOverride>('sides');
}

/** A switch still holds while the file says what it said when the person switched. */
export function overrideHolds(item: Pick<FileItem, 'area'>, ov: AreaOverride | undefined): ov is AreaOverride {
  return !!ov && ov.fileArea === (item.area ?? null);
}

export function resolveArea(item: Pick<FileItem, 'area'>, ownerSide: Side, ov?: AreaOverride): ResolvedArea {
  if (overrideHolds(item, ov)) return { area: ov.side, source: 'human', by: ov.by, at: ov.at };
  if (item.area) return { area: item.area, source: 'file' };
  return { area: ownerSide, source: 'owner side' };
}

export function ownerSideOf(doc: Y.Doc, owner: string): Side {
  return doc.getMap<Device>('devices').get(owner)?.side ?? 'product';
}

export function areaOf(doc: Y.Doc, item: FileItem): ResolvedArea {
  return resolveArea(item, ownerSideOf(doc, item.owner), sidesMap(doc).get(item.id));
}

/** The id of an agreed block's snapshot card in the Agreed area. */
export const snapId = (itemId: string) => `snap:${itemId}`;
export const isSnapId = (id: string) => id.startsWith('snap:');
export const snapItemOf = (id: string) => id.slice('snap:'.length);

/** What the board's shape is computed from: plain values, so the page and the CLI share it. */
export interface GeoInput {
  frames: Iterable<Frame>;
  files: Iterable<FileItem>;
  stickies: Iterable<StickyItem>;
  decisions: Iterable<DecisionItem>;
  agreements: ReadonlyMap<string, Pick<Agreement, 'snapshot'>>;
  layout: ReadonlyMap<string, Layout>;
  sides: ReadonlyMap<string, AreaOverride>;
  grids: ReadonlyMap<string, Grid>;
  ownerSide: (owner: string) => Side;
  /** Milestone cards and story blocks: they sit in the Milestone area. */
  milestones?: Iterable<Pick<MilestoneItem, 'id' | 'frame'>>;
  stories?: Iterable<Pick<StoryItem, 'id' | 'frame'>>;
}

/** A frame's shape: its grid, its four areas and size (relative to it), and what is in each area. */
export interface FrameGeo {
  id: string;
  grid: Grid;
  areas: Record<Area, Rect>;
  w: number;
  h: number;
  /** Blocks, snapshot cards and decisions, relative to their area. Hidden blocks keep their place. */
  cells: AreaCell[];
  /** Notes in the frame, relative to it. */
  notes: (Rect & { id: string })[];
}

export function geoInput(doc: Y.Doc): GeoInput {
  const items = [...itemsMap(doc).values()].filter(Boolean);
  const devices = doc.getMap<Device>('devices');
  return {
    frames: [...framesMap(doc).values()].filter(Boolean),
    files: items.filter(isFileItem),
    stickies: items.filter(isSticky),
    decisions: items.filter(isDecision),
    agreements: new Map(doc.getMap<Agreement>('agreements').entries()),
    layout: new Map(layoutMap(doc).entries()),
    sides: new Map(sidesMap(doc).entries()),
    grids: new Map(gridsMap(doc).entries()),
    ownerSide: (owner) => devices.get(owner)?.side ?? 'product',
    milestones: [...milestonesMap(doc).values()].filter(Boolean),
    stories: [...storiesMap(doc).values()].filter(Boolean),
  };
}

/** The shape of every frame, by frame id. */
export function boardGeometry(input: GeoInput): Map<string, FrameGeo> {
  const cells = new Map<string, AreaCell[]>();
  const notes = new Map<string, (Rect & { id: string })[]>();
  const add = (frame: string, c: AreaCell) => cells.set(frame, [...(cells.get(frame) ?? []), c]);
  const sized = (id: string, w: number, h: number) => {
    const l = input.layout.get(id);
    return l ? { x: l.x, y: l.y, w: l.w ?? w, h: l.h ?? h } : null;
  };
  const filesById = new Map<string, FileItem>();
  for (const f of input.files) {
    filesById.set(f.id, f);
    const r = sized(f.id, BLOCK_W, estimateCardH(f.type, f.text));
    if (r) add(f.frame, { ...r, id: f.id, area: resolveArea(f, input.ownerSide(f.owner), input.sides.get(f.id)).area });
  }
  for (const [itemId, a] of input.agreements) {
    const f = filesById.get(itemId);
    const r = f && sized(snapId(itemId), BLOCK_W, estimateCardH(a.snapshot.type, a.snapshot.text));
    if (f && r) add(f.frame, { ...r, id: snapId(itemId), area: 'agreed' });
  }
  for (const d of input.decisions) {
    const r = sized(d.id, DECISION_W, DECISION_H);
    if (r) add(d.frame, { ...r, id: d.id, area: 'agreed' });
  }
  for (const m of input.milestones ?? []) {
    const r = sized(m.id, MILESTONE_W, MILESTONE_H);
    if (r) add(m.frame, { ...r, id: m.id, area: 'milestone' });
  }
  for (const st of input.stories ?? []) {
    const r = sized(st.id, STORY_W, STORY_H);
    if (r) add(st.frame, { ...r, id: st.id, area: 'milestone' });
  }
  for (const s of input.stickies) {
    const r = s.frame ? sized(s.id, STICKY_W, STICKY_H) : null;
    if (s.frame && r) notes.set(s.frame, [...(notes.get(s.frame) ?? []), { ...r, id: s.id }]);
  }
  const out = new Map<string, FrameGeo>();
  for (const frame of input.frames) {
    const c = cells.get(frame.id) ?? [];
    const n = notes.get(frame.id) ?? [];
    const grid = gridFor(c, input.grids.get(frame.id));
    const areas = Object.fromEntries(AREAS.map((a) => [a, areaRect(grid, a)])) as Record<Area, Rect>;
    out.set(frame.id, { id: frame.id, grid, areas, ...frameSizeFor(grid, n), cells: c, notes: n });
  }
  return out;
}

/** One frame's shape from the doc (an empty frame for one not in the doc yet). */
export function frameGeo(doc: Y.Doc, frame: string): FrameGeo {
  const input = geoInput(doc);
  const known = [...input.frames].some((f) => f.id === frame);
  const geo = boardGeometry(known ? input : { ...input, frames: [...input.frames, { id: frame, name: frame }] });
  return geo.get(frame)!;
}

/**
 * A free spot in an area of a frame, for a new block (or one that changed area): placed once, and
 * after that only a person moves it.
 */
export function nextItemSpot(
  doc: Y.Doc,
  frame: string,
  opts: { area?: Area; w?: number; h?: number; exceptId?: string } = {},
): { x: number; y: number } {
  const area = opts.area ?? 'product';
  const geo = frameGeo(doc, frame);
  const taken = geo.cells.filter((c) => c.area === area && c.id !== opts.exceptId);
  return freeSpot(taken, geo.areas[area].w, { w: opts.w ?? BLOCK_W, h: opts.h ?? estimateCardH('markdown', '') });
}

/** A place the board chose: marked so the board may push it down later (see `settleGrowth`). */
export const boardPlaced = (old: Layout | undefined, spot: { x: number; y: number }): Layout => ({ ...old, ...spot, placedBy: 'board' });

/**
 * A card is placed once, at a height estimated before the page measures it; the page then grows it
 * to its content, and it can grow into the card below. Push down, in each area, every card the
 * board placed that a card above it now overlaps, to a gap below it (and so on down the column).
 * A card a person placed never moves: a board-placed card that overlaps one is pushed past it.
 * Returns how many cards moved.
 */
export function settleGrowth(doc: Y.Doc): number {
  const layout = layoutMap(doc);
  const moved: { id: string; y: number }[] = [];
  for (const g of boardGeometry(geoInput(doc)).values()) {
    for (const area of AREAS) {
      const cells = g.cells.filter((c) => c.area === area);
      const placed: Rect[] = cells.filter((c) => layout.get(c.id)?.placedBy !== 'board');
      const auto = cells.filter((c) => layout.get(c.id)?.placedBy === 'board').sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
      for (const c of auto) {
        const r = { x: c.x, y: c.y, w: c.w, h: c.h };
        for (;;) {
          const hit = placed.filter((p) => overlaps(p, r));
          if (hit.length === 0) break;
          r.y = Math.max(...hit.map((p) => p.y + p.h + GRID_GAP));
        }
        if (r.y !== c.y) moved.push({ id: c.id, y: r.y });
        placed.push(r);
      }
    }
  }
  if (moved.length > 0) {
    doc.transact(() => {
      for (const m of moved) layout.set(m.id, { ...layout.get(m.id)!, y: m.y });
    });
  }
  return moved.length;
}

/** Everything in a frame, relative to it: blocks and cards in their areas, and notes. */
export function frameRects(geo: FrameGeo, exceptId?: string): Rect[] {
  const out: Rect[] = [];
  for (const c of geo.cells) {
    if (c.id === exceptId) continue;
    const o = areaOrigin(geo.grid, c.area);
    out.push({ x: o.x + c.x, y: o.y + c.y, w: c.w, h: c.h });
  }
  for (const n of geo.notes) if (n.id !== exceptId) out.push(n);
  return out;
}

/** Whether a rect (relative to a frame) is clear of every item in the frame. */
export function isFreeIn(doc: Y.Doc, frame: string, rect: Rect, exceptId?: string): boolean {
  return !frameRects(frameGeo(doc, frame), exceptId).some((r) => overlaps(r, rect));
}

/** Where a frame is and how big it is now. A frame with no layout sits at the origin, as on the canvas. */
export function frameRect(doc: Y.Doc, frame: string): Rect {
  const l = layoutMap(doc).get(frame);
  const g = frameGeo(doc, frame);
  return { x: l?.x ?? 0, y: l?.y ?? 0, w: g.w, h: g.h };
}

/** Frames line up left to right, a wide gap apart; a new one goes right of the rightmost. */
export function nextFrameSpot(doc: Y.Doc): Layout {
  const layout = layoutMap(doc);
  const geo = boardGeometry(geoInput(doc));
  let right = -FRAME_GAP;
  for (const g of geo.values()) {
    const l = layout.get(g.id);
    if (l) right = Math.max(right, l.x + g.w);
  }
  return { x: right + FRAME_GAP, y: 0 };
}

/**
 * Move frames apart so no two overlap, and save the moved positions. Frames are taken left to
 * right (then top to bottom, then by name); a frame that overlaps one before it moves right, past
 * that frame and a gap, until it is clear. A frame that is clear keeps its place, wherever it was
 * dragged. Frames grow as their areas grow: run this after load and after changes. Returns how many
 * frames moved.
 */
export function settleFrames(doc: Y.Doc): number {
  const layout = layoutMap(doc);
  const geo = boardGeometry(geoInput(doc));
  const frames = [...framesMap(doc).values()].filter(Boolean).map((f) => {
    const l = layout.get(f.id);
    const g = geo.get(f.id)!;
    return { id: f.id, name: f.name, rect: { x: l?.x ?? 0, y: l?.y ?? 0, w: g.w, h: g.h } };
  });
  frames.sort((a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const placed: Rect[] = [];
  const moved: { id: string; x: number }[] = [];
  for (const f of frames) {
    const r = { ...f.rect };
    // Frames keep a wide gap between them, not just clear of each other.
    const near = (p: Rect) => overlaps({ x: p.x - FRAME_GAP / 2, y: p.y - FRAME_GAP / 2, w: p.w + FRAME_GAP, h: p.h + FRAME_GAP }, r);
    for (;;) {
      const hit = placed.filter(near);
      if (hit.length === 0) break;
      r.x = Math.max(...hit.map((p) => p.x + p.w + FRAME_GAP));
    }
    if (r.x !== f.rect.x) moved.push({ id: f.id, x: r.x });
    placed.push(r);
  }
  if (moved.length > 0) {
    doc.transact(() => {
      for (const m of moved) layout.set(m.id, { ...layout.get(m.id), x: m.x, y: layout.get(m.id)?.y ?? 0 });
    });
  }
  return moved.length;
}

/**
 * Keep what the board has grown to: store each frame's grid when an area grew (so it never shrinks
 * back when a block moves out), and give a spot in Agreed to a snapshot card that has none (an
 * agreement from before snapshot cards). First, push down board-placed cards a grown card now
 * overlaps (`settleGrowth`). Returns how many entries it wrote.
 */
export function settleAreas(doc: Y.Doc): number {
  let writes = settleGrowth(doc);
  doc.transact(() => {
    const layout = layoutMap(doc);
    for (const [itemId, a] of doc.getMap<Agreement>('agreements').entries()) {
      const f = fileItemOf(doc, itemId);
      if (!f || layout.has(snapId(itemId))) continue;
      layout.set(snapId(itemId), boardPlaced(undefined, nextItemSpot(doc, f.frame, { area: 'agreed', h: estimateCardH(a.snapshot.type, a.snapshot.text) })));
      writes++;
    }
    const grids = gridsMap(doc);
    for (const g of boardGeometry(geoInput(doc)).values()) {
      if (sameGrid(grids.get(g.id), g.grid)) continue;
      grids.set(g.id, g.grid);
      writes++;
    }
  });
  return writes;
}

/**
 * A person switches a block to Product or Engineering. The switch is stored with who and when,
 * against the file's own `area` now (see `resolveArea`). If the block changes area, it moves to a
 * free spot in the other area, once.
 */
export function switchArea(doc: Y.Doc, itemId: string, side: Side, opts: { by: Person; now?: number }): boolean {
  const f = fileItemOf(doc, itemId);
  if (!f) return false;
  const before = areaOf(doc, f).area;
  doc.transact(() => {
    sidesMap(doc).set(itemId, { item: itemId, side, by: opts.by.name, at: opts.now ?? Date.now(), fileArea: f.area ?? null });
    if (before === side) return;
    const l = layoutMap(doc).get(itemId);
    const size = { w: l?.w ?? BLOCK_W, h: l?.h ?? estimateCardH(f.type, f.text) };
    layoutMap(doc).set(itemId, boardPlaced(l, nextItemSpot(doc, f.frame, { area: side, exceptId: itemId, ...size })));
  });
  return true;
}
