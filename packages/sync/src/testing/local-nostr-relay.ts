/// <reference types="node" />
/**
 * A tiny in-process Nostr relay for tests (Node only). Enough of NIP-01 for Trystero's
 * Nostr strategy: REQ with {kinds, since, #x}, EVENT -> OK + fan-out to matching
 * subscriptions, CLOSE, EOSE. Ephemeral like the kinds Trystero uses (20000-29999):
 * nothing is stored. Signatures are not checked. Hand-rolled WebSocket (RFC 6455) so
 * no extra dependency is needed.
 */
import { createServer, type IncomingMessage } from 'node:http';
import { createHash } from 'node:crypto';
import type { Duplex } from 'node:stream';

interface Filter {
  kinds?: number[];
  since?: number;
  '#x'?: string[];
}
interface Event {
  id: string;
  kind: number;
  created_at: number;
  tags: string[][];
}
interface Conn {
  n: number;
  send(text: string): void;
  subs: Map<string, Filter[]>;
}

export interface LocalRelay {
  url: string;
  port: number;
  events: number;
  /** Last 5000 messages seen, for failure dumps: time, connection number, type, kind, #x topic. */
  trace: { t: number; conn: number; type: string; kind?: number; x?: string; matched?: number }[];
  close(): Promise<void>;
}

export async function startLocalNostrRelay(port = 0, host = '127.0.0.1'): Promise<LocalRelay> {
  const conns = new Set<Conn>();
  const sockets = new Set<Duplex>();
  const relay = { events: 0, trace: [] } as unknown as LocalRelay;
  let connCount = 0;
  const record = (e: LocalRelay['trace'][number]) => {
    relay.trace.push(e);
    if (relay.trace.length > 5000) relay.trace.splice(0, 1000);
  };

  const matches = (f: Filter, e: Event) =>
    (!f.kinds || f.kinds.includes(e.kind)) &&
    (f.since === undefined || e.created_at >= f.since) &&
    (!f['#x'] || e.tags.some((t) => t[0] === 'x' && f['#x']!.includes(t[1]!)));

  const onText = (conn: Conn, text: string) => {
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (!Array.isArray(msg)) return;
    const [type, a, ...rest] = msg as [string, any, ...any[]];
    if (process.env.RELAY_DEBUG) console.error("relay <-", text.slice(0, 160));
    if (type === 'REQ') {
      conn.subs.set(a, rest as Filter[]);
      for (const f of rest as Filter[]) record({ t: Date.now(), conn: conn.n, type: 'REQ', x: f['#x']?.map((x) => x.slice(0, 8)).join(',') });
      conn.send(JSON.stringify(['EOSE', a]));
    } else if (type === 'CLOSE') {
      conn.subs.delete(a);
      record({ t: Date.now(), conn: conn.n, type: 'CLOSE' });
    } else if (type === 'EVENT') {
      const ev = a as Event;
      relay.events++;
      conn.send(JSON.stringify(['OK', ev.id, true, '']));
      let matched = 0;
      for (const c of conns)
        for (const [subId, filters] of c.subs)
          if (filters.some((f) => matches(f, ev))) {
            matched++;
            c.send(JSON.stringify(['EVENT', subId, ev]));
          }
      const x = ev.tags.find((t) => t[0] === 'x')?.[1];
      record({ t: Date.now(), conn: conn.n, type: 'EVENT', kind: ev.kind, x: x?.slice(0, 8), matched });
    }
  };

  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('local nostr relay');
  });
  server.on('upgrade', (req: IncomingMessage, socket: Duplex) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) return socket.destroy();
    const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    sockets.add(socket);
    const conn: Conn = {
      n: ++connCount,
      subs: new Map(),
      send: (text) => {
        if (!socket.writable) return;
        socket.write(encodeFrame(0x1, Buffer.from(text)));
      },
    };
    conns.add(conn);
    let buf = Buffer.alloc(0);
    let fragments: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const f = decodeFrame(buf);
        if (!f) break;
        buf = buf.subarray(f.length);
        if (f.opcode === 0x8) {
          socket.end(encodeFrame(0x8, Buffer.alloc(0)));
          return;
        }
        if (f.opcode === 0x9) {
          socket.write(encodeFrame(0xa, f.payload));
          continue;
        }
        if (f.opcode === 0x1 || f.opcode === 0x0) {
          fragments.push(f.payload);
          if (f.fin) {
            onText(conn, Buffer.concat(fragments).toString('utf8'));
            fragments = [];
          }
        }
      }
    });
    record({ t: Date.now(), conn: conn.n, type: 'OPEN' });
    const drop = () => {
      if (conns.has(conn)) record({ t: Date.now(), conn: conn.n, type: 'GONE' });
      conns.delete(conn);
      sockets.delete(socket);
    };
    socket.on('close', drop);
    socket.on('error', drop);
  });

  await new Promise<void>((r) => server.listen(port, host, r));
  const addr = server.address();
  relay.port = typeof addr === 'object' && addr ? addr.port : port;
  relay.url = `ws://${host}:${relay.port}`;
  relay.close = () =>
    new Promise<void>((r) => {
      for (const s of sockets) s.destroy();
      server.close(() => r());
    });
  return relay;
}

function decodeFrame(buf: Buffer): { fin: boolean; opcode: number; payload: Buffer; length: number } | null {
  if (buf.length < 2) return null;
  const fin = (buf[0]! & 0x80) !== 0;
  const opcode = buf[0]! & 0x0f;
  const masked = (buf[1]! & 0x80) !== 0;
  let len = buf[1]! & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    off = 10;
  }
  const maskOff = off;
  if (masked) off += 4;
  if (buf.length < off + len) return null;
  const payload = Buffer.from(buf.subarray(off, off + len));
  if (masked) for (let i = 0; i < len; i++) payload[i]! ^= buf[maskOff + (i % 4)]!;
  return { fin, opcode, payload, length: off + len };
}

function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  const head = len < 126 ? Buffer.alloc(2) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = 0x80 | opcode;
  if (len < 126) head[1] = len;
  else if (len < 65536) {
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, payload]);
}

// Run standalone: `node packages/sync/src/testing/local-nostr-relay.ts [port]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await startLocalNostrRelay(Number(process.argv[2] ?? 7447), process.argv[3] ?? '127.0.0.1');
  console.log(`local nostr relay on ${r.url}`);
}
