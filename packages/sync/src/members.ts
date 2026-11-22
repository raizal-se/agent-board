import { boardIdOf, membersMap, revokedMap, type DeviceKind, type Member, type Revocation } from './board-maps';
import type * as Y from 'yjs';
import { devicePk, isDevicePk, normalizeName, signFor, verifyFor, type DeviceKey } from './device';

/**
 * The approved list (design 10). Each entry is signed by the member that approved it, and the chain
 * of approvers ends at the board's creator, whose key is in the invite. Every device checks the
 * chain: an entry that does not chain to the creator approves nothing.
 */

const MEMBER = 'agent-board/member/v1';
const REVOKE = 'agent-board/revoke/v1';
const ROOT_KEY = 'root';

export function rootOf(doc: Y.Doc): string | undefined {
  const r = doc.getMap('meta').get(ROOT_KEY);
  return typeof r === 'string' ? r : undefined;
}

function memberPayload(boardId: string, m: Omit<Member, 'sig'>): string {
  return JSON.stringify([boardId, m.pk, m.name, m.side, m.kind, m.by, m.at]);
}

function revokePayload(boardId: string, r: Omit<Revocation, 'sig'>): string {
  return JSON.stringify([boardId, r.pk, r.by, r.at]);
}

/** The creator's first step on a board it shares: it is the root, and its first member. */
export function makeRoot(doc: Y.Doc, device: DeviceKey, me: { name: string; side: Member['side']; kind: DeviceKind }, now = Date.now()): void {
  const boardId = boardIdOf(doc);
  if (!boardId) throw new Error('the board has no id');
  const pk = devicePk(device);
  const known = rootOf(doc);
  if (known && known !== pk) throw new Error('this board was shared from another device');
  doc.transact(() => {
    if (!known) doc.getMap('meta').set(ROOT_KEY, pk);
    if (!membersMap(doc).has(pk)) approve(doc, device, { pk, name: me.name, side: me.side, kind: me.kind }, now, null);
  });
}

/** Approve a device: a signed entry in the list. `by` null only for the creator itself. */
export function approve(
  doc: Y.Doc,
  device: DeviceKey,
  who: { pk: string; name: string; side: Member['side']; kind: DeviceKind },
  now = Date.now(),
  by: string | null = devicePk(device),
): Member {
  const boardId = boardIdOf(doc)!;
  const name = normalizeName(who.name);
  const body: Omit<Member, 'sig'> = { pk: who.pk, name, side: who.side, kind: who.kind, by, at: now };
  const m: Member = { ...body, sig: signFor(device, MEMBER, memberPayload(boardId, body)) };
  membersMap(doc).set(who.pk, m);
  return m;
}

export function revoke(doc: Y.Doc, device: DeviceKey, pk: string, now = Date.now()): Revocation {
  const boardId = boardIdOf(doc)!;
  const body = { pk, by: devicePk(device), at: now };
  const r: Revocation = { ...body, sig: signFor(device, REVOKE, revokePayload(boardId, body)) };
  revokedMap(doc).set(pk, r);
  return r;
}

/**
 * Checks of the list, with a cache that clears on each change of `members`, `revoked` or `meta`.
 * `root` is the creator's key: from the invite on a guest, from the board on a member.
 */
export class MemberList {
  private cache = new Map<string, boolean>();
  private readonly listeners = new Set<() => void>();
  private readonly off: () => void;

  constructor(
    readonly doc: Y.Doc,
    private readonly root: () => string | undefined,
  ) {
    const clear = () => {
      this.cache.clear();
      for (const l of this.listeners) l();
    };
    const members = membersMap(doc);
    const revoked = revokedMap(doc);
    const meta = doc.getMap('meta');
    members.observe(clear);
    revoked.observe(clear);
    meta.observe(clear);
    this.off = () => {
      members.unobserve(clear);
      revoked.unobserve(clear);
      meta.unobserve(clear);
    };
  }

  onChange(h: () => void): () => void {
    this.listeners.add(h);
    return () => this.listeners.delete(h);
  }

  /** The entry, if it is signed and chains to the creator (revoked or not). */
  entry(pk: string): Member | undefined {
    return this.chained(pk, new Set()) ? membersMap(this.doc).get(pk) : undefined;
  }

  /** On the list and not revoked: this device may sync. */
  approved(pk: string): boolean {
    return !!this.entry(pk) && !this.revoked(pk);
  }

  revoked(pk: string): boolean {
    const r = revokedMap(this.doc).get(pk);
    const boardId = boardIdOf(this.doc);
    if (!r || !boardId || r.pk !== pk || pk === this.root()) return false;
    return !!this.entry(r.by) && verifyFor(r.by, REVOKE, revokePayload(boardId, r), r.sig);
  }

  /** Approved devices, oldest first. */
  list(): Member[] {
    return [...membersMap(this.doc).values()].filter((m) => m && this.approved(m.pk)).sort((a, b) => a.at - b.at || a.pk.localeCompare(b.pk));
  }

  private chained(pk: string, seen: Set<string>): boolean {
    const hit = this.cache.get(pk);
    if (hit !== undefined) return hit;
    if (seen.has(pk)) return false;
    seen.add(pk);
    const ok = this.check(pk, seen);
    this.cache.set(pk, ok);
    return ok;
  }

  private check(pk: string, seen: Set<string>): boolean {
    const m = membersMap(this.doc).get(pk);
    const boardId = boardIdOf(this.doc);
    const root = this.root();
    if (!m || !boardId || !root || !isDevicePk(pk) || m.pk !== pk) return false;
    if (m.name !== normalizeName(m.name) || !m.name) return false;
    if (m.side !== 'product' && m.side !== 'engineering') return false;
    const body = memberPayload(boardId, m);
    if (m.by === null) return pk === root && verifyFor(pk, MEMBER, body, m.sig);
    if (!isDevicePk(m.by) || !verifyFor(m.by, MEMBER, body, m.sig)) return false;
    return this.chained(m.by, seen);
  }

  destroy() {
    this.off();
    this.listeners.clear();
  }
}
