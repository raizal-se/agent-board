import type * as Y from 'yjs';
import { boardPlaced, nextItemSpot, snapId } from './area';
import { fileItemOf, type FileItem, type FileType } from './items';
import { estimateCardH, layoutMap } from './layout';
import { addVerdict, type Accept, type Person } from './native';
import { acceptKey, acceptsMap, boardModeOf, pendingAccepts } from './people';

/**
 * Agreement (design 6), on the card. "✓ Agree" freezes a snapshot of the block's content: the live
 * card stays in its area, and a snapshot card shows the frozen content in the Agreed area. The
 * snapshot never changes; when the file changes after that, both cards show "changed after
 * agreement" until a person keeps the snapshot or agrees again. "✗ Reject" needs a reason and puts
 * a "changes requested" mark on the card, which turns into "updated, review again" when the file is
 * saved with new content. Both are recorded in the block's comment thread.
 *
 * The board's part of a file block lives in its own maps (`agreements`, `reviews`), keyed by the
 * block's id, and not on the file item: the CLI rewrites the whole file item on each save, so a
 * field there could be lost to a save that lands at the same moment.
 */

export type ItemState = 'draft' | 'agreed';

/**
 * Who must accept. `solo`: one person on their own board, one accept is enough. `peer`: one
 * product person and one engineer (design 6); for when the board has more than one person.
 */
export type AgreeMode = 'solo' | 'peer';

export function isAgreed(accepts: readonly Accept[], mode: AgreeMode): boolean {
  if (mode === 'solo') return accepts.length > 0;
  return accepts.some((a) => a.side === 'product') && accepts.some((a) => a.side === 'engineering');
}

export interface Snapshot {
  text: string;
  /** SHA-256 of `text`, as the CLI computed it for the file item. */
  hash: string;
  type: FileType;
  at: number;
}

export interface Agreement {
  /** The file block this is about. */
  item: string;
  /** The decision block that agreed it, for agreements made before agreeing on the card. */
  decision?: string;
  snapshot: Snapshot;
  accepts: Accept[];
  /** The file content (by hash) a person chose to keep the snapshot against. */
  keptHash?: string;
}

export function agreementsMap(doc: Y.Doc): Y.Map<Agreement> {
  return doc.getMap<Agreement>('agreements');
}

/** The file changed since it was agreed, and nobody has kept the snapshot against this version. */
export function changedAfterAgreement(item: Pick<FileItem, 'hash'>, a: Agreement | undefined): boolean {
  return !!a && item.hash !== a.snapshot.hash && item.hash !== a.keptHash;
}

export function stateOf(a: Agreement | undefined): ItemState {
  return a ? 'agreed' : 'draft';
}

function snapshotOf(item: FileItem, at: number): Snapshot {
  return { text: item.text, hash: item.hash, type: item.type, at };
}

/** A reject of a block: who, when, why, and the content (by hash) that was rejected. */
export interface Review {
  item: string;
  by: string;
  at: number;
  reason: string;
  hash: string;
}

export function reviewsMap(doc: Y.Doc): Y.Map<Review> {
  return doc.getMap<Review>('reviews');
}

export type ReviewMark = 'changes requested' | 'updated, review again';

/** The mark a rejected block shows: until its file is saved with new content, then after. */
export function reviewMark(item: Pick<FileItem, 'hash'>, r: Review | undefined): ReviewMark | null {
  if (!r) return null;
  return item.hash === r.hash ? 'changes requested' : 'updated, review again';
}

/**
 * "✓ Agree" on a block: one click. Records "✓ <name> agreed" (with an optional note) in its
 * thread and, once the accepts are enough for `mode`, takes a snapshot of the file as it is now:
 * a first agreement, or a new snapshot in place of the old one. Its snapshot card gets a free spot
 * in the Agreed area the first time. Clears a reject. False for a block that is not on the board.
 */
export function agreeItem(doc: Y.Doc, itemId: string, opts: { by: Person; note?: string; mode?: AgreeMode; now?: number }): boolean {
  const f = fileItemOf(doc, itemId);
  if (!f || f.gone) return false;
  const at = opts.now ?? Date.now();
  const mode = opts.mode ?? boardModeOf(doc);
  doc.transact(() => {
    addVerdict(doc, { target: itemId, by: opts.by, verdict: 'agree', text: opts.note, now: at });
    // This person's accept of this version. In peer mode the other side's accept of the same
    // version may already be there (or come later, see settleAgreements).
    acceptsMap(doc).set(acceptKey(itemId, opts.by.name), { item: itemId, name: opts.by.name, side: opts.by.side, hash: f.hash, at });
    const accepts: Accept[] = mode === 'solo' ? [{ name: opts.by.name, side: opts.by.side, at }] : pendingAccepts(doc, itemId, f.hash);
    if (!isAgreed(accepts, mode)) return;
    takeSnapshot(doc, f, accepts, at);
  });
  return true;
}

/** The block becomes agreed now: a snapshot of the file as it is, and a snapshot card in Agreed. */
function takeSnapshot(doc: Y.Doc, f: FileItem, accepts: Accept[], at: number) {
  const itemId = f.id;
  const prev = agreementsMap(doc).get(itemId);
  agreementsMap(doc).set(itemId, { item: itemId, ...(prev?.decision ? { decision: prev.decision } : {}), snapshot: snapshotOf(f, at), accepts });
  reviewsMap(doc).delete(itemId);
  const layout = layoutMap(doc);
  if (!layout.has(snapId(itemId))) layout.set(snapId(itemId), boardPlaced(undefined, nextItemSpot(doc, f.frame, { area: 'agreed', h: estimateCardH(f.type, f.text) })));
}

/**
 * Peer mode: two people can click "✓ Agree" at the same moment on two devices, and neither sees
 * the other's accept yet. Each device runs this after changes: a version that has its product and
 * its engineering accept, and no snapshot yet, becomes agreed here. Returns the blocks it agreed.
 */
export function settleAgreements(doc: Y.Doc, now = Date.now()): string[] {
  if (boardModeOf(doc) !== 'peer') return [];
  const done: string[] = [];
  const items = new Set<string>();
  for (const a of acceptsMap(doc).values()) if (a) items.add(a.item);
  doc.transact(() => {
    for (const id of items) {
      const f = fileItemOf(doc, id);
      if (!f || f.gone) continue;
      const accepts = pendingAccepts(doc, id, f.hash);
      if (!isAgreed(accepts, 'peer')) continue;
      const a = agreementsMap(doc).get(id);
      if (a && a.snapshot.hash === f.hash && isAgreed(a.accepts, 'peer')) continue;
      takeSnapshot(doc, f, accepts, Math.max(now, ...accepts.map((x) => x.at)));
      done.push(id);
    }
  });
  return done;
}

/** "1 of 2 · waiting for engineering": accepts of the current version that are not enough yet. */
export function waitingAccepts(doc: Y.Doc, itemId: string): Accept[] {
  const f = fileItemOf(doc, itemId);
  if (!f || boardModeOf(doc) !== 'peer') return [];
  const accepts = pendingAccepts(doc, itemId, f.hash);
  if (isAgreed(accepts, 'peer')) return [];
  const a = agreementsMap(doc).get(itemId);
  if (a && a.snapshot.hash === f.hash && isAgreed(a.accepts, 'peer')) return [];
  return accepts;
}

/**
 * "✗ Reject" on a block: needs a reason. Records "✗ <name> rejected: <reason>" in its thread and
 * marks the block "changes requested". False without a reason, or for a block not on the board.
 */
export function rejectItem(doc: Y.Doc, itemId: string, opts: { by: Person; reason: string; now?: number }): boolean {
  const reason = opts.reason.trim();
  const f = fileItemOf(doc, itemId);
  if (!reason || !f || f.gone) return false;
  const at = opts.now ?? Date.now();
  doc.transact(() => {
    reviewsMap(doc).set(itemId, { item: itemId, by: opts.by.name, at, reason, hash: f.hash });
    addVerdict(doc, { target: itemId, by: opts.by, verdict: 'reject', text: reason, now: at });
  });
  return true;
}

/** "Keep snapshot": the file stays as it is, the snapshot stays, the mark goes until the next change. */
export function keepSnapshot(doc: Y.Doc, itemId: string): boolean {
  const a = agreementsMap(doc).get(itemId);
  const f = fileItemOf(doc, itemId);
  if (!a || !f) return false;
  agreementsMap(doc).set(itemId, { ...a, keptHash: f.hash });
  return true;
}
