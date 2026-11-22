import type * as Y from 'yjs';
import { Presence } from './awareness';
import { membersMap, type DeviceKind, type Member, type Side } from './board-maps';
import { devicePk, fingerprint, type DeviceKey } from './device';
import { GatedTransport } from './gate';
import { MemberList, revoke as revokeDevice, rootOf } from './members';
import { OwnerGuard } from './owner';
import { GuestDesk, MemberDesk, type ClosedRequest, type GuestStatus, type JoinRequest } from './requests';
import type { Transport, Unsubscribe } from './transport';
import { YjsSync } from './yjs-sync';

/**
 * One device on a shared board: the gate, the doc sync, presence, the owner check and the join
 * desk, over one room link. The same class runs in the CLI (Node) and in a browser.
 */

export interface PeerMe {
  name: string;
  side: Side;
  kind: DeviceKind;
}

export interface PeerOptions {
  doc: Y.Doc;
  device: DeviceKey;
  me: PeerMe;
  /** The board creator's key: from the invite on a guest; from the board on a member. */
  root: string;
  /** Join the room. Called again for a rejoin. */
  connect: () => Promise<Transport>;
  /** Rejoin when a peer is seen only through others for this long. Default 10 s. */
  rejoinAfterMs?: number;
  /** A guest drops the board when the approval does not check out in this time. Default 20 s. */
  verifyMs?: number;
  /** Called when the guest's check fails: the caller wipes the copy. */
  onRejected?: () => void;
  presenceHeartbeatMs?: number;
  presenceTimeoutMs?: number;
}

export interface OnlinePeer {
  id: string;
  pk: string;
  name: string;
  side: Side;
  kind: DeviceKind;
  /** Name of the peer it is synced through, or null for a direct link. */
  via: string | null;
  cursor: unknown;
}

export type JoinStep = GuestStatus | { step: 'in' } | { step: 'rejected' };

export interface PeerState {
  me: PeerMe & { pk: string; fingerprint: string };
  member: boolean;
  join: JoinStep;
  online: OnlinePeer[];
  members: (Member & { fingerprint: string })[];
  requests: (JoinRequest & { fingerprint: string })[];
  closed: ClosedRequest[];
  /** Names of people we see only through others even after a rejoin: their network blocks a direct link. */
  blocked: string[];
  /** Any direct link to a member right now. */
  linked: boolean;
}

interface Layers {
  gate: GatedTransport;
  sync: YjsSync;
  presence: Presence;
  desk: MemberDesk;
  guest?: GuestDesk;
  offs: Unsubscribe[];
}

export class BoardPeer {
  readonly list: MemberList;
  readonly guard: OwnerGuard;
  readonly pk: string;
  private layers: Layers | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly offs: Unsubscribe[] = [];
  private cursor: unknown = null;
  private joinStep: JoinStep;
  private verifyTimer: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private readonly forwardedSince = new Map<string, number>();
  private readonly blocked = new Set<string>();
  private lastRejoin = 0;
  private rejoining = false;
  private stopped = false;

  constructor(private readonly o: PeerOptions) {
    this.pk = devicePk(o.device);
    this.list = new MemberList(o.doc, () => o.root);
    this.guard = new OwnerGuard(o.doc, this.list);
    this.joinStep = this.list.approved(this.pk) ? { step: 'in' } : { step: 'looking' };
    this.offs.push(
      this.list.onChange(() => {
        this.layers?.gate.recheck();
        this.verify();
        if (this.joinStep.step === 'in' && !this.list.approved(this.pk) && this.list.revoked(this.pk)) {
          // We were taken off the board.
          this.joinStep = { step: 'rejected' };
          void this.stop();
          o.onRejected?.();
        }
        this.emit();
      }),
    );
  }

  get member(): boolean {
    return this.list.approved(this.pk);
  }

  async start(): Promise<void> {
    await this.connect();
    const rejoinAfter = this.o.rejoinAfterMs ?? 10_000;
    this.watchdog = setInterval(() => this.watch(rejoinAfter), Math.min(2_000, rejoinAfter / 2));
  }

  private async connect() {
    const inner = await this.o.connect();
    if (this.stopped) {
      await inner.leave();
      return;
    }
    const gate = new GatedTransport(inner, { device: this.o.device, admit: (pk) => this.list.approved(pk) });
    const sync = new YjsSync(this.o.doc, gate);
    const presence = new Presence(gate, this.presenceState(), {
      heartbeatMs: this.o.presenceHeartbeatMs,
      timeoutMs: this.o.presenceTimeoutMs,
    });
    const desk = new MemberDesk({ doc: this.o.doc, gate, list: this.list, device: this.o.device, name: () => this.o.me.name });
    const layers: Layers = { gate, sync, presence, desk, offs: [] };
    if (!this.member && this.joinStep.step !== 'in') {
      layers.guest = new GuestDesk({ gate, me: this.o.me });
      layers.offs.push(
        layers.guest.onChange(() => {
          const s = layers.guest!.status;
          if (this.joinStep.step !== 'in' && this.joinStep.step !== 'rejected') this.joinStep = s;
          if (s.step === 'approved') this.startVerify();
          this.emit();
        }),
      );
    }
    layers.offs.push(presence.onChange(() => this.emit()));
    layers.offs.push(desk.onChange(() => this.emit()));
    layers.offs.push(gate.onPeerJoin(() => this.emit()));
    layers.offs.push(gate.onPeerLeave(() => this.emit()));
    this.layers = layers;
    this.emit();
  }

  private presenceState() {
    const { name, side, kind } = this.o.me;
    return { name, side, kind, pk: this.pk, cursor: this.cursor };
  }

  /** The guest checks the board it got: the creator from the invite, and a chain to it for us and our approver. */
  private startVerify() {
    clearTimeout(this.verifyTimer);
    this.verifyTimer = setTimeout(() => {
      if (this.joinStep.step === 'approved') this.reject();
    }, this.o.verifyMs ?? 20_000);
    this.verify();
  }

  private verify() {
    const s = this.joinStep;
    if (s.step !== 'approved') return;
    const root = rootOf(this.o.doc);
    if (root !== undefined && root !== this.o.root) return this.reject();
    if (root === this.o.root && this.list.approved(this.pk) && this.list.approved(s.byPk)) {
      clearTimeout(this.verifyTimer);
      this.joinStep = { step: 'in' };
      this.layers?.guest?.destroy();
      if (this.layers) this.layers.guest = undefined;
      this.layers?.gate.recheck();
      this.emit();
    }
  }

  private reject() {
    clearTimeout(this.verifyTimer);
    this.joinStep = { step: 'rejected' };
    void this.stop();
    this.o.onRejected?.();
    this.emit();
  }

  /** Peers seen only through others for a while: rejoin the room once; if that does not help, the network blocks it. */
  private watch(after: number) {
    const l = this.layers;
    if (!l || this.rejoining) return;
    const now = Date.now();
    const direct = new Set(l.gate.peers());
    const seen = new Set<string>();
    for (const e of l.presence.others()) {
      const st = e.state as { pk?: string; name?: string } | null;
      const key = st?.pk ?? e.id;
      seen.add(key);
      if (direct.has(e.id)) {
        this.forwardedSince.delete(key);
        if (st?.name) this.blocked.delete(st.name);
        continue;
      }
      if (!this.forwardedSince.has(key)) this.forwardedSince.set(key, now);
    }
    for (const k of [...this.forwardedSince.keys()]) if (!seen.has(k)) this.forwardedSince.delete(k);
    const stuck = [...this.forwardedSince.entries()].filter(([, t]) => now - t >= after);
    if (!stuck.length) return;
    if (now - this.lastRejoin >= after * 3) {
      void this.rejoin();
      return;
    }
    // Rejoined recently and still no direct link: say so.
    let changed = false;
    for (const e of l.presence.others()) {
      const st = e.state as { pk?: string; name?: string } | null;
      if (st?.name && stuck.some(([k]) => k === (st.pk ?? e.id)) && !this.blocked.has(st.name)) {
        this.blocked.add(st.name);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  /** Leave the room and join it again (new WebRTC links). The board copy stays. */
  async rejoin(): Promise<void> {
    if (this.rejoining || this.stopped) return;
    this.rejoining = true;
    this.lastRejoin = Date.now();
    this.forwardedSince.clear();
    try {
      await this.teardown();
      await this.connect();
    } finally {
      this.rejoining = false;
    }
  }

  private async teardown() {
    const l = this.layers;
    this.layers = undefined;
    if (!l) return;
    for (const off of l.offs) off();
    l.guest?.destroy();
    l.desk.destroy();
    l.presence.destroy();
    l.sync.destroy();
    await l.gate.leave();
  }

  setCursor(cursor: unknown) {
    this.cursor = cursor;
    this.layers?.presence.setState(this.presenceState());
  }

  /** Change the name or side shown to others (presence only; the approved entry stays). */
  setMe(me: Partial<PeerMe>) {
    Object.assign(this.o.me, me);
    this.layers?.presence.setState(this.presenceState());
  }

  approve(pk: string): boolean {
    return this.layers?.desk.approve(pk) ?? false;
  }

  deny(pk: string): boolean {
    return this.layers?.desk.deny(pk) ?? false;
  }

  /** Take a device off the board. Any member can; the creator's device cannot be taken off. */
  revoke(pk: string): boolean {
    if (!this.member || pk === this.o.root || !membersMap(this.o.doc).has(pk)) return false;
    revokeDevice(this.o.doc, this.o.device, pk);
    return true;
  }

  get sync(): YjsSync | undefined {
    return this.layers?.sync;
  }

  get gate(): GatedTransport | undefined {
    return this.layers?.gate;
  }

  state(): PeerState {
    const l = this.layers;
    const direct = new Set(l?.gate.peers() ?? []);
    const names = new Map<string, string>();
    const online: OnlinePeer[] = [];
    for (const e of l?.presence.others() ?? []) {
      const st = e.state as Partial<OnlinePeer> & { name?: string };
      if (!st?.name || !st.pk) continue;
      names.set(e.id, st.name);
      online.push({
        id: e.id,
        pk: st.pk,
        name: st.name,
        side: st.side === 'product' ? 'product' : 'engineering',
        kind: st.kind === 'cli' ? 'cli' : 'browser',
        via: direct.has(e.id) ? null : e.via,
        cursor: st.cursor ?? null,
      });
    }
    for (const p of online) if (p.via !== null) p.via = names.get(p.via) ?? null;
    const memberLinks = [...direct].some((id) => {
      const pk = l?.gate.provenPk(id);
      return !!pk && this.list.approved(pk);
    });
    return {
      me: { ...this.o.me, pk: this.pk, fingerprint: fingerprint(this.pk) },
      member: this.member,
      join: this.joinStep,
      online: online.filter((p) => p.pk !== this.pk),
      members: this.list.list().map((m) => ({ ...m, fingerprint: fingerprint(m.pk) })),
      requests: (this.member ? (l?.desk.list() ?? []) : []).map((r) => ({ ...r, fingerprint: fingerprint(r.pk) })),
      closed: l?.desk.recentlyClosed() ?? [],
      blocked: [...this.blocked],
      linked: memberLinks,
    };
  }

  onChange(h: () => void): Unsubscribe {
    this.listeners.add(h);
    return () => this.listeners.delete(h);
  }

  private emit() {
    for (const h of this.listeners) h();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.watchdog);
    clearTimeout(this.verifyTimer);
    await this.teardown();
  }

  destroy() {
    void this.stop();
    for (const off of this.offs.splice(0)) off();
    this.guard.destroy();
    this.list.destroy();
    this.listeners.clear();
  }
}
