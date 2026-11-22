import * as Y from 'yjs';
import { boardIdOf, itemsMap, retiredMap, type Retired, type SignedFile } from './board-maps';
import { devicePk, sha256Hex, signFor, verifyFor, type DeviceKey } from './device';
import type { MemberList } from './members';

/**
 * Owner check on every peer (design 10). On a shared board each file item carries its owner's
 * device key and that device's signature. A member cannot change another member's file card: every
 * peer checks each change and puts back the last good value. A file card goes away for good only
 * with the owner's signed note in `retired`.
 */

const ITEM = 'agent-board/item/v1';
const RETIRE = 'agent-board/retire/v1';

/** Transaction origin of the guard's own repairs. */
export const GUARD = Symbol('owner-guard');

function itemPayload(boardId: string, f: SignedFile): string {
  return JSON.stringify([boardId, f.id, f.kind, f.path, f.frame, f.type, f.hash, f.area ?? null, f.owner, f.gone, f.updatedAt, f.device ?? null]);
}

function retirePayload(boardId: string, r: Omit<Retired, 'sig'>): string {
  return JSON.stringify([boardId, r.id, r.owner, r.device, r.at]);
}

/** Sign a file item as its owner device. Returns the item with `device` and `sig`. */
export function signItem<T extends SignedFile>(doc: Y.Doc, device: DeviceKey, item: T): T {
  const boardId = boardIdOf(doc);
  if (!boardId) throw new Error('the board has no id');
  const withDevice = { ...item, device: devicePk(device) };
  return { ...withDevice, sig: signFor(device, ITEM, itemPayload(boardId, withDevice)) };
}

/** The owner's note that it removed a file card for good. */
export function signRetired(doc: Y.Doc, device: DeviceKey, id: string, owner: string, now = Date.now()): Retired {
  const boardId = boardIdOf(doc)!;
  const body = { id, owner, device: devicePk(device), at: now };
  return { ...body, sig: signFor(device, RETIRE, retirePayload(boardId, body)) };
}

function isFile(v: unknown): v is SignedFile {
  return !!v && typeof v === 'object' && (v as { kind?: unknown }).kind === 'file';
}

/**
 * Is the signature good, and does the device belong to the owner? `undefined` when the device is
 * not on the list (yet): the guard waits for the list to sync before it judges.
 */
export function checkItem(doc: Y.Doc, list: MemberList, f: SignedFile): boolean | undefined {
  const boardId = boardIdOf(doc);
  if (!boardId || typeof f.device !== 'string' || typeof f.sig !== 'string') return false;
  if (typeof f.text !== 'string' || sha256Hex(f.text) !== f.hash) return false;
  if (!verifyFor(f.device, ITEM, itemPayload(boardId, f), f.sig)) return false;
  const m = list.entry(f.device);
  if (!m) return undefined;
  return m.name === f.owner;
}

function checkRetired(doc: Y.Doc, list: MemberList, r: Retired | undefined, last: SignedFile): boolean {
  const boardId = boardIdOf(doc);
  if (!r || !boardId || r.id !== last.id || r.device !== last.device || r.owner !== last.owner) return false;
  return !!list.entry(r.device) && verifyFor(r.device, RETIRE, retirePayload(boardId, r), r.sig);
}

export interface GuardStats {
  restored: number;
  removed: number;
  held: number;
}

/**
 * Watches `items` for file cards. A change that fails the check is undone: the last good value is
 * written back, or the card is removed when there was none. A change from a device that is not on
 * the list yet is held and judged again when the list changes. The guard is on only when the board
 * has an approved list (a shared board); a solo board is not checked.
 */
export class OwnerGuard {
  readonly stats: GuardStats = { restored: 0, removed: 0, held: 0 };
  private readonly good = new Map<string, SignedFile>();
  private readonly held = new Set<string>();
  private readonly offs: (() => void)[] = [];

  constructor(
    readonly doc: Y.Doc,
    readonly list: MemberList,
    private readonly active: () => boolean = () => list.list().length > 0,
  ) {
    const items = itemsMap(doc);
    const onItems = (ev: Y.YMapEvent<unknown>, tr: Y.Transaction) => {
      if (tr.origin === GUARD || !this.active()) return;
      this.judge([...ev.keysChanged]);
    };
    items.observe(onItems);
    this.offs.push(() => items.unobserve(onItems));
    this.offs.push(list.onChange(() => this.recheck()));
    this.recheck();
  }

  /** Judge every file card again (after the list changed, or at start). */
  recheck() {
    if (!this.active()) return;
    const items = itemsMap(this.doc);
    const keys = new Set<string>([...this.held, ...this.good.keys()]);
    for (const [k, v] of items.entries()) if (isFile(v)) keys.add(k);
    this.judge([...keys]);
  }

  private judge(keys: string[]) {
    const items = itemsMap(this.doc);
    const fixes: (() => void)[] = [];
    for (const id of keys) {
      const v = items.get(id);
      const last = this.good.get(id);
      if (v === undefined) {
        this.held.delete(id);
        if (!last) continue;
        if (checkRetired(this.doc, this.list, retiredMap(this.doc).get(id), last)) {
          this.good.delete(id);
          continue;
        }
        this.stats.restored++;
        fixes.push(() => items.set(id, last));
        continue;
      }
      if (!isFile(v)) {
        if (last) {
          this.stats.restored++;
          fixes.push(() => items.set(id, last));
        }
        continue;
      }
      if (last && sameItem(last, v)) continue;
      const ok = checkItem(this.doc, this.list, v);
      const takeover = !!last && (v.device !== last.device || v.owner !== last.owner);
      const older = !!last && v.updatedAt < last.updatedAt;
      if (ok === true && !takeover && !older && v.id === id) {
        this.good.set(id, v);
        this.held.delete(id);
        continue;
      }
      if (ok === undefined && !last) {
        // Signed by a device we do not know yet: wait for the list.
        if (!this.held.has(id)) this.stats.held++;
        this.held.add(id);
        continue;
      }
      this.held.delete(id);
      if (last) {
        this.stats.restored++;
        fixes.push(() => items.set(id, last));
      } else {
        this.stats.removed++;
        fixes.push(() => items.delete(id));
      }
    }
    if (fixes.length) this.doc.transact(() => fixes.forEach((f) => f()), GUARD);
  }

  destroy() {
    for (const off of this.offs.splice(0)) off();
  }
}

function sameItem(a: SignedFile, b: SignedFile): boolean {
  return a.sig === b.sig && a.text === b.text && a.hash === b.hash;
}
