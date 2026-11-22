import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIdOf, boardMap, ensureBoardId, type Device } from '@agent-board/model';
import { devicePk, type DeviceKey } from '@agent-board/sync/peer';
import type * as Y from 'yjs';
import { BoardWriter } from './board-writer';
import type { Identity } from './config';
import {
  forgetNetwork,
  linkOf,
  loadNetwork,
  loadOrCreateDevice,
  newShare,
  saveNetwork,
  startNetwork,
  writerSeal,
  type BoardNetwork,
  type NetworkConfig,
} from './network';
import { startServer, type BoardServer } from './server';
import { autoExport, autoSave, autoSettle, DOC_FILE, writeExport, EXPORT_FILE, loadDoc, STATE_DIR, type AutoSave } from './store';
import { autoImport } from './milestones';
import { fileExists, watchFolder } from './watcher';

/** The built web app, next to this package in the monorepo (AGENT_BOARD_WEB_DIR for tests). */
export const DEFAULT_WEB_DIR = process.env.AGENT_BOARD_WEB_DIR || fileURLToPath(new URL('../../web/dist', import.meta.url));

export interface BoardOptions {
  folder: string;
  identity: Identity;
  port: number;
  webDir?: string;
  poll?: boolean;
  renameWindowMs?: number;
  log?: (line: string) => void;
  /** This device's key. Default: ~/.agent-board/device.json, made when the board is first shared. */
  device?: DeviceKey;
  /** Where the web app is served, for invite links made from the page. */
  appUrl?: string;
  /** Nostr relays (tests). Default: AGENT_BOARD_RELAYS, then Trystero's public list. */
  relayUrls?: string[];
  /** Look for a network.json written by `agent-board invite` while the board runs. Default 2000 ms; 0 is off. */
  shareCheckMs?: number;
  /** The guest's check of the board failed: the CLI forgot it. */
  onRejected?: () => void;
}

export interface RunningBoard {
  url: string;
  /** The board, as the CLI holds it. */
  doc: Y.Doc;
  server: BoardServer;
  writer: BoardWriter;
  /** Resolves after the first scan of the folder. */
  ready: Promise<void>;
  /** The peer of a shared board, once it runs. */
  network(): BoardNetwork | undefined;
  /** Share this board: a new invite link (this device is the creator). Returns the link. */
  share(appUrl?: string): Promise<string>;
  stop(): Promise<void>;
}

/** `agent-board watch <folder>`: load the board, watch the folder, serve the page, and join the room of a shared board. */
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
  let cfg = loadNetwork(folder);
  let device = opts.device ?? (cfg ? loadOrCreateDevice() : undefined);
  const joined = !!cfg && !!device && cfg.root !== devicePk(device);
  if (cfg && boardIdOf(doc) && boardIdOf(doc) !== cfg.boardId) {
    saver.close();
    throw new Error(`This folder holds another board (${boardIdOf(doc)}), not the shared board ${cfg.boardId}.`);
  }
  doc.transact(() => {
    const meta = boardMap<string>(doc, 'meta');
    if (joined) {
      // A joined CLI takes the board's id, name and layout from the others.
      if (!meta.get('id')) meta.set('id', cfg!.boardId);
    } else {
      if (!meta.get('name')) meta.set('name', basename(folder));
      ensureBoardId(doc);
    }
    // The person at this board: the page uses it as the author of what it makes. On a shared board
    // each person has their own: the page gets it from the CLI (the `ctl` channel) instead.
    if (!cfg && meta.get('owner') !== name) meta.set('owner', name);
    const devices = boardMap<Device>(doc, 'devices');
    const prev = devices.get(name);
    if (!prev || prev.side !== side) devices.set(name, { id: name, name, side });
  });

  let net: BoardNetwork | undefined;
  let starting: Promise<void> | undefined;
  const sealer = () => (net && device ? writerSeal(doc, device) : undefined);
  const writer = new BoardWriter(doc, {
    owner: name,
    side,
    rootName: basename(folder),
    exists: fileExists(folder),
    renameWindowMs: opts.renameWindowMs,
    seal: (item) => sealer()?.seal(item) ?? item,
    retired: (id) => sealer()?.retired(id),
  });
  // The layout settle runs on one device only: the board's creator (or the only CLI of a solo board).
  const settler: AutoSave | undefined = joined ? undefined : autoSettle(doc);
  const online = () => (net ? [name, ...net.state().online.map((o) => o.name)] : undefined);
  const exportFile = join(folder, STATE_DIR, EXPORT_FILE);
  const exporter = autoExport(doc, exportFile, 300, online);
  const watcher = watchFolder(writer, folder, { poll: opts.poll, log });
  const importer = autoImport(doc, watcher.ready, { log });

  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((l) => l());
  let lastOnline = '';
  let netOff: (() => void) | undefined;

  const startNet = async (c: NetworkConfig) => {
    device ??= loadOrCreateDevice();
    net = await startNetwork({
      doc,
      folder,
      cfg: c,
      device,
      identity: opts.identity,
      log,
      relayUrls: opts.relayUrls,
      onRejected: () => {
        forgetNetwork(folder);
        opts.onRejected?.();
      },
    });
    netOff = net.peer.onChange(() => {
      const names = online()?.join('|') ?? '';
      if (names !== lastOnline) {
        lastOnline = names;
        writeExport(doc, exportFile, online); // board.json says who is online
      }
      changed();
    });
    // Seal the writes made before the network: every own item gets this device's signature.
    changed();
  };

  const startShared = (c: NetworkConfig) => {
    starting ??= startNet(c).catch((err: Error) => {
      starting = undefined;
      net = undefined;
      log(`Could not start sharing: ${err.message}`);
    });
    return starting;
  };

  let server: BoardServer;
  try {
    server = await startServer({
      doc,
      port: opts.port,
      webDir,
      log,
      session: {
        snapshot: () => {
          const s = net?.state();
          return {
            kind: 'hub',
            me: { name, side },
            boardName: String(boardMap<string>(doc, 'meta').get('name') ?? basename(folder)),
            shared: !!cfg,
            appUrl: cfg?.appUrl ?? opts.appUrl ?? null,
            link: cfg && s?.member ? linkOf(cfg) : null,
            peer: s ?? null,
          };
        },
        onChange: (h) => {
          listeners.add(h);
          return () => listeners.delete(h);
        },
        command: (c) => onCommand(c as Command),
      },
    });
  } catch (err) {
    await watcher.close();
    importer.close();
    writer.dispose();
    settler?.close();
    exporter.close();
    saver.close();
    throw err;
  }

  type Command = { cmd?: string; pk?: unknown; cursor?: unknown; appUrl?: unknown };
  const onCommand = (c: Command) => {
    const p = net?.peer;
    // A pointer moves often and changes nothing in the snapshot: no new snapshot for it.
    if (c.cmd === 'cursor') return void p?.setCursor(c.cursor ?? null);
    if (c.cmd === 'approve' && typeof c.pk === 'string') p?.approve(c.pk);
    else if (c.cmd === 'deny' && typeof c.pk === 'string') p?.deny(c.pk);
    else if (c.cmd === 'revoke' && typeof c.pk === 'string') p?.revoke(c.pk);
    else if (c.cmd === 'share') void share(typeof c.appUrl === 'string' ? c.appUrl : undefined).catch((e: Error) => log(e.message));
    changed();
  };

  const share = async (appUrl?: string): Promise<string> => {
    if (!cfg) {
      const url = appUrl ?? opts.appUrl;
      if (!url) throw new Error('Sharing needs the address of the web app: agent-board invite <folder> --app-url <URL>');
      device ??= loadOrCreateDevice();
      cfg = newShare(ensureBoardId(doc), device, url);
      saveNetwork(folder, cfg);
    }
    await startShared(cfg);
    changed();
    return linkOf(cfg);
  };

  if (cfg) void startShared(cfg);
  // `agent-board invite` in another terminal writes network.json: pick it up.
  const shareCheck =
    (opts.shareCheckMs ?? 2000) > 0
      ? setInterval(() => {
          if (net || starting) return;
          const c = loadNetwork(folder);
          if (c) {
            cfg = c;
            void startShared(c);
          }
        }, opts.shareCheckMs ?? 2000)
      : undefined;
  shareCheck?.unref?.();

  return {
    url: server.url,
    doc,
    server,
    writer,
    ready: watcher.ready,
    network: () => net,
    share,
    stop: async () => {
      clearInterval(shareCheck);
      await watcher.close();
      importer.close();
      // Pending deletes stay undecided: if one was half of a rename, the next start still sees
      // the moved file and keeps its block. The first scan then marks the rest gone.
      writer.dispose();
      await starting;
      netOff?.();
      await net?.stop();
      await server.close();
      settler?.close();
      exporter.close();
      saver.close();
      doc.destroy();
    },
  };
}

/** Forget a board this folder joined: its copy and its invite. The files stay. */
export function forgetJoinedBoard(folder: string) {
  forgetNetwork(folder);
  rmSync(join(folder, STATE_DIR, DOC_FILE), { force: true });
}
