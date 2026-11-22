import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { boardIdOf, ensureBoardId } from '@agent-board/model';
import { appUrlOf, normalizeName, parseInvite, type DeviceKey } from '@agent-board/sync/peer';
import { CONFIG_FILE, resolveIdentity, type Identity } from './config';
import { linkOf, loadNetwork, loadOrCreateDevice, newShare, saveNetwork, type NetworkConfig } from './network';
import { DOC_FILE, loadDoc, saveDoc, STATE_DIR } from './store';

/** `agent-board setup`: save the name and side, and make this device's key. */
export function setupIdentity(flags: { name?: string; side?: string }, configFile = CONFIG_FILE, device?: () => DeviceKey): Identity {
  const raw = resolveIdentity(flags, configFile);
  const name = normalizeName(raw.name);
  if (!name) throw new Error('Give a name: agent-board setup --name <name> --side <product|engineering>');
  mkdirSync(dirname(configFile), { recursive: true });
  writeFileSync(configFile, `${JSON.stringify({ name, side: raw.side }, null, 2)}\n`);
  (device ?? loadOrCreateDevice)();
  return { name, side: raw.side };
}

/** The board id of a folder's saved board, if it has one. */
export function folderBoardId(folder: string): string | undefined {
  const file = join(folder, STATE_DIR, DOC_FILE);
  if (!existsSync(file)) return undefined;
  const doc = loadDoc(file);
  const id = boardIdOf(doc);
  doc.destroy();
  return id;
}

/**
 * `agent-board invite <folder>`: share the board of this folder. The first time it makes the
 * room secret (this device is the creator); after that it prints the same link. A running
 * `watch` picks up the share within 2 s.
 */
export function inviteFolder(folder: string, opts: { appUrl?: string; device?: () => DeviceKey }): { link: string; cfg: NetworkConfig; isNew: boolean } {
  const known = loadNetwork(folder);
  if (known) {
    const cfg = opts.appUrl && opts.appUrl !== known.appUrl ? { ...known, appUrl: opts.appUrl } : known;
    if (cfg !== known) saveNetwork(folder, cfg);
    return { link: linkOf(cfg), cfg, isNew: false };
  }
  if (!opts.appUrl) throw new Error('The invite link needs the address of the web app: agent-board invite <folder> --app-url <URL>');
  if (!existsSync(folder)) throw new Error(`Folder not found: ${folder}`);
  const file = join(folder, STATE_DIR, DOC_FILE);
  let boardId = folderBoardId(folder);
  if (!boardId) {
    const doc = loadDoc(file);
    boardId = ensureBoardId(doc);
    saveDoc(doc, file);
    doc.destroy();
  }
  const cfg = newShare(boardId, (opts.device ?? loadOrCreateDevice)(), opts.appUrl);
  saveNetwork(folder, cfg);
  return { link: linkOf(cfg), cfg, isNew: true };
}

/** `agent-board join <invite> <folder>`: remember the invite for this folder. `watch` then asks to join. */
export function joinFolder(invite: string, folder: string, opts: { appUrl?: string } = {}): NetworkConfig {
  const inv = parseInvite(invite);
  if (!inv) throw new Error('This is not an agent-board invite link.');
  const appUrl = opts.appUrl ?? (invite.includes('#') ? appUrlOf(invite.trim()) : '');
  if (!/^https?:\/\//.test(appUrl)) throw new Error('Give the full invite link (it starts with http), or add --app-url <URL>.');
  const other = folderBoardId(folder);
  if (other && other !== inv.boardId) {
    throw new Error(`${folder} already holds another board. Join into a new folder (or one of the same feature).`);
  }
  const known = loadNetwork(folder);
  if (known && known.boardId !== inv.boardId) throw new Error(`${folder} is shared as another board. Use a new folder.`);
  mkdirSync(folder, { recursive: true });
  const cfg: NetworkConfig = { ...inv, appUrl };
  saveNetwork(folder, cfg);
  return cfg;
}
