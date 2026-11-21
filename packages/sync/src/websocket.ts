import type { Channel, Transport, Unsubscribe } from './transport';

/**
 * A WebSocket transport for one laptop: the CLI is a hub, each browser tab is a peer of the hub.
 *
 * Wire format of one message: [name length (1 byte)][channel name, UTF-8][payload].
 * Works with the browser `WebSocket` and with the `ws` package (both have this shape).
 */
export interface SocketLike {
  binaryType: string;
  readonly readyState: number;
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'message', l: (ev: { data: unknown }) => void): void;
  addEventListener(type: 'open' | 'close' | 'error', l: () => void): void;
}

const OPEN = 1;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function encodeMessage(channel: string, payload: Uint8Array): Uint8Array {
  const name = enc.encode(channel);
  if (name.length === 0 || name.length > 255) throw new Error(`bad channel name: ${channel}`);
  const out = new Uint8Array(1 + name.length + payload.length);
  out[0] = name.length;
  out.set(name, 1);
  out.set(payload, 1 + name.length);
  return out;
}

export function decodeMessage(data: unknown): { channel: string; payload: Uint8Array } | null {
  let bytes: Uint8Array;
  if (data instanceof Uint8Array) bytes = data;
  else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
  else if (Array.isArray(data) && data.every((d) => d instanceof Uint8Array)) {
    // `ws` may deliver fragmented messages as a list of buffers.
    const total = data.reduce((n: number, d: Uint8Array) => n + d.length, 0);
    bytes = new Uint8Array(total);
    let at = 0;
    for (const d of data as Uint8Array[]) {
      bytes.set(d, at);
      at += d.length;
    }
  } else return null;
  const len = bytes[0];
  if (len === undefined || len === 0 || bytes.length < 1 + len) return null;
  return { channel: dec.decode(bytes.subarray(1, 1 + len)), payload: bytes.subarray(1 + len) };
}

type MsgHandler = (data: Uint8Array, from: string) => void;

/** Shared bookkeeping: peers, channels and listeners. */
abstract class BaseTransport implements Transport {
  protected readonly sockets = new Map<string, SocketLike>();
  private readonly joinL = new Set<(p: string) => void>();
  private readonly leaveL = new Set<(p: string) => void>();
  private readonly msgL = new Map<string, Set<MsgHandler>>();

  constructor(readonly selfId: string) {}

  peers(): string[] {
    return [...this.sockets].filter(([, s]) => s.readyState === OPEN).map(([id]) => id);
  }

  onPeerJoin(h: (peerId: string) => void): Unsubscribe {
    this.joinL.add(h);
    return () => this.joinL.delete(h);
  }

  onPeerLeave(h: (peerId: string) => void): Unsubscribe {
    this.leaveL.add(h);
    return () => this.leaveL.delete(h);
  }

  channel(name: string): Channel {
    return {
      send: (data, to) => {
        const msg = encodeMessage(name, data);
        const targets = to === undefined ? this.peers() : Array.isArray(to) ? to : [to];
        for (const id of targets) {
          const s = this.sockets.get(id);
          if (s && s.readyState === OPEN) s.send(msg);
        }
      },
      onMessage: (h) => {
        let set = this.msgL.get(name);
        if (!set) this.msgL.set(name, (set = new Set()));
        set.add(h);
        return () => set.delete(h);
      },
    };
  }

  /** Wire a socket in as peer `id`. Call once the socket is open. */
  protected attach(id: string, socket: SocketLike): void {
    socket.binaryType = 'arraybuffer';
    this.sockets.set(id, socket);
    socket.addEventListener('message', (ev) => {
      const m = decodeMessage(ev.data);
      if (!m) return;
      for (const h of this.msgL.get(m.channel) ?? []) h(m.payload, id);
    });
    socket.addEventListener('close', () => {
      if (this.sockets.get(id) !== socket) return;
      this.sockets.delete(id);
      for (const h of this.leaveL) h(id);
    });
    for (const h of this.joinL) h(id);
  }

  abstract leave(): Promise<void>;
}

/** The CLI side. Each accepted socket becomes a peer named `tab-<n>`. */
export class WebSocketHubTransport extends BaseTransport {
  private n = 0;

  constructor() {
    super('hub');
  }

  /** Add an open socket (the server already checked Host and Origin). */
  addSocket(socket: SocketLike): string {
    const id = `tab-${++this.n}`;
    this.attach(id, socket);
    return id;
  }

  async leave(): Promise<void> {
    for (const s of this.sockets.values()) s.close(1001, 'board closed');
    this.sockets.clear();
  }
}

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

/**
 * The browser side. One peer, `hub`. Reconnects after the CLI restarts; YjsSync then exchanges state
 * vectors again, so nothing is lost in either direction.
 */
export class WebSocketClientTransport extends BaseTransport {
  private stopped = false;
  private retryMs = 250;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly statusL = new Set<(s: ConnectionStatus) => void>();
  status: ConnectionStatus = 'connecting';

  constructor(
    private readonly url: string,
    private readonly makeSocket: (url: string) => SocketLike = (u) => new WebSocket(u) as unknown as SocketLike,
  ) {
    super(`tab-${Math.random().toString(36).slice(2, 10)}`);
    this.connect();
  }

  onStatus(h: (s: ConnectionStatus) => void): Unsubscribe {
    this.statusL.add(h);
    return () => this.statusL.delete(h);
  }

  private setStatus(s: ConnectionStatus) {
    if (this.status === s) return;
    this.status = s;
    for (const h of this.statusL) h(s);
  }

  private connect() {
    if (this.stopped) return;
    const socket = this.makeSocket(this.url);
    let opened = false;
    socket.addEventListener('open', () => {
      opened = true;
      this.retryMs = 250;
      this.attach('hub', socket);
      this.setStatus('online');
    });
    socket.addEventListener('close', () => {
      if (this.stopped) return;
      this.setStatus('offline');
      this.timer = setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, opened ? 2000 : 4000);
    });
  }

  async leave(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    for (const s of this.sockets.values()) s.close(1000, 'bye');
    this.sockets.clear();
  }
}
