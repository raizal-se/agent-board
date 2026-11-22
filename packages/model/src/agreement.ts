import type * as Y from 'yjs';
import type { Side, Zone } from './index';
import { fileItemOf, itemsMap, type FileItem, type FileType } from './items';
import { DECISION_H, DECISION_W, layoutMap, nextItemSpot } from './layout';
import { nativeId, type Accept, type DecisionItem, type Person } from './native';

/**
 * Agreement (design 6). Agreeing on file blocks makes a decision block and gives each covered block
 * a frozen snapshot of its content. The snapshot never changes; when the file changes after that,
 * the block shows "changed after agreement" until a person keeps the snapshot or agrees again.
 *
 * The board's part of a file block lives in its own map, `agreements`, keyed by the block's id, and
 * not on the file item: the CLI rewrites the whole file item on each save, so a field there could
 * be lost to a save that lands at the same moment.
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
  /** The decision block that agreed it. */
  decision: string;
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

/** The zone comes from the state, never from the position (design 3.1). */
export function zoneOf(a: Agreement | undefined, ownerSide: Side): Zone {
  return a ? 'agreed' : ownerSide;
}

function snapshotOf(item: FileItem, at: number): Snapshot {
  return { text: item.text, hash: item.hash, type: item.type, at };
}

/**
 * Agree on file blocks of one frame: a decision block, and a snapshot for each block. Blocks that
 * are not file blocks, are gone or sit in another frame are left out. Returns the decision id, or
 * null when nothing is left to agree on.
 */
export function agree(
  doc: Y.Doc,
  opts: { text: string; covers: readonly string[]; by: Person; mode?: AgreeMode; now?: number },
): string | null {
  const text = opts.text.trim();
  const files = opts.covers.map((id) => fileItemOf(doc, id)).filter((f): f is FileItem => !!f && !f.gone);
  if (!text || files.length === 0) return null;
  const frame = files[0]!.frame;
  const covered = files.filter((f) => f.frame === frame);
  const at = opts.now ?? Date.now();
  const accepts: Accept[] = [{ name: opts.by.name, side: opts.by.side, at }];
  const id = nativeId('d');
  doc.transact(() => {
    const spot = nextItemSpot(doc, frame, { zone: 'agreed', w: DECISION_W, h: DECISION_H });
    const decision: DecisionItem = { id, kind: 'decision', frame, text, covers: covered.map((f) => f.id), accepts, author: opts.by.name, createdAt: at };
    itemsMap(doc).set(id, decision);
    layoutMap(doc).set(id, spot);
    if (!isAgreed(accepts, opts.mode ?? 'solo')) return;
    for (const f of covered) agreementsMap(doc).set(f.id, { item: f.id, decision: id, snapshot: snapshotOf(f, at), accepts });
  });
  return id;
}

/** "Keep snapshot": the file stays as it is, the snapshot stays, the mark goes until the next change. */
export function keepSnapshot(doc: Y.Doc, itemId: string): boolean {
  const a = agreementsMap(doc).get(itemId);
  const f = fileItemOf(doc, itemId);
  if (!a || !f) return false;
  agreementsMap(doc).set(itemId, { ...a, keptHash: f.hash });
  return true;
}

/** "Agree again": a new snapshot of the current file, once the accepts are enough for `mode`. */
export function agreeAgain(doc: Y.Doc, itemId: string, opts: { by: Person; mode?: AgreeMode; now?: number }): boolean {
  const a = agreementsMap(doc).get(itemId);
  const f = fileItemOf(doc, itemId);
  if (!a || !f) return false;
  const at = opts.now ?? Date.now();
  const accepts: Accept[] = [{ name: opts.by.name, side: opts.by.side, at }];
  if (!isAgreed(accepts, opts.mode ?? 'solo')) return false;
  agreementsMap(doc).set(itemId, { item: itemId, decision: a.decision, snapshot: snapshotOf(f, at), accepts });
  return true;
}
