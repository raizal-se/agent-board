import type { Transport, Unsubscribe } from './transport';

export type PresenceState = Record<string, unknown>;

export interface PresenceEntry {
  /** Transport id of the peer that owns this entry (not the peer it arrived from). */
  id: string;
  clock: number;
  state: PresenceState | null;
  /** Local time we last heard about it. */
  seenAt: number;
  /** Peer the latest message for this entry arrived from (self for our own entry). */
  via: string;
}

interface Wire {
  id: string;
  clock: number;
  state: PresenceState | null;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Minimal awareness (who is online, names, cursors) on its own channel, with the same
 * forwarding rule as doc updates: a newer clock for an entry is applied and sent on to
 * every peer except the one it came from. An older or equal clock is dropped, so loops end.
 */
export class Presence {
  readonly entries = new Map<string, PresenceEntry>();
  private clock = 0;
  private readonly channel;
  private readonly offs: Unsubscribe[] = [];
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    readonly transport: Transport,
    initial: PresenceState,
    opts: { channelName?: string; heartbeatMs?: number; timeoutMs?: number } = {},
  ) {
    this.channel = transport.channel(opts.channelName ?? 'aw');
    const heartbeatMs = opts.heartbeatMs ?? 10_000;
    const timeoutMs = opts.timeoutMs ?? 30_000;
    this.entries.set(transport.selfId, {
      id: transport.selfId,
      clock: 0,
      state: initial,
      seenAt: Date.now(),
      via: transport.selfId,
    });

    this.offs.push(
      this.channel.onMessage((data, from) => {
        const msgs = JSON.parse(dec.decode(data)) as Wire[];
        const fresh: Wire[] = [];
        for (const m of msgs) {
          if (m.id === transport.selfId) continue;
          const cur = this.entries.get(m.id);
          if (cur && cur.clock >= m.clock) continue;
          this.entries.set(m.id, { ...m, seenAt: Date.now(), via: from });
          fresh.push(m);
        }
        if (fresh.length === 0) return;
        const targets = transport.peers().filter((p) => p !== from);
        if (targets.length) this.channel.send(enc.encode(JSON.stringify(fresh)), targets);
        this.emit();
      }),
    );
    // A new direct peer gets everything we know, so it learns about peers it cannot reach.
    this.offs.push(transport.onPeerJoin((p) => this.sendAll(p)));
    this.offs.push(transport.onPeerLeave(() => this.emit()));

    this.timer = setInterval(() => {
      this.setState(this.getState());
      const now = Date.now();
      let changed = false;
      for (const [id, e] of this.entries) {
        if (id !== transport.selfId && now - e.seenAt > timeoutMs) {
          this.entries.delete(id);
          changed = true;
        }
      }
      if (changed) this.emit();
    }, heartbeatMs);
  }

  getState(): PresenceState | null {
    return this.entries.get(this.transport.selfId)?.state ?? null;
  }

  setState(state: PresenceState | null) {
    const e: PresenceEntry = {
      id: this.transport.selfId,
      clock: ++this.clock,
      state,
      seenAt: Date.now(),
      via: this.transport.selfId,
    };
    this.entries.set(e.id, e);
    const w: Wire = { id: e.id, clock: e.clock, state };
    if (this.transport.peers().length) this.channel.send(enc.encode(JSON.stringify([w])));
    this.emit();
  }

  /** Other peers we know about (direct or forwarded). */
  others(): PresenceEntry[] {
    return [...this.entries.values()].filter((e) => e.id !== this.transport.selfId && e.state);
  }

  onChange(h: () => void): Unsubscribe {
    this.listeners.add(h);
    return () => this.listeners.delete(h);
  }

  private sendAll(peerId: string) {
    const all: Wire[] = [...this.entries.values()].map(({ id, clock, state }) => ({ id, clock, state }));
    this.channel.send(enc.encode(JSON.stringify(all)), peerId);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  destroy() {
    clearInterval(this.timer);
    this.setState(null);
    for (const off of this.offs.splice(0)) off();
  }
}
