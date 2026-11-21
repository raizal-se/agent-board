import type * as Y from 'yjs';

/**
 * Edges from links in files (design 4.3).
 *
 * An edge from a file always points from the file that holds the link, and it belongs to that file:
 * the file's current list of links is the full truth for its edges. Edges drawn by humans
 * (`source: 'human'`) are never touched here.
 *
 * `toPath` is the link as written (relative to the board root). `to` is the target block id, or
 * null while no block has had that path. When the target is renamed, `to` follows it; when a block
 * appears at `toPath` again, `to` points at that block. The canvas draws an edge only when `to`
 * names a visible block.
 */
export interface FileEdge {
  id: string;
  source: 'file';
  /** Item id of the file that holds the link. The edge belongs to it. */
  from: string;
  /** Target path, as written in the link. */
  toPath: string;
  /** Target item id, or null while the target file does not exist. */
  to: string | null;
  label: string;
}

export interface LinkInput {
  to: string;
  label: string;
}

export function edgesMap(doc: Y.Doc): Y.Map<FileEdge> {
  return doc.getMap<FileEdge>('edges');
}

/** Stable id from the owner item, the path as written and the label. */
export function fileEdgeId(from: string, toPath: string, label: string): string {
  return `fe:${from}->${toPath}#${label}`;
}

/**
 * Make the edges owned by `fromItem` match `links` exactly: add the new ones and delete the ones
 * whose link is gone. Unchanged edges are not rewritten (a save without link changes sends no edge
 * update), except that an edge is pointed at the block `resolve` finds for its path, when there is
 * one and it is another block.
 */
export function syncFileEdges(
  doc: Y.Doc,
  fromItem: string,
  links: readonly LinkInput[],
  resolve: (path: string) => string | null = () => null,
): { added: string[]; removed: string[] } {
  const edges = edgesMap(doc);
  const want = new Map<string, LinkInput>();
  for (const l of links) want.set(fileEdgeId(fromItem, l.to, l.label), l);
  const added: string[] = [];
  const removed: string[] = [];
  doc.transact(() => {
    for (const [id, e] of edges.entries()) {
      if (e?.source === 'file' && e.from === fromItem && !want.has(id)) {
        edges.delete(id);
        removed.push(id);
      }
    }
    for (const [id, l] of want) {
      const prev = edges.get(id);
      if (!prev) {
        edges.set(id, { id, source: 'file', from: fromItem, toPath: l.to, to: resolve(l.to), label: l.label });
        added.push(id);
      } else {
        // A block at the path as written wins. With no block there, the edge keeps its target:
        // that is how an edge follows a renamed target.
        const to = resolve(l.to);
        if (to && to !== prev.to) edges.set(id, { ...prev, to });
      }
    }
  });
  return { added, removed };
}

/**
 * A block now exists at `path`: point every edge whose link names that path at it. This fills
 * waiting edges, and takes back edges that followed an earlier file at that path to its new name.
 */
export function resolveEdgesTo(doc: Y.Doc, path: string, itemId: string): number {
  const edges = edgesMap(doc);
  let n = 0;
  doc.transact(() => {
    for (const [id, e] of edges.entries()) {
      if (e?.source === 'file' && e.toPath === path && e.to !== itemId) {
        edges.set(id, { ...e, to: itemId });
        n++;
      }
    }
  });
  return n;
}

/** All file edges owned by one item. */
export function fileEdgesOf(doc: Y.Doc, fromItem: string): FileEdge[] {
  return [...edgesMap(doc).values()].filter((e) => e?.source === 'file' && e.from === fromItem);
}
