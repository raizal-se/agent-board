import {
  BLOCK_H,
  BLOCK_W,
  changedAfterAgreement,
  DECISION_H,
  DECISION_W,
  frameSize,
  zoneRects,
  STICKY_H,
  STICKY_W,
  zoneOf,
  type Agreement,
  type CanvasShape,
  type CommentItem,
  type DecisionItem,
  type Device,
  type FileEdge,
  type FileItem,
  type Frame,
  type FrameZone,
  type HumanEdge,
  type Layout,
  type ZoneRect,
  type StickyItem,
  type ThreadItem,
  type Zone,
} from '@agent-board/model';

export interface BoardState {
  frames: Frame[];
  /** File blocks. */
  items: FileItem[];
  /** Edges from links in files. */
  edges: FileEdge[];
  layout: ReadonlyMap<string, Layout>;
  /** Board name (the watched folder's name). */
  name?: string;
  /** The person running the CLI. */
  owner?: string;
  stickies?: StickyItem[];
  decisions?: DecisionItem[];
  comments?: CommentItem[];
  /** Thread state by target id. */
  threads?: ReadonlyMap<string, ThreadItem>;
  /** Edges people drew. */
  humanEdges?: HumanEdge[];
  /** Agreements by file item id. */
  agreements?: ReadonlyMap<string, Agreement>;
  devices?: ReadonlyMap<string, Device>;
  /** Free drawing, by element id. */
  canvas?: ReadonlyMap<string, CanvasShape>;
}

/** The comment pin of an item: how many comments, and whether its thread is resolved. */
export interface Pin {
  count: number;
  resolved: boolean;
}

export type BlockData = {
  item: FileItem;
  missing: string[];
  agreement?: Agreement;
  changed: boolean;
  zone: Zone;
  pin: Pin;
  /** The agent's colour: one per owner. */
  agentColor: string;
};
export type StickyData = { sticky: StickyItem; pin: Pin };
export type DecisionData = { decision: DecisionItem; covers: string[]; pin: Pin };

/** A link drawn between two things on the board. */
export interface DrawnEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  kind: 'file' | 'human';
}

export interface FrameView {
  frame: Frame;
  /** Visible file blocks in it. */
  count: number;
  /** Position (absolute) and size: room for its zones and every item in it. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Its zone areas, relative to it: full columns for the zones in use, thin strips for the empty ones after. */
  zones: Record<FrameZone, ZoneRect>;
}

export interface Views {
  frames: FrameView[];
  /** File blocks on the board, by item id (not gone, in a known frame). */
  blocks: Map<string, BlockData>;
  decisions: Map<string, DecisionData>;
  stickies: Map<string, StickyData>;
  /** Edges with both ends on the board. */
  edges: DrawnEdge[];
  /** Blocks of deleted files, for the "hidden blocks" list. */
  hidden: FileItem[];
}

export const ORIGIN: Layout = { x: 0, y: 0 };
const NO_PIN: Pin = { count: 0, resolved: false };

const AGENT_COLORS = ['#7C3AED', '#0891B2', '#DB2777', '#65A30D', '#C2410C', '#2563EB'];

/** A steady colour per owner, so each person's agent looks the same everywhere. */
export function agentColor(owner: string): string {
  let h = 0;
  for (const c of owner) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AGENT_COLORS[h % AGENT_COLORS.length]!;
}

/** A short name for any item, for labels and screen readers. */
export function nameOf(item: FileItem | StickyItem | DecisionItem): string {
  if (item.kind === 'file') return item.path;
  if (item.kind === 'sticky') return `note by ${item.author}`;
  return `decision "${item.text.length > 40 ? `${item.text.slice(0, 40)}…` : item.text}"`;
}

/** The size an item takes: its own if it was resized, else the default for its kind. */
export function sizeIn(layout: Layout | undefined, kind: 'file' | 'sticky' | 'decision'): { w: number; h: number } {
  const d = kind === 'file' ? { w: BLOCK_W, h: BLOCK_H } : kind === 'sticky' ? { w: STICKY_W, h: STICKY_H } : { w: DECISION_W, h: DECISION_H };
  return { w: layout?.w ?? d.w, h: layout?.h ?? d.h };
}

/**
 * What the board shows, from the doc: frames with their size, the data each block, note and
 * decision draws, and the edges whose two ends are on the board. Positions of items stay relative
 * to their frame (as in the doc); a frame grows to hold its items.
 */
export function views(state: BoardState): Views {
  const stickies = state.stickies ?? [];
  const decisions = state.decisions ?? [];
  const agreements = state.agreements ?? new Map<string, Agreement>();
  const devices = state.devices ?? new Map<string, Device>();
  const threads = state.threads ?? new Map<string, ThreadItem>();
  const frameIds = new Set(state.frames.map((f) => f.id));

  const pins = new Map<string, Pin>();
  for (const c of state.comments ?? []) {
    const p = pins.get(c.target) ?? { count: 0, resolved: !!threads.get(c.target)?.resolved };
    p.count++;
    pins.set(c.target, p);
  }
  const pinOf = (id: string) => pins.get(id) ?? NO_PIN;

  const byId = new Map<string, FileItem | StickyItem | DecisionItem>();
  for (const i of [...state.items, ...stickies, ...decisions]) byId.set(i.id, i);

  const frames: FrameView[] = [...state.frames]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((frame) => {
      const l = state.layout.get(frame.id) ?? ORIGIN;
      let count = 0;
      const cells: { x: number; y: number; w: number; h: number }[] = [];
      const cell = (id: string, kind: 'file' | 'sticky' | 'decision') => {
        const p = state.layout.get(id) ?? ORIGIN;
        cells.push({ x: p.x, y: p.y, ...sizeIn(p, kind) });
      };
      for (const item of state.items) {
        if (item.frame !== frame.id) continue;
        if (!item.gone) count++;
        cell(item.id, 'file');
      }
      for (const s of stickies) if (s.frame === frame.id) cell(s.id, 'sticky');
      for (const d of decisions) if (d.frame === frame.id) cell(d.id, 'decision');
      const size = frameSize(cells);
      return { frame, count, x: l.x, y: l.y, ...size, zones: zoneRects(size.h, cells) };
    });

  const missingOf = new Map<string, string[]>();
  for (const e of state.edges) {
    const target = e.to ? byId.get(e.to) : undefined;
    if (target && !(target.kind === 'file' && target.gone)) continue;
    const list = missingOf.get(e.from) ?? [];
    list.push(e.toPath);
    missingOf.set(e.from, list);
  }

  const blocks = new Map<string, BlockData>();
  for (const item of [...state.items].sort((a, b) => a.path.localeCompare(b.path))) {
    if (item.gone || !frameIds.has(item.frame)) continue;
    const agreement = agreements.get(item.id);
    blocks.set(item.id, {
      item,
      missing: missingOf.get(item.id)?.sort() ?? [],
      agreement,
      changed: changedAfterAgreement(item, agreement),
      zone: zoneOf(agreement, devices.get(item.owner)?.side ?? 'product'),
      pin: pinOf(item.id),
      agentColor: agentColor(item.owner),
    });
  }

  const decisionData = new Map<string, DecisionData>();
  for (const d of [...decisions].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))) {
    if (!frameIds.has(d.frame)) continue;
    const covers = d.covers.map((id) => byId.get(id)).map((i) => (i?.kind === 'file' ? i.path : '(removed)'));
    decisionData.set(d.id, { decision: d, covers, pin: pinOf(d.id) });
  }

  // A note whose frame is gone stands on its own.
  const stickyData = new Map<string, StickyData>();
  for (const s of [...stickies].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))) {
    stickyData.set(s.id, { sticky: s.frame && !frameIds.has(s.frame) ? { ...s, frame: null } : s, pin: pinOf(s.id) });
  }

  const drawn = (id: string | null) => !!id && (blocks.has(id) || decisionData.has(id) || stickyData.has(id));
  const edges: DrawnEdge[] = [];
  for (const e of state.edges) if (drawn(e.from) && drawn(e.to)) edges.push({ id: e.id, from: e.from, to: e.to!, label: e.label, kind: 'file' });
  for (const e of state.humanEdges ?? []) if (drawn(e.from) && drawn(e.to)) edges.push({ id: e.id, from: e.from, to: e.to, label: e.label, kind: 'human' });

  const hidden = state.items.filter((i) => i.gone).sort((a, b) => a.path.localeCompare(b.path));
  return { frames, blocks, decisions: decisionData, stickies: stickyData, edges, hidden };
}
