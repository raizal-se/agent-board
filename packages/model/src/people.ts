import type * as Y from 'yjs';
import type { Side } from './index';
import type { Accept, Person } from './native';

/**
 * People and devices on a shared board (design 9 and 10).
 *
 * - `members`: the approved devices, keyed by device key (hex). Each entry is signed by the member
 *   that approved it; the first device (the board's creator) approves itself. The list travels with
 *   the board, so an approved device rejoins with no prompt.
 * - `revoked`: devices a member took off the board. A revoked device gets no more updates.
 * - `accepts`: who accepted which version (by hash) of a file block. In peer mode a block becomes
 *   agreed once one product person and one engineer accepted the same version.
 * - `retired`: an owner's signed note that it removed one of its file blocks for good.
 *
 * The signatures are made and checked in the sync package; this file only holds the shapes.
 */

export type DeviceKind = 'cli' | 'browser';

export interface Member {
  /** Device key, hex. */
  pk: string;
  /** The person's name, normalized. Two devices of one person share it. */
  name: string;
  side: Side;
  kind: DeviceKind;
  /** Device key of the member that approved it; null for the board's creator. */
  by: string | null;
  at: number;
  /** Signature of the approver over the entry without `sig`. */
  sig: string;
}

export interface Revocation {
  pk: string;
  by: string;
  at: number;
  sig: string;
}

/** One person's accept of one version of a block. Key: `<item>|<name>`. */
export interface PendingAccept {
  item: string;
  name: string;
  side: Side;
  /** The file content (by hash) the person accepted. */
  hash: string;
  at: number;
}

/** The owner removed a file block for good. Key: item id. */
export interface Retired {
  id: string;
  owner: string;
  device: string;
  at: number;
  sig: string;
}

export function membersMap(doc: Y.Doc): Y.Map<Member> {
  return doc.getMap<Member>('members');
}

export function revokedMap(doc: Y.Doc): Y.Map<Revocation> {
  return doc.getMap<Revocation>('revoked');
}

export function acceptsMap(doc: Y.Doc): Y.Map<PendingAccept> {
  return doc.getMap<PendingAccept>('accepts');
}

export function retiredMap(doc: Y.Doc): Y.Map<Retired> {
  return doc.getMap<Retired>('retired');
}

export function isRevoked(doc: Y.Doc, pk: string): boolean {
  return revokedMap(doc).has(pk);
}

/** Approved devices that are not revoked, oldest first. */
export function activeMembers(doc: Y.Doc): Member[] {
  const revoked = revokedMap(doc);
  return [...membersMap(doc).values()]
    .filter((m) => !!m && typeof m.pk === 'string' && !revoked.has(m.pk))
    .sort((a, b) => a.at - b.at || a.pk.localeCompare(b.pk));
}

/** The people on the board: one entry per name, with the side of their first device. */
export function peopleOf(doc: Y.Doc): Person[] {
  const seen = new Map<string, Person>();
  for (const m of activeMembers(doc)) if (!seen.has(m.name)) seen.set(m.name, { name: m.name, side: m.side });
  return [...seen.values()];
}

/**
 * `peer` once a second person is on the board: then agreeing needs one product and one
 * engineering accept. A board with one person (or none, a solo board) keeps one accept.
 */
export function boardModeOf(doc: Y.Doc): 'solo' | 'peer' {
  return peopleOf(doc).length >= 2 ? 'peer' : 'solo';
}

export const acceptKey = (item: string, name: string) => `${item}|${name}`;

/** The accepts of this version of a block: one per person, for `hash` only. */
export function pendingAccepts(doc: Y.Doc, item: string, hash: string): Accept[] {
  const out: Accept[] = [];
  for (const a of acceptsMap(doc).values()) {
    if (a && a.item === item && a.hash === hash) out.push({ name: a.name, side: a.side, at: a.at });
  }
  return out.sort((x, y) => x.at - y.at || x.name.localeCompare(y.name));
}

/** What a card says while a version waits for the other side: "1 of 2 · waiting for engineering". */
export function waitingText(accepts: readonly Accept[]): string | null {
  const product = accepts.some((a) => a.side === 'product');
  const engineering = accepts.some((a) => a.side === 'engineering');
  if (product === engineering) return null;
  return `1 of 2 · waiting for ${product ? 'engineering' : 'product'}`;
}
