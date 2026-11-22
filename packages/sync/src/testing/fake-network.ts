import type { Channel, Transport, Unsubscribe } from '../transport';

/**
 * In-memory network for tests. Every pair of joined nodes is linked unless the pair is
 * blocked. Delivery is async (macrotask) and in order per link. Counts in-flight messages
 * so tests can wait until the network is quiet.
 */
export class FakeNetwork {
  private nodes = new Map<string, FakeTransport>();
  private blockedPairs = new Set<string>();
  inFlight = 0;
  delivered = 0;

  block(a: string, b: string) {
    this.blockedPairs.add(key(a, b));
  }
  canLink(a: string, b: string) {
    return a !== b && !this.blockedPairs.has(key(a, b));
  }
  join(id: string): FakeTransport {
    const t = new FakeTransport(this, id);
    this.nodes.set(id, t);
    for (const other of this.nodes.values()) {
      if (this.canLink(id, other.selfId)) {
        // Announce both ways asynchronously, like a real handshake completing.
        this.schedule(() => {
          other.emitJoin(id);
          t.emitJoin(other.selfId);
        });
      }
    }
    return t;
  }
  remove(id: string) {
    this.nodes.delete(id);
    for (const other of this.nodes.values()) if (this.canLink(id, other.selfId)) other.emitLeave(id);
  }
  linkedPeers(id: string): string[] {
    return [...this.nodes.keys()].filter((o) => this.canLink(id, o) && this.nodes.get(o)!.joinedPeers.has(id));
  }
  deliver(from: string, to: string, channel: string, data: Uint8Array) {
    if (!this.canLink(from, to)) throw new Error(`fake network: ${from} sent to unreachable ${to}`);
    const copy = data.slice();
    this.schedule(() => {
      this.delivered++;
      this.nodes.get(to)?.receive(channel, copy, from);
    });
  }
  private schedule(fn: () => void) {
    this.inFlight++;
    setTimeout(() => {
      try {
        fn();
      } finally {
        this.inFlight--;
      }
    }, 0);
  }
  /** Resolves once no message is in flight. */
  async settle(): Promise<void> {
    do await new Promise((r) => setTimeout(r, 1));
    while (this.inFlight > 0);
  }
}

class FakeTransport implements Transport {
  readonly joinedPeers = new Set<string>();
  private joinHandlers = new Set<(id: string) => void>();
  private leaveHandlers = new Set<(id: string) => void>();
  private channels = new Map<string, Set<(d: Uint8Array, from: string) => void>>();

  constructor(
    private readonly net: FakeNetwork,
    readonly selfId: string,
  ) {}

  peers() {
    return [...this.joinedPeers];
  }
  onPeerJoin(h: (id: string) => void): Unsubscribe {
    this.joinHandlers.add(h);
    return () => this.joinHandlers.delete(h);
  }
  onPeerLeave(h: (id: string) => void): Unsubscribe {
    this.leaveHandlers.add(h);
    return () => this.leaveHandlers.delete(h);
  }
  emitJoin(id: string) {
    if (this.joinedPeers.has(id)) return;
    this.joinedPeers.add(id);
    for (const h of this.joinHandlers) h(id);
  }
  emitLeave(id: string) {
    if (!this.joinedPeers.delete(id)) return;
    for (const h of this.leaveHandlers) h(id);
  }
  receive(channel: string, data: Uint8Array, from: string) {
    if (!this.joinedPeers.has(from)) return;
    for (const h of this.channels.get(channel) ?? []) h(data, from);
  }
  channel(name: string): Channel {
    return {
      send: (data, to) => {
        const targets = to === undefined ? this.peers() : typeof to === 'string' ? [to] : to;
        for (const t of targets) this.net.deliver(this.selfId, t, name, data);
      },
      onMessage: (h) => {
        let set = this.channels.get(name);
        if (!set) this.channels.set(name, (set = new Set()));
        set.add(h);
        return () => set!.delete(h);
      },
    };
  }
  async leave() {
    this.net.remove(this.selfId);
  }
}

function key(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
