import { createReadStream, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { boardIdOf } from '@agent-board/model';
import { CLOSE_OTHER_BOARD, WebSocketHubTransport, YjsSync, type SocketLike } from '@agent-board/sync';
import { WebSocketServer } from 'ws';
import type * as Y from 'yjs';

export const SYNC_PATH = '/sync';
const HOST = '127.0.0.1';

export interface BoardServerOptions {
  doc: Y.Doc;
  /** 0 picks a free port. */
  port: number;
  /** The built web app (apps/web/dist). */
  webDir: string;
  log?: (line: string) => void;
}

export interface BoardServer {
  url: string;
  port: number;
  /** Number of open browser tabs. */
  tabs(): number;
  close(): Promise<void>;
}

/** Text types: the build writes a .br and .gz copy of each of these (see apps/web/vite.config.ts). */
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.svg', '.json']);

/**
 * The encodings a request accepts, best first: brotli, then gzip. Anything with q=0 is refused.
 * `Accept-Encoding: *` counts as both.
 */
export function acceptedEncodings(header: string | string[] | undefined): ('br' | 'gzip')[] {
  const q = new Map<string, number>();
  for (const part of String(header ?? '').toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';').map((x) => x.trim());
    if (!name) continue;
    const qp = params.find((p) => p.startsWith('q='));
    const v = qp ? Number(qp.slice(2)) : 1;
    q.set(name, Number.isFinite(v) ? v : 0);
  }
  const ok = (e: string) => (q.get(e) ?? (q.has('*') ? q.get('*')! : 0)) > 0;
  return (['br', 'gzip'] as const).filter(ok);
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

/**
 * Only the board's own names for itself. Anything else is a DNS rebinding attempt: a page on
 * evil.example whose name resolves to 127.0.0.1 sends `Host: evil.example`.
 */
export function allowedHosts(port: number): Set<string> {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
}

/** A WebSocket must come from the board's own page, never from another site the user has open. */
export function allowedOrigins(port: number): Set<string> {
  return new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
}

/** Serves the board page and syncs the doc with each tab, on 127.0.0.1 only. */
export async function startServer(opts: BoardServerOptions): Promise<BoardServer> {
  const log = opts.log ?? (() => {});
  const webRoot = resolve(opts.webDir);
  const hub = new WebSocketHubTransport();
  const sync = new YjsSync(opts.doc, hub, { forward: true });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
  let port = opts.port;

  const hostOk = (req: IncomingMessage) => allowedHosts(port).has((req.headers.host ?? '').toLowerCase());

  const server = createServer((req, res) => {
    if (!hostOk(req)) return refuse(res, 421, 'Wrong host');
    if (req.method !== 'GET' && req.method !== 'HEAD') return refuse(res, 405, 'Method not allowed');
    serveStatic(webRoot, req, res);
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const origin = req.headers.origin ?? '';
    let reason = '';
    if (!hostOk(req)) reason = '421 Misdirected Request';
    else if (url.pathname !== SYNC_PATH) reason = '404 Not Found';
    else if (!allowedOrigins(port).has(origin)) reason = '403 Forbidden';
    if (reason) {
      log(`refused socket (${reason}) host=${req.headers.host ?? ''} origin=${origin || '-'}`);
      socket.end(`HTTP/1.1 ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      // A tab that already holds a board says which one. If it is not ours, it must not sync.
      const asked = url.searchParams.get('board');
      if (asked && asked !== boardIdOf(opts.doc)) {
        log('refused a tab that holds another board; it will reload');
        ws.close(CLOSE_OTHER_BOARD, 'another board');
        return;
      }
      const id = hub.addSocket(ws as unknown as SocketLike);
      log(`tab connected (${id})`);
      ws.on('close', () => log(`tab closed (${id})`));
    });
  });

  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(opts.port, HOST, () => {
      server.off('error', fail);
      ok();
    });
  });
  port = (server.address() as AddressInfo).port;

  return {
    url: `http://${HOST}:${port}`,
    port,
    tabs: () => hub.peers().length,
    close: async () => {
      sync.destroy();
      await hub.leave();
      wss.close();
      server.closeAllConnections();
      await new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}

function refuse(res: ServerResponse, code: number, text: string) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
  res.end(`${text}\n`);
}

function isPlainFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function serveStatic(root: string, req: IncomingMessage, res: ServerResponse) {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    return refuse(res, 400, 'Bad path');
  }
  const file = normalize(join(root, pathname));
  if (file !== root && !file.startsWith(root + sep)) return refuse(res, 403, 'Forbidden');
  let target = file;
  let isFile = false;
  try {
    isFile = statSync(target).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    // The board is one page: unknown paths without an extension get index.html.
    if (extname(pathname)) return refuse(res, 404, 'Not found');
    target = join(root, 'index.html');
  }
  const ext = extname(target);
  const type = TYPES[ext] ?? 'application/octet-stream';
  const headers: Record<string, string> = {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store',
  };
  // A copy compressed at build time, if the browser takes it; else the file as it is.
  let body = target;
  if (COMPRESSIBLE.has(ext)) {
    headers.Vary = 'Accept-Encoding';
    for (const enc of acceptedEncodings(req.headers['accept-encoding'])) {
      const copy = `${target}.${enc === 'br' ? 'br' : 'gz'}`;
      if (isPlainFile(copy)) {
        body = copy;
        headers['Content-Encoding'] = enc;
        break;
      }
    }
  }
  try {
    headers['Content-Length'] = String(statSync(body).size);
  } catch {
    return refuse(res, 404, 'Not found');
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  createReadStream(body)
    .on('error', () => res.destroy())
    .pipe(res);
}
