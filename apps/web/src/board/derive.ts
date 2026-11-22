import {
  BLOCK_H,
  BLOCK_W,
  changedAfterAgreement,
  DECISION_H,
  DECISION_W,
  fileName,
  frameSize,
  STICKY_H,
  STICKY_W,
  zoneOf,
  zoneRects,
  type Agreement,
  type CommentItem,
  type DecisionItem,
  type Device,
  type FileEdge,
  type FileItem,
  type Frame,
  type FrameZone,
  type HumanEdge,
  type Layout,
  type Rect,
  type StickyItem,
  type ThreadItem,
  type Zone,
} from '@agent-board/model';
import { MarkerType, type Edge, type Node } from '@xyflow/react';

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
}

/** The comment pin of an item: how many comments, and whether its thread is resolved. */
export interface Pin {
  count: number;
  resolved: boolean;
}

export type FrameData = { frame: Frame; count: number; zones: Record<FrameZone, Rect> };
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
export type FrameNode = Node<FrameData, 'frame'>;
export type BlockNode = Node<BlockData, 'markdown' | 'html'>;
export type StickyNode = Node<StickyData, 'sticky'>;
export type DecisionNode = Node<DecisionData, 'decision'>;
export type BoardNode = FrameNode | BlockNode | StickyNode | DecisionNode;

export type EdgeData = { kind: 'file'; file: string } | { kind: 'human'; author: string };

export interface Derived {
  nodes: BoardNode[];
  edges: Edge<EdgeData>[];
  /** Blocks of deleted files, for the "hidden blocks" list. */
  hidden: FileItem[];
}

const ORIGIN: Layout = { x: 0, y: 0 };
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

/**
 * The board doc as React Flow nodes and edges. Frames come first (React Flow needs parents before
 * children); item positions are relative to their frame. A frame grows to hold its items.
 */
export function derive(state: BoardState): Derived {
  const stickies = state.stickies ?? [];
  const decisions = state.decisions ?? [];
  const agreements = state.agreements ?? new Map<string, Agreement>();
  const devices = state.devices ?? new Map<string, Device>();
  const threads = state.threads ?? new Map<string, ThreadItem>();

  const visible = state.items.filter((i) => !i.gone);
  const hidden = state.items.filter((i) => i.gone).sort((a, b) => a.path.localeCompare(b.path));
  const byId = new Map<string, FileItem | StickyItem | DecisionItem>();
  for (const i of [...state.items, ...stickies, ...decisions]) byId.set(i.id, i);
  const frameIds = new Set(state.frames.map((f) => f.id));

  const pins = new Map<string, Pin>();
  for (const c of state.comments ?? []) {
    const p = pins.get(c.target) ?? { count: 0, resolved: !!threads.get(c.target)?.resolved };
    p.count++;
    pins.set(c.target, p);
  }
  const pinOf = (id: string) => pins.get(id) ?? NO_PIN;

  const sized = (id: string, w: number, h: number) => {
    const l = state.layout.get(id) ?? ORIGIN;
    return { x: l.x, y: l.y, w, h };
  };

  const frameNodes: FrameNode[] = [...state.frames]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((frame) => {
      const l = state.layout.get(frame.id) ?? ORIGIN;
      let count = 0;
      const cells: { x: number; y: number; w: number; h: number }[] = [];
      for (const item of state.items) {
        if (item.frame !== frame.id) continue;
        if (!item.gone) count++;
        cells.push(sized(item.id, BLOCK_W, BLOCK_H));
      }
      for (const s of stickies) if (s.frame === frame.id) cells.push(sized(s.id, STICKY_W, STICKY_H));
      for (const d of decisions) if (d.frame === frame.id) cells.push(sized(d.id, DECISION_W, DECISION_H));
      const { w, h } = frameSize(cells);
      return {
        id: frame.id,
        type: 'frame',
        position: { x: l.x, y: l.y },
        data: { frame, count, zones: zoneRects(h) },
        style: { width: w, height: h },
        zIndex: 0,
      };
    });

  const missingOf = new Map<string, string[]>();
  for (const e of state.edges) {
    const target = e.to ? byId.get(e.to) : undefined;
    if (target && !(target.kind === 'file' && target.gone)) continue;
    const list = missingOf.get(e.from) ?? [];
    list.push(e.toPath);
    missingOf.set(e.from, list);
  }

  const blockNodes: BlockNode[] = visible
    .filter((item) => frameIds.has(item.frame))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((item) => {
      const p = state.layout.get(item.id) ?? ORIGIN;
      const agreement = agreements.get(item.id);
      return {
        id: item.id,
        type: item.type,
        parentId: item.frame,
        position: { x: p.x, y: p.y },
        data: {
          item,
          missing: missingOf.get(item.id)?.sort() ?? [],
          agreement,
          changed: changedAfterAgreement(item, agreement),
          zone: zoneOf(agreement, devices.get(item.owner)?.side ?? 'product'),
          pin: pinOf(item.id),
          agentColor: agentColor(item.owner),
        },
        style: { width: BLOCK_W, height: BLOCK_H },
        zIndex: 1,
      };
    });

  const decisionNodes: DecisionNode[] = decisions
    .filter((d) => frameIds.has(d.frame))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map((d) => {
      const p = state.layout.get(d.id) ?? ORIGIN;
      const covers = d.covers.map((id) => byId.get(id)).map((i) => (i?.kind === 'file' ? i.path : '(removed)'));
      return {
        id: d.id,
        type: 'decision',
        parentId: d.frame,
        position: { x: p.x, y: p.y },
        data: { decision: d, covers, pin: pinOf(d.id) },
        style: { width: DECISION_W, height: DECISION_H },
        zIndex: 1,
      };
    });

  // Notes sit above blocks, so one dropped on a block stays readable. A note whose frame is gone
  // stands on its own.
  const stickyNodes: StickyNode[] = [...stickies]
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map((s) => {
      const p = state.layout.get(s.id) ?? ORIGIN;
      const inFrame = s.frame && frameIds.has(s.frame) ? s.frame : undefined;
      return {
        id: s.id,
        type: 'sticky',
        ...(inFrame ? { parentId: inFrame } : {}),
        position: { x: p.x, y: p.y },
        data: { sticky: s, pin: pinOf(s.id) },
        style: { width: STICKY_W, height: STICKY_H },
        zIndex: 2,
      };
    });

  const drawn = new Set([...blockNodes, ...decisionNodes, ...stickyNodes].map((n) => n.id));
  const edges: Edge<EdgeData>[] = [];
  for (const e of state.edges) {
    if (!e.to || !drawn.has(e.from) || !drawn.has(e.to)) continue;
    const from = byId.get(e.from) as FileItem;
    const to = byId.get(e.to)!;
    edges.push({
      id: e.id,
      type: 'floating',
      source: e.from,
      target: e.to,
      label: e.label || undefined,
      data: { kind: 'file', file: fileName(from.path) },
      className: 'file-edge',
      ariaLabel: `link from ${from.path} to ${nameOf(to)}`,
      // Dotted: it comes from a file, and only a change to that file removes it.
      style: { strokeDasharray: '2 5', strokeWidth: 1.75, strokeLinecap: 'round' },
      markerEnd: { type: MarkerType.ArrowClosed },
      selectable: false,
      // Above frames (0). Blocks (1) come later in the page, so a block still covers an edge that
      // crosses it. App sets zIndexMode="manual" so React Flow keeps these numbers as they are.
      zIndex: 1,
    });
  }
  for (const e of state.humanEdges ?? []) {
    if (!drawn.has(e.from) || !drawn.has(e.to)) continue;
    edges.push({
      id: e.id,
      type: 'floating',
      source: e.from,
      target: e.to,
      label: e.label || undefined,
      data: { kind: 'human', author: e.author },
      className: 'human-edge',
      ariaLabel: `drawn link from ${nameOf(byId.get(e.from)!)} to ${nameOf(byId.get(e.to)!)}`,
      style: { strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed },
      selectable: true,
      interactionWidth: 32,
      zIndex: 1,
    });
  }

  return { nodes: [...frameNodes, ...blockNodes, ...decisionNodes, ...stickyNodes], edges, hidden };
}
