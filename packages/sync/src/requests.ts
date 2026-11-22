import type * as Y from 'yjs';
import type { DeviceKind, Side } from './board-maps';
import { normalizeName, type DeviceKey } from './device';
import type { GatedTransport } from './gate';
import { approve as approveDevice, type MemberList } from './members';
import type { Unsubscribe } from './transport';

/**
 * Asking to join and letting people in (design 10, one click).
 *
 * guest → member (join channel):  ask { rid, name, side, kind }
 * member → guest (join channel):  wait { by } · ok { by, byPk } · no { by }
 * member → members (board channel): claim { pk, by } · close { pk, by, result }
 *
 * The ask is tied to the device key the guest proved on that link, so a request cannot name
 * another device. Members keep one request per guest device (a new ask replaces the old one), take
 * at most 5 new requests a minute, and drop requests after 5 minutes.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export const RATE_PER_MINUTE = 5;
export const REQUEST_TTL_MS = 5 * 60_000;
export const DENIED_MS = 10 * 60_000;

type Ask = { t: 'ask'; rid: string; name: string; side: Side; kind: DeviceKind };
type Reply = { t: 'wait'; by: string } | { t: 'ok'; by: string; byPk: string } | { t: 'no'; by: string };
type Desk = { t: 'claim'; pk: string; by: string } | { t: 'close'; pk: string; by: string; result: 'approved' | 'denied' };

export interface JoinRequest {
  pk: string;
  rid: string;
  name: string;
  side: Side;
  kind: DeviceKind;
  at: number;
  /** Someone already on the board has this name (another device of theirs, or a look-alike). */
  nameTaken: boolean;
  /** Another member is handling it (point 14). */
  handledBy?: string;
}

export interface ClosedRequest {
  pk: string;
  name: string;
  side: Side;
  by: string;
  result: 'approved' | 'denied';
  at: number;
}

function decode<T>(data: Uint8Array): T | null {
  try {
    return JSON.parse(dec.decode(data)) as T;
  } catch {
    return null;
  }
}

const isSide = (v: unknown): v is Side => v === 'product' || v === 'engineering';
const isKind = (v: unknown): v is DeviceKind => v === 'cli' || v === 'browser';

export interface MemberDeskOptions {
  doc: Y.Doc;
  gate: GatedTransport;
  list: MemberList;
  device: DeviceKey;
  /** This member's name, as others see it. */
  name: () => string;
  now?: () => number;
}

/** The requests a member sees, and its Approve and Deny. */
export class MemberDesk {
  private readonly requests = new Map<string, JoinRequest & { links: Set<string> }>();
  private readonly closed: ClosedRequest[] = [];
  private readonly denied = new Map<string, number>();
  private recent: number[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly offs: Unsubscribe[] = [];
  private readonly join;
  private readonly desk;
  private readonly now: () => number;

  constructor(private readonly o: MemberDeskOptions) {
    this.now = o.now ?? Date.now;
    this.join = o.gate.raw('jn');
    this.desk = o.gate.channel('jd');
    this.offs.push(this.join.onMessage((d, from) => this.onAsk(decode<Ask>(d), from)));
    this.offs.push(this.desk.onMessage((d) => this.onDesk(decode<Desk>(d))));
    this.offs.push(
      o.gate.inner.onPeerLeave((id) => {
        let changed = false;
        for (const [pk, r] of this.requests) {
          if (r.links.delete(id) && r.links.size === 0) {
            this.requests.delete(pk);
            changed = true;
          }
        }
        if (changed) this.emit();
      }),
    );
    this.offs.push(o.list.onChange(() => this.dropSettled()));
  }

  private get me() {
    return this.o.name();
  }

  private get myPk() {
    return this.o.gate.pk;
  }

  private reply(to: string | string[], m: Reply) {
    this.join.send(enc.encode(JSON.stringify(m)), to);
  }

  private onAsk(m: Ask | null, from: string) {
    if (!m || m.t !== 'ask' || !this.o.list.approved(this.myPk)) return;
    const pk = this.o.gate.provenPk(from);
    if (!pk) return;
    const now = this.now();
    if (this.o.list.approved(pk)) {
      // Already on the list (it has not synced the list yet): let it in again.
      this.reply(from, { t: 'ok', by: this.me, byPk: this.myPk });
      return;
    }
    if (this.o.list.revoked(pk) || this.o.list.entry(pk)) return;
    const deniedAt = this.denied.get(pk);
    if (deniedAt !== undefined && now - deniedAt < DENIED_MS) {
      this.reply(from, { t: 'no', by: this.me });
      return;
    }
    const name = normalizeName(m.name);
    if (!name || !isSide(m.side) || !isKind(m.kind) || typeof m.rid !== 'string' || m.rid.length > 64) return;
    const known = this.requests.get(pk);
    if (!known || known.rid !== m.rid) {
      this.recent = this.recent.filter((t) => now - t < 60_000);
      if (!known && this.recent.length >= RATE_PER_MINUTE) return;
      if (!known) this.recent.push(now);
    }
    const nameTaken = this.o.list.list().some((x) => x.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    const links = known?.links ?? new Set<string>();
    links.add(from);
    this.requests.set(pk, { pk, rid: m.rid, name, side: m.side, kind: m.kind, at: known?.rid === m.rid ? known.at : now, nameTaken, links, handledBy: known?.handledBy });
    this.reply(from, { t: 'wait', by: this.me });
    this.emit();
  }

  private onDesk(m: Desk | null) {
    if (!m || typeof m.pk !== 'string' || typeof m.by !== 'string') return;
    const r = this.requests.get(m.pk);
    if (m.t === 'claim') {
      if (r) {
        r.handledBy = m.by;
        this.emit();
      }
    } else if (m.t === 'close' && (m.result === 'approved' || m.result === 'denied')) {
      if (m.result === 'denied') this.denied.set(m.pk, this.now());
      if (r) {
        this.requests.delete(m.pk);
        this.closed.push({ pk: m.pk, name: r.name, side: r.side, by: m.by, result: m.result, at: this.now() });
      }
      if (r && m.result === 'denied') this.reply([...r.links], { t: 'no', by: m.by });
      this.emit();
    }
  }

  private dropSettled() {
    let changed = false;
    for (const [pk, r] of this.requests) {
      if (this.o.list.approved(pk) || this.o.list.revoked(pk)) {
        this.requests.delete(pk);
        const by = this.o.list.entry(pk)?.by;
        const approver = by ? this.o.list.entry(by)?.name : undefined;
        if (approver && this.o.list.approved(pk)) this.closed.push({ pk, name: r.name, side: r.side, by: approver, result: 'approved', at: this.now() });
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  /** Open requests, oldest first. */
  list(): JoinRequest[] {
    const now = this.now();
    for (const [pk, r] of this.requests) if (now - r.at > REQUEST_TTL_MS) this.requests.delete(pk);
    return [...this.requests.values()].map(({ links: _links, ...r }) => r).sort((a, b) => a.at - b.at);
  }

  /** What other members did in the last minute ("Raizal let Dewi in"). */
  recentlyClosed(): ClosedRequest[] {
    const now = this.now();
    return this.closed.filter((c) => now - c.at < 60_000);
  }

  approve(pk: string): boolean {
    const r = this.requests.get(pk);
    if (!r || !this.o.list.approved(this.myPk)) return false;
    this.sendDesk({ t: 'claim', pk, by: this.me });
    approveDevice(this.o.doc, this.o.device, { pk, name: r.name, side: r.side, kind: r.kind }, this.now());
    this.reply([...r.links], { t: 'ok', by: this.me, byPk: this.myPk });
    this.requests.delete(pk);
    this.closed.push({ pk, name: r.name, side: r.side, by: this.me, result: 'approved', at: this.now() });
    this.sendDesk({ t: 'close', pk, by: this.me, result: 'approved' });
    this.emit();
    return true;
  }

  deny(pk: string): boolean {
    const r = this.requests.get(pk);
    if (!r) return false;
    this.sendDesk({ t: 'claim', pk, by: this.me });
    this.denied.set(pk, this.now());
    this.reply([...r.links], { t: 'no', by: this.me });
    this.requests.delete(pk);
    this.closed.push({ pk, name: r.name, side: r.side, by: this.me, result: 'denied', at: this.now() });
    this.sendDesk({ t: 'close', pk, by: this.me, result: 'denied' });
    this.emit();
    return true;
  }

  private sendDesk(m: Desk) {
    this.desk.send(enc.encode(JSON.stringify(m)));
  }

  onChange(h: () => void): Unsubscribe {
    this.listeners.add(h);
    return () => this.listeners.delete(h);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  destroy() {
    for (const off of this.offs.splice(0)) off();
    this.listeners.clear();
  }
}

export type GuestStatus =
  | { step: 'looking' }
  | { step: 'waiting'; by: string[] }
  | { step: 'denied'; by: string }
  | { step: 'approved'; by: string; byPk: string };

export interface GuestDeskOptions {
  gate: GatedTransport;
  me: { name: string; side: Side; kind: DeviceKind };
  rid?: string;
  /** How often to ask again links that did not answer. Default 15 s. */
  retryMs?: number;
}

/** The guest's side: ask every linked device, wait, and let in the member that approved. */
export class GuestDesk {
  status: GuestStatus = { step: 'looking' };
  private readonly waiting = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private readonly offs: Unsubscribe[] = [];
  private readonly join;
  private readonly rid: string;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly o: GuestDeskOptions) {
    this.rid = o.rid ?? Math.random().toString(36).slice(2, 12);
    this.join = o.gate.raw('jn');
    this.offs.push(o.gate.onProven((id) => this.ask(id)));
    this.offs.push(this.join.onMessage((d, from) => this.onReply(decode<Reply>(d), from)));
    this.offs.push(
      o.gate.inner.onPeerLeave((id) => {
        if (this.waiting.delete(id) && this.status.step === 'waiting') this.setWaiting();
      }),
    );
    for (const p of o.gate.provenPeers()) this.ask(p.id);
    this.timer = setInterval(() => {
      if (this.status.step !== 'looking' && this.status.step !== 'waiting') return;
      for (const p of o.gate.provenPeers()) if (!this.waiting.has(p.id)) this.ask(p.id);
    }, o.retryMs ?? 15_000);
  }

  private ask(id: string) {
    if (this.status.step === 'approved' || this.status.step === 'denied') return;
    const { name, side, kind } = this.o.me;
    this.join.send(enc.encode(JSON.stringify({ t: 'ask', rid: this.rid, name: normalizeName(name), side, kind } satisfies Ask)), id);
  }

  private onReply(m: Reply | null, from: string) {
    if (!m || typeof m.by !== 'string' || this.status.step === 'approved') return;
    const by = normalizeName(m.by) || 'someone';
    if (m.t === 'wait') {
      this.waiting.set(from, by);
      if (this.status.step === 'looking' || this.status.step === 'waiting') this.setWaiting();
    } else if (m.t === 'ok') {
      // The member's key must be the one it proved on this link.
      if (m.byPk !== this.o.gate.provenPk(from)) return;
      this.status = { step: 'approved', by, byPk: m.byPk };
      this.o.gate.letIn(from);
      this.emit();
    } else if (m.t === 'no') {
      this.status = { step: 'denied', by };
      this.emit();
    }
  }

  private setWaiting() {
    const by = [...new Set(this.waiting.values())];
    this.status = by.length ? { step: 'waiting', by } : { step: 'looking' };
    this.emit();
  }

  onChange(h: () => void): Unsubscribe {
    this.listeners.add(h);
    return () => this.listeners.delete(h);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  destroy() {
    clearInterval(this.timer);
    for (const off of this.offs.splice(0)) off();
    this.listeners.clear();
  }
}
