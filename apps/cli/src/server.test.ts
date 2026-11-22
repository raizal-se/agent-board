import { writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { brotliCompressSync, brotliDecompressSync, gzipSync, gunzipSync } from 'node:zlib';
import { createBoardDoc, ensureBoardId, fileItemOf, itemsMap, layoutMap } from '@agent-board/model';
import { afterEach, describe, expect, it } from 'vitest';
import { encodeMessage } from '@agent-board/sync';
import { WebSocket } from 'ws';
import { acceptedEncodings, startServer, type BoardServer } from './server';
import { connectTab, fakeWebDir, until } from './test-helpers';

const cleanup: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

async function server(webDir = fakeWebDir()) {
  const doc = createBoardDoc();
  const s = await startServer({ doc, port: 0, webDir });
  cleanup.push(() => s.close());
  return { doc, s };
}

function get(s: BoardServer, path: string, host: string): Promise<{ status: number; body: string }> {
  return new Promise((ok, fail) => {
    const req = request({ host: '127.0.0.1', port: s.port, path, headers: { Host: host } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => ok({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', fail);
    req.end();
  });
}

function raw(s: BoardServer, path: string, host: string, encoding?: string): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  return new Promise((ok, fail) => {
    const headers: Record<string, string> = { Host: host };
    if (encoding !== undefined) headers['Accept-Encoding'] = encoding;
    const req = request({ host: '127.0.0.1', port: s.port, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => ok({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', fail);
    req.end();
  });
}

/** Try a WebSocket upgrade; resolves with 'open' or the HTTP status of the refusal. */
function tryUpgrade(port: number, opts: { origin?: string; host?: string; path?: string }): Promise<string | number> {
  return new Promise((ok) => {
    const headers: Record<string, string> = {};
    if (opts.origin !== undefined) headers.Origin = opts.origin;
    if (opts.host !== undefined) headers.Host = opts.host;
    const ws = new WebSocket(`ws://127.0.0.1:${port}${opts.path ?? '/sync'}`, { headers });
    ws.on('open', () => {
      ws.close();
      ok('open');
    });
    ws.on('unexpected-response', (_req, res) => ok(res.statusCode ?? 0));
    ws.on('error', () => ok('error'));
  });
}

describe('board server', () => {
  it('listens on 127.0.0.1 only and serves the page', async () => {
    const { s } = await server();
    expect(s.url).toBe(`http://127.0.0.1:${s.port}`);
    const res = await get(s, '/', `127.0.0.1:${s.port}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('<title>board</title>');
    expect((await get(s, '/', `localhost:${s.port}`)).status).toBe(200);
    expect((await get(s, '/assets/app.js', `localhost:${s.port}`)).body).toContain('console.log');
    expect((await get(s, '/assets/missing.js', `localhost:${s.port}`)).status).toBe(404);
    expect((await get(s, '/../../etc/passwd', `localhost:${s.port}`)).body).not.toContain('root:');
  });

  it('serves the copy compressed at build time that the browser takes, with Vary; else the raw file', async () => {
    const dir = fakeWebDir();
    const js = `console.log(${JSON.stringify('x'.repeat(5000))})`;
    writeFileSync(join(dir, 'assets', 'big.js'), js);
    writeFileSync(join(dir, 'assets', 'big.js.br'), brotliCompressSync(js));
    writeFileSync(join(dir, 'assets', 'big.js.gz'), gzipSync(js));
    const { s } = await server(dir);
    const host = `127.0.0.1:${s.port}`;

    const br = await raw(s, '/assets/big.js', host, 'gzip, deflate, br');
    expect(br.headers['content-encoding']).toBe('br');
    expect(br.headers.vary).toBe('Accept-Encoding');
    expect(br.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(brotliDecompressSync(br.body).toString()).toBe(js);
    expect(Number(br.headers['content-length'])).toBe(br.body.length);
    expect(br.body.length).toBeLessThan(js.length / 10);

    const gz = await raw(s, '/assets/big.js', host, 'gzip');
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(gz.body).toString()).toBe(js);

    for (const enc of [undefined, 'identity', 'br;q=0, gzip;q=0']) {
      const plain = await raw(s, '/assets/big.js', host, enc);
      expect(plain.headers['content-encoding']).toBeUndefined();
      expect(plain.headers.vary).toBe('Accept-Encoding');
      expect(plain.body.toString()).toBe(js);
    }
    // No compressed copy (app.js): the raw file, whatever the browser takes.
    const none = await raw(s, '/assets/app.js', host, 'br, gzip');
    expect(none.headers['content-encoding']).toBeUndefined();
    expect(none.body.toString()).toBe('console.log(1)');
    // The Host check still holds for compressed assets.
    expect((await raw(s, '/assets/big.js', 'evil.example', 'br')).status).toBe(421);
  });

  it('reads Accept-Encoding with q values', () => {
    expect(acceptedEncodings('gzip, deflate, br, zstd')).toEqual(['br', 'gzip']);
    expect(acceptedEncodings('br;q=0, gzip;q=0.5')).toEqual(['gzip']);
    expect(acceptedEncodings('*')).toEqual(['br', 'gzip']);
    expect(acceptedEncodings('*, br;q=0')).toEqual(['gzip']);
    expect(acceptedEncodings(undefined)).toEqual([]);
    expect(acceptedEncodings('identity')).toEqual([]);
  });

  it('refuses HTTP requests with a foreign Host (DNS rebinding)', async () => {
    const { s } = await server();
    expect((await get(s, '/', 'evil.example')).status).toBe(421);
    expect((await get(s, '/', `evil.example:${s.port}`)).status).toBe(421);
    expect((await get(s, '/', '127.0.0.1:1')).status).toBe(421);
  });

  it('refuses WebSocket upgrades from another origin, with no origin, or a foreign Host', async () => {
    const { s } = await server();
    const own = `http://127.0.0.1:${s.port}`;
    expect(await tryUpgrade(s.port, { origin: own })).toBe('open');
    expect(await tryUpgrade(s.port, { origin: `http://localhost:${s.port}` })).toBe('open');
    expect(await tryUpgrade(s.port, { origin: 'https://evil.example' })).toBe(403);
    expect(await tryUpgrade(s.port, { origin: `http://127.0.0.1:${s.port + 1}` })).toBe(403);
    expect(await tryUpgrade(s.port, {})).toBe(403);
    expect(await tryUpgrade(s.port, { origin: 'null' })).toBe(403);
    expect(await tryUpgrade(s.port, { origin: own, host: `evil.example:${s.port}` })).toBe(421);
    expect(await tryUpgrade(s.port, { origin: own, path: '/other' })).toBe(404);
    expect(s.tabs()).toBe(0);
  });

  it('syncs both ways and between tabs over a real WebSocket', async () => {
    const { doc, s } = await server();
    itemsMap(doc).set('f_1', { id: 'f_1', kind: 'file', path: 'a.md', frame: 'frame:x', type: 'markdown', text: 'v1', hash: '', owner: 'me', gone: false, updatedAt: 0 });
    const t1 = connectTab(s.port);
    const t2 = connectTab(s.port);
    cleanup.push(() => t1.close(), () => t2.close());

    await until(() => fileItemOf(t1.doc, 'f_1')?.text === 'v1', 3000, 'initial state');
    const item = fileItemOf(doc, 'f_1')!;
    itemsMap(doc).set('f_1', { ...item, text: 'v2' });
    await until(() => fileItemOf(t1.doc, 'f_1')?.text === 'v2', 3000, 'live change');

    layoutMap(t1.doc).set('f_1', { x: 10, y: 20 });
    await until(() => layoutMap(doc).get('f_1')?.x === 10, 3000, 'tab to CLI');
    await until(() => layoutMap(t2.doc).get('f_1')?.y === 20, 3000, 'tab to tab, forwarded by the CLI');
    expect(s.tabs()).toBe(2);
  });

  it('a tab reconnects after the CLI restarts and keeps syncing', async () => {
    const doc = createBoardDoc();
    const webDir = fakeWebDir();
    const s1 = await startServer({ doc, port: 0, webDir });
    const port = s1.port;
    const t = connectTab(port);
    cleanup.push(() => t.close());
    await until(() => t.transport.status === 'online', 3000, 'online');
    await s1.close();
    await until(() => t.transport.status === 'offline', 3000, 'offline');
    layoutMap(t.doc).set('x', { x: 1, y: 2 }); // made while the CLI is down
    const s2 = await startServer({ doc, port, webDir });
    cleanup.push(() => s2.close());
    await until(() => layoutMap(doc).get('x')?.x === 1, 5000, 'offline change reaches the CLI');
  });

  it('refuses a tab that holds another board, so it cannot write that board into this one', async () => {
    const webDir = fakeWebDir();
    const a = createBoardDoc();
    ensureBoardId(a);
    itemsMap(a).set('f_a', { id: 'f_a', kind: 'file', path: 'a.md', frame: 'frame:x', type: 'markdown', text: 'A', hash: '', owner: 'me', gone: false, updatedAt: 0 });
    const s1 = await startServer({ doc: a, port: 0, webDir });
    const port = s1.port;
    const t = connectTab(port);
    cleanup.push(() => t.close());
    await until(() => itemsMap(t.doc).has('f_a'), 3000, 'board A in the tab');
    await s1.close();

    // The CLI starts again on the same port, with another board.
    const b = createBoardDoc();
    ensureBoardId(b);
    const s2 = await startServer({ doc: b, port, webDir });
    cleanup.push(() => s2.close());
    await until(() => t.transport.status === 'other-board', 5000, 'tab told it holds another board');
    expect(itemsMap(b).has('f_a')).toBe(false);
    expect(s2.tabs()).toBe(0);

    // A fresh tab (the page after its reload) syncs normally.
    const fresh = connectTab(port);
    cleanup.push(() => fresh.close());
    await until(() => fresh.transport.status === 'online', 3000, 'fresh tab online');
    expect(itemsMap(b).has('f_a')).toBe(false);
  });

  it('a malformed update from a tab is dropped and the CLI keeps serving', async () => {
    const { doc, s } = await server();
    const raw = new WebSocket(`ws://127.0.0.1:${s.port}/sync`, { headers: { Origin: `http://127.0.0.1:${s.port}` } });
    cleanup.push(() => raw.close());
    await new Promise((ok) => raw.once('open', ok));
    // Channel 'y', message type 1 (a Yjs update), then bytes that are not an update.
    raw.send(encodeMessage('y', new Uint8Array([1, 255, 255, 255, 255, 255, 1, 2, 3])));
    const t = connectTab(s.port);
    cleanup.push(() => t.close());
    itemsMap(doc).set('f_1', { id: 'f_1', kind: 'file', path: 'a.md', frame: 'frame:x', type: 'markdown', text: 'ok', hash: '', owner: 'me', gone: false, updatedAt: 0 });
    await until(() => fileItemOf(t.doc, 'f_1')?.text === 'ok', 3000, 'still syncing');
  });
});
