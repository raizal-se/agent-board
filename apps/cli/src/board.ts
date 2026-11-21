import { existsSync, mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardMap, ensureBoardId, type Device } from '@agent-board/model';
import { BoardWriter } from './board-writer';
import type { Identity } from './config';
import { startServer, type BoardServer } from './server';
import { autoSave, DOC_FILE, loadDoc, STATE_DIR } from './store';
import { fileExists, watchFolder } from './watcher';

/** The built web app, next to this package in the monorepo. */
export const DEFAULT_WEB_DIR = fileURLToPath(new URL('../../web/dist', import.meta.url));

export interface BoardOptions {
  folder: string;
  identity: Identity;
  port: number;
  webDir?: string;
  poll?: boolean;
  renameWindowMs?: number;
  log?: (line: string) => void;
}

export interface RunningBoard {
  url: string;
  server: BoardServer;
  writer: BoardWriter;
  /** Resolves after the first scan of the folder. */
  ready: Promise<void>;
  stop(): Promise<void>;
}

/** `agent-board watch <folder>`: load the board, watch the folder, serve the page. */
export async function startBoard(opts: BoardOptions): Promise<RunningBoard> {
  const folder = resolve(opts.folder);
  const log = opts.log ?? (() => {});
  const webDir = opts.webDir ?? DEFAULT_WEB_DIR;
  if (!existsSync(folder)) throw new Error(`Folder not found: ${folder}`);
  if (!existsSync(join(webDir, 'index.html'))) {
    throw new Error(`The board page is not built (${webDir}). Run: pnpm --filter @agent-board/web build`);
  }
  mkdirSync(join(folder, STATE_DIR), { recursive: true });
  const docFile = join(folder, STATE_DIR, DOC_FILE);
  const doc = loadDoc(docFile);
  const saver = autoSave(doc, docFile);

  const { name, side } = opts.identity;
  doc.transact(() => {
    const meta = boardMap<string>(doc, 'meta');
    if (!meta.get('name')) meta.set('name', basename(folder));
    ensureBoardId(doc);
    const devices = boardMap<Device>(doc, 'devices');
    const prev = devices.get(name);
    if (!prev || prev.side !== side) devices.set(name, { id: name, name, side });
  });

  const writer = new BoardWriter(doc, {
    owner: name,
    rootName: basename(folder),
    exists: fileExists(folder),
    renameWindowMs: opts.renameWindowMs,
  });
  const watcher = watchFolder(writer, folder, { poll: opts.poll, log });
  let server: BoardServer;
  try {
    server = await startServer({ doc, port: opts.port, webDir, log });
  } catch (err) {
    await watcher.close();
    writer.dispose();
    saver.close();
    throw err;
  }

  return {
    url: server.url,
    server,
    writer,
    ready: watcher.ready,
    stop: async () => {
      await watcher.close();
      // Pending deletes stay undecided: if one was half of a rename, the next start still sees
      // the moved file and keeps its block. The first scan then marks the rest gone.
      writer.dispose();
      await server.close();
      saver.close();
      doc.destroy();
    },
  };
}
