import type * as Y from 'yjs';
import { edgesMap, isHumanEdge, type HumanEdge } from './edges';
import type { Side } from './index';
import { itemsMap } from './items';
import { layoutMap, STICKY_H, STICKY_W } from './layout';

/**
 * Board-native items (design 4.2): people make them on the board. The CLI never makes one, and an
 * agent has no file format for them, so agents can read them (in the JSON export) but never write
 * them (design 8).
 */

/** Who did something on the board: a person's name and side. */
export interface Person {
  name: string;
  side: Side;
}

export interface StickyItem {
  id: string;
  kind: 'sticky';
  text: string;
  /** Frame id, or null for a note outside any frame. */
  frame: string | null;
  author: string;
  /** The author's side when it was made: its zone (design 3.1, a new item's zone is where it was made). */
  side: Side;
  createdAt: number;
  updatedAt: number;
}

/** One accept of an agreement: who, from which side, when. */
export interface Accept {
  name: string;
  side: Side;
  at: number;
}

export interface DecisionItem {
  id: string;
  kind: 'decision';
  frame: string;
  text: string;
  /** Ids of the blocks it covers. */
  covers: string[];
  accepts: Accept[];
  author: string;
  createdAt: number;
}

/** One comment. Each comment is its own entry, so two people commenting at once both keep theirs. */
export interface CommentItem {
  id: string;
  kind: 'comment';
  /** The item the thread is on. */
  target: string;
  author: string;
  text: string;
  at: number;
}

/** Whether the thread on `target` is resolved. Id: `thread:<target>`. */
export interface ThreadItem {
  id: string;
  kind: 'thread';
  target: string;
  resolved: boolean;
  by?: string;
  at?: number;
}

export type BoardNativeItem = StickyItem | DecisionItem | CommentItem | ThreadItem;

export function nativeId(prefix: 's' | 'd' | 'c' | 'e'): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export const threadId = (target: string) => `thread:${target}`;

export function isSticky(v: unknown): v is StickyItem {
  return !!v && typeof v === 'object' && (v as StickyItem).kind === 'sticky';
}
export function isDecision(v: unknown): v is DecisionItem {
  return !!v && typeof v === 'object' && (v as DecisionItem).kind === 'decision';
}
export function isComment(v: unknown): v is CommentItem {
  return !!v && typeof v === 'object' && (v as CommentItem).kind === 'comment';
}
export function isThread(v: unknown): v is ThreadItem {
  return !!v && typeof v === 'object' && (v as ThreadItem).kind === 'thread';
}

// --- sticky notes ---

export function addSticky(
  doc: Y.Doc,
  opts: { by: Person; frame: string | null; x: number; y: number; text?: string; now?: number },
): string {
  const id = nativeId('s');
  const now = opts.now ?? Date.now();
  doc.transact(() => {
    itemsMap(doc).set(id, { id, kind: 'sticky', text: opts.text ?? '', frame: opts.frame, author: opts.by.name, side: opts.by.side, createdAt: now, updatedAt: now });
    layoutMap(doc).set(id, { x: Math.round(opts.x), y: Math.round(opts.y), w: STICKY_W, h: STICKY_H });
  });
  return id;
}

export function setStickyText(doc: Y.Doc, id: string, text: string, now = Date.now()): boolean {
  const s = itemsMap(doc).get(id);
  if (!isSticky(s) || s.text === text) return false;
  itemsMap(doc).set(id, { ...s, text, updatedAt: now });
  return true;
}

/** Move a sticky into a frame (or out of all frames), at a position relative to it. */
export function moveSticky(doc: Y.Doc, id: string, frame: string | null, x: number, y: number): void {
  const s = itemsMap(doc).get(id);
  if (!isSticky(s)) return;
  doc.transact(() => {
    if (s.frame !== frame) itemsMap(doc).set(id, { ...s, frame });
    const l = layoutMap(doc);
    l.set(id, { ...l.get(id), x: Math.round(x), y: Math.round(y) });
  });
}

/** Delete a sticky with its place, the edges people drew to it and its comments. */
export function deleteSticky(doc: Y.Doc, id: string): boolean {
  const items = itemsMap(doc);
  if (!isSticky(items.get(id))) return false;
  doc.transact(() => {
    items.delete(id);
    layoutMap(doc).delete(id);
    const edges = edgesMap(doc);
    for (const [eid, e] of edges.entries()) if (isHumanEdge(e) && (e.from === id || e.to === id)) edges.delete(eid);
    for (const [cid, c] of items.entries()) if ((isComment(c) || isThread(c)) && c.target === id) items.delete(cid);
  });
  return true;
}

// --- edges drawn by people ---

export function addHumanEdge(doc: Y.Doc, opts: { from: string; to: string; label?: string; by: Person; now?: number }): string | null {
  if (opts.from === opts.to) return null;
  const id = nativeId('e');
  edgesMap(doc).set(id, { id, source: 'human', from: opts.from, to: opts.to, label: (opts.label ?? '').trim(), author: opts.by.name, createdAt: opts.now ?? Date.now() });
  return id;
}

export function setEdgeLabel(doc: Y.Doc, id: string, label: string): boolean {
  const e = edgesMap(doc).get(id);
  if (!isHumanEdge(e)) return false;
  edgesMap(doc).set(id, { ...e, label: label.trim() });
  return true;
}

/** Delete an edge a person drew. An edge from a file is refused: only a change to the file removes it. */
export function deleteHumanEdge(doc: Y.Doc, id: string): boolean {
  const e = edgesMap(doc).get(id);
  if (!isHumanEdge(e)) return false;
  edgesMap(doc).delete(id);
  return true;
}

export function humanEdges(doc: Y.Doc): HumanEdge[] {
  return [...edgesMap(doc).values()].filter(isHumanEdge);
}

// --- comment threads ---

/** Add a comment to the thread on `target`. A comment on a resolved thread opens it again. */
export function addComment(doc: Y.Doc, opts: { target: string; by: Person; text: string; now?: number }): string | null {
  const text = opts.text.trim();
  if (!text) return null;
  const id = nativeId('c');
  const at = opts.now ?? Date.now();
  const items = itemsMap(doc);
  doc.transact(() => {
    items.set(id, { id, kind: 'comment', target: opts.target, author: opts.by.name, text, at });
    const t = items.get(threadId(opts.target));
    if (isThread(t) && t.resolved) items.set(t.id, { id: t.id, kind: 'thread', target: opts.target, resolved: false });
  });
  return id;
}

export function setThreadResolved(doc: Y.Doc, opts: { target: string; by: Person; resolved: boolean; now?: number }): void {
  const id = threadId(opts.target);
  itemsMap(doc).set(
    id,
    opts.resolved
      ? { id, kind: 'thread', target: opts.target, resolved: true, by: opts.by.name, at: opts.now ?? Date.now() }
      : { id, kind: 'thread', target: opts.target, resolved: false },
  );
}

/** Comments on `target`, oldest first. */
export function commentsOn(doc: Y.Doc, target: string): CommentItem[] {
  return [...itemsMap(doc).values()].filter((c): c is CommentItem => isComment(c) && c.target === target).sort(byTime);
}

export function byTime(a: CommentItem, b: CommentItem): number {
  return a.at - b.at || a.id.localeCompare(b.id);
}
