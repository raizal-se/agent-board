import { checkHelloProof, devicePk, helloProof, isDevicePk, newNonce, type DeviceKey } from './device';
import type { Channel, Transport, Unsubscribe } from './transport';

/**
 * The gate in front of the board sync. On each new link both sides prove their device key (the
 * hello, bound to this WebRTC link). Only a peer whose proven key is let in (on the approved list,
 * or the member that just approved us) sees board updates and presence. Others can only use the
 * join channel (`raw`), to ask to come in.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

type Hello = { t: 'h'; pk: string; nonce: string } | { t: 'p'; sig: string } | { t: 'in' };

interface LinkState {
  myNonce: string;
  theirPk?: string;
  theirNonce?: string;
  pendingSig?: string;
  sentProof?: boolean;
  proven?: string;
}

export interface GateOptions {
  device: DeviceKey;
  /** May this proven device key see the board? Called again on `recheck()`. */
  admit: (pk: string) => boolean;
  /** Hello channel name. Default 'hi'. */
  helloChannel?: string;
}

export class GatedTransport implements Transport {
  readonly selfId: string;
  readonly pk: string;
  private readonly links = new Map<string, LinkState>();
  private readonly admitted = new Set<string>();
  /** Peers let in for now by the guest (the member that approved it), by link id. */
  private readonly provisional = new Set<string>();
  private readonly joinHandlers = new Set<(id: string) => void>();
  private readonly leaveHandlers = new Set<(id: string) => void>();
  private readonly provenHandlers = new Set<(id: string, pk: string) => void>();
  private readonly hello: Channel;
  private readonly offs: Unsubscribe[] = [];
  private readonly channels = new Map<string, Channel>();
  private closed = false;

  constructor(
    readonly inner: Transport,
    private readonly opts: GateOptions,
  ) {
    this.selfId = inner.selfId;
    this.pk = devicePk(opts.device);
    this.hello = inner.channel(opts.helloChannel ?? 'hi');
    this.offs.push(inner.onPeerJoin((id) => !this.links.has(id) && this.start(id)));
    this.offs.push(
      inner.onPeerLeave((id) => {
        this.links.delete(id);
        this.provisional.delete(id);
        this.drop(id);
      }),
    );
    this.offs.push(this.hello.onMessage((data, from) => this.onHello(data, from)));
    for (const id of inner.peers()) this.start(id);
  }

  private send(to: string, m: Hello) {
    this.hello.send(enc.encode(JSON.stringify(m)), to);
  }

  private start(id: string) {
    const link: LinkState = { myNonce: newNonce() };
    this.links.set(id, link);
    this.drop(id);
    this.send(id, { t: 'h', pk: this.pk, nonce: link.myNonce });
  }

  private onHello(data: Uint8Array, from: string) {
    let m: Hello;
    try {
      m = JSON.parse(dec.decode(data)) as Hello;
    } catch {
      return;
    }
    let link = this.links.get(from);
    if (!link) {
      // A hello before our join event: start the link now.
      this.start(from);
      link = this.links.get(from)!;
    }
    if (m.t === 'h') {
      if (!isDevicePk(m.pk) || typeof m.nonce !== 'string' || !/^[0-9a-f]{32}$/.test(m.nonce)) return;
      if (link.theirPk && link.theirPk !== m.pk) return;
      link.theirPk = m.pk;
      link.theirNonce = m.nonce;
      if (!link.sentProof) {
        link.sentProof = true;
        this.send(from, { t: 'p', sig: helloProof(this.opts.device, m.nonce, this.binding(from)) });
      }
      if (link.pendingSig) this.check(from, link, link.pendingSig);
    } else if (m.t === 'in') {
      // The other side just let us in. If we let it in too, start the sync again: what it sent
      // before it let us in was dropped there.
      if (this.admitted.has(from)) for (const h of this.joinHandlers) h(from);
    } else if (m.t === 'p' && typeof m.sig === 'string') {
      if (!link.theirPk) link.pendingSig = m.sig;
      else this.check(from, link, m.sig);
    }
  }

  private check(id: string, link: LinkState, sig: string) {
    link.pendingSig = undefined;
    if (link.proven) return;
    if (!checkHelloProof(link.theirPk!, link.myNonce, this.binding(id), sig)) return;
    if (link.theirPk === this.pk) return; // our own key on another link: a copy, keep out
    link.proven = link.theirPk;
    for (const h of this.provenHandlers) h(id, link.proven!);
    this.recheck();
  }

  binding(id: string): string {
    return this.inner.binding?.(id) ?? '';
  }

  /** The proven device key of a link, if its hello checked out. */
  provenPk(id: string): string | undefined {
    return this.links.get(id)?.proven;
  }

  /** Links with a proven key. */
  provenPeers(): { id: string; pk: string }[] {
    const out: { id: string; pk: string }[] = [];
    for (const [id, l] of this.links) if (l.proven && this.inner.peers().includes(id)) out.push({ id, pk: l.proven });
    return out;
  }

  onProven(h: (id: string, pk: string) => void): Unsubscribe {
    this.provenHandlers.add(h);
    return () => this.provenHandlers.delete(h);
  }

  /** Let a link in before its key is on our list (the guest, for the member that approved it). */
  letIn(id: string) {
    this.provisional.add(id);
    this.recheck();
  }

  /** Judge every link again: after the approved list changed. */
  recheck() {
    if (this.closed) return;
    for (const [id, l] of this.links) {
      const ok = !!l.proven && (this.provisional.has(id) || this.opts.admit(l.proven));
      if (ok && !this.admitted.has(id)) {
        this.admitted.add(id);
        this.send(id, { t: 'in' });
        for (const h of this.joinHandlers) h(id);
      } else if (!ok) this.drop(id);
    }
  }

  private drop(id: string) {
    if (!this.admitted.delete(id)) return;
    for (const h of this.leaveHandlers) h(id);
  }

  peers(): string[] {
    const live = new Set(this.inner.peers());
    return [...this.admitted].filter((id) => live.has(id));
  }

  isAdmitted(id: string): boolean {
    return this.admitted.has(id);
  }

  onPeerJoin(h: (id: string) => void): Unsubscribe {
    this.joinHandlers.add(h);
    return () => this.joinHandlers.delete(h);
  }

  onPeerLeave(h: (id: string) => void): Unsubscribe {
    this.leaveHandlers.add(h);
    return () => this.leaveHandlers.delete(h);
  }

  /** A channel only admitted peers use. */
  channel(name: string): Channel {
    const known = this.channels.get(name);
    if (known) return known;
    const inner = this.inner.channel(name);
    const ch: Channel = {
      send: (data, to) => {
        const targets = (to === undefined ? this.peers() : typeof to === 'string' ? [to] : to).filter((id) => this.admitted.has(id));
        if (targets.length) inner.send(data, targets);
      },
      onMessage: (h) => inner.onMessage((data, from) => this.admitted.has(from) && h(data, from)),
    };
    this.channels.set(name, ch);
    return ch;
  }

  /** A channel for every link with a proven key, let in or not: the join requests. */
  raw(name: string): Channel {
    const inner = this.inner.channel(name);
    return {
      send: (data, to) => {
        const targets = (to === undefined ? this.provenPeers().map((p) => p.id) : typeof to === 'string' ? [to] : to).filter((id) => !!this.provenPk(id));
        if (targets.length) inner.send(data, targets);
      },
      onMessage: (h) => inner.onMessage((data, from) => !!this.provenPk(from) && h(data, from)),
    };
  }

  async leave(): Promise<void> {
    this.closed = true;
    for (const off of this.offs.splice(0)) off();
    await this.inner.leave();
  }
}
