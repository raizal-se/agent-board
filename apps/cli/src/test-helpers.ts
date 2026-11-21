import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { boardIdOf, createBoardDoc, itemsMap, type FileItem } from '@agent-board/model';
import { boardSocketUrl, WebSocketClientTransport, YjsSync, type SocketLike } from '@agent-board/sync';
import { WebSocket } from 'ws';
import type * as Y from 'yjs';

export function tempDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

/** A stand-in for apps/web/dist, so server tests do not need a build. */
export function fakeWebDir(): string {
  const dir = tempDir('ab-web-');
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>board</title>');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
  return dir;
}

export function write(root: string, path: string, text: string) {
  const abs = join(root, ...path.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

/** Poll until `check` returns a truthy value. */
export async function until<T>(check: () => T, timeoutMs = 5000, what = 'condition'): Promise<NonNullable<T>> {
  const start = Date.now();
  for (;;) {
    const v = check();
    if (v) return v as NonNullable<T>;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

export function itemAt(doc: Y.Doc, path: string): FileItem | undefined {
  return [...itemsMap(doc).values()].find((i) => i.path === path);
}

/** A browser tab stand-in: a doc synced with the board over a real WebSocket. */
export function connectTab(port: number, origin = `http://127.0.0.1:${port}`) {
  const doc = createBoardDoc();
  // Same URL rule as the page (apps/web/src/board/connection.ts).
  const transport = new WebSocketClientTransport(
    () => boardSocketUrl(`ws://127.0.0.1:${port}/sync`, boardIdOf(doc)),
    (url) => new WebSocket(url, { headers: { Origin: origin } }) as unknown as SocketLike,
  );
  const sync = new YjsSync(doc, transport);
  return {
    doc,
    transport,
    close: async () => {
      sync.destroy();
      await transport.leave();
      doc.destroy();
    },
  };
}
