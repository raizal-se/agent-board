import {
  BLOCK_H,
  BLOCK_W,
  frameSize,
  type FileEdge,
  type FileItem,
  type Frame,
  type Layout,
} from '@agent-board/model';
import { MarkerType, type Edge, type Node } from '@xyflow/react';

export interface BoardState {
  frames: Frame[];
  items: FileItem[];
  edges: FileEdge[];
  layout: ReadonlyMap<string, Layout>;
  /** Board name (the watched folder's name). */
  name?: string;
}

export type FrameData = { frame: Frame; count: number };
export type BlockData = { item: FileItem; missing: string[] };
export type FrameNode = Node<FrameData, 'frame'>;
export type BlockNode = Node<BlockData, 'markdown' | 'html'>;
export type BoardNode = FrameNode | BlockNode;

export interface Derived {
  nodes: BoardNode[];
  edges: Edge[];
  /** Blocks of deleted files, for the "hidden blocks" list. */
  hidden: FileItem[];
}

const ORIGIN: Layout = { x: 0, y: 0 };

/**
 * The board doc as React Flow nodes and edges. Frames come first (React Flow needs parents before
 * children); block positions are relative to their frame. A frame grows to hold its blocks.
 */
export function derive(state: BoardState): Derived {
  const visible = state.items.filter((i) => !i.gone);
  const hidden = state.items.filter((i) => i.gone).sort((a, b) => a.path.localeCompare(b.path));
  const byId = new Map(state.items.map((i) => [i.id, i]));
  const frameIds = new Set(state.frames.map((f) => f.id));

  const frameNodes: FrameNode[] = [...state.frames]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((frame) => {
      const l = state.layout.get(frame.id) ?? ORIGIN;
      let count = 0;
      const cells: Layout[] = [];
      for (const item of state.items) {
        if (item.frame !== frame.id) continue;
        if (!item.gone) count++;
        cells.push(state.layout.get(item.id) ?? ORIGIN);
      }
      const { w, h } = frameSize(cells);
      return {
        id: frame.id,
        type: 'frame',
        position: { x: l.x, y: l.y },
        data: { frame, count },
        style: { width: w, height: h },
        zIndex: 0,
      };
    });

  const missingOf = new Map<string, string[]>();
  for (const e of state.edges) {
    const target = e.to ? byId.get(e.to) : undefined;
    if (target && !target.gone) continue;
    const list = missingOf.get(e.from) ?? [];
    list.push(e.toPath);
    missingOf.set(e.from, list);
  }

  const blockNodes: BlockNode[] = visible
    .filter((item) => frameIds.has(item.frame))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((item) => {
      const p = state.layout.get(item.id) ?? ORIGIN;
      return {
        id: item.id,
        type: item.type,
        parentId: item.frame,
        position: { x: p.x, y: p.y },
        data: { item, missing: missingOf.get(item.id)?.sort() ?? [] },
        style: { width: BLOCK_W, height: BLOCK_H },
        zIndex: 1,
      };
    });

  const drawn = new Set(blockNodes.map((n) => n.id));
  const edges: Edge[] = [];
  for (const e of state.edges) {
    if (!e.to || !drawn.has(e.from) || !drawn.has(e.to)) continue;
    const from = byId.get(e.from)!;
    const to = byId.get(e.to)!;
    edges.push({
      id: e.id,
      type: 'floating',
      source: e.from,
      target: e.to,
      label: e.label || undefined,
      className: 'file-edge',
      ariaLabel: `link from ${from.path} to ${to.path}`,
      style: { strokeDasharray: '6 5', strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed },
      selectable: false,
      // Above frames (0). Blocks (1) come later in the page, so a block still covers an edge that
      // crosses it. App sets zIndexMode="manual" so React Flow keeps these numbers as they are.
      zIndex: 1,
    });
  }

  return { nodes: [...frameNodes, ...blockNodes], edges, hidden };
}
