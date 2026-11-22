import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { boardIdOf, fileItems, settleAgreements, type FileItem } from '@agent-board/model';
import { RemoteOrigin } from '@agent-board/sync';
import {
  BoardPeer,
  checkItem,
  devicePk,
  deviceFromJson,
  deviceToJson,
  inviteUrl,
  joinBoardRoom,
  makeRoot,
  newDeviceKey,
  newSecret,
  rootOf,
  signItem,
  signRetired,
  retiredMap,
  type DeviceKey,
  type Invite,
  type PeerState,
} from '@agent-board/sync/peer';
import { trysteroCompatibleRtc } from '@agent-board/sync/node-rtc';
import type * as Y from 'yjs';
import { CONFIG_DIR, type Identity } from './config';
import { STATE_DIR } from './store';

/** This device's key: made once by `setup` (or the first share), readable by the user only. */
export const DEVICE_FILE = join(CONFIG_DIR, 'device.json');
/** The shared-board settings of a folder: the invite parts and the app URL. */
export const NETWORK_FILE = 'network.json';

export interface NetworkConfig extends Invite {
  /** Where the web app is served; the invite link starts with it. */
  appUrl: string;
}

export function loadDevice(file = DEVICE_FILE): DeviceKey | undefined {
  try {
    return deviceFromJson(JSON.parse(readFileSync(file, 'utf8')));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(`Cannot read the device key in ${file}: ${(err as Error).message}`);
  }
}

export function loadOrCreateDevice(file = DEVICE_FILE): DeviceKey {
  const known = loadDevice(file);
  if (known) return known;
  const device = newDeviceKey();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(deviceToJson(device), null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return device;
}

export function networkFile(folder: string) {
  return join(folder, STATE_DIR, NETWORK_FILE);
}

export function loadNetwork(folder: string): NetworkConfig | undefined {
  try {
    const v = JSON.parse(readFileSync(networkFile(folder), 'utf8')) as NetworkConfig;
    if (typeof v.secret === 'string' && typeof v.root === 'string' && typeof v.boardId === 'string' && typeof v.appUrl === 'string') return v;
  } catch {
    // not shared
  }
  return undefined;
}

export function saveNetwork(folder: string, cfg: NetworkConfig) {
  mkdirSync(join(folder, STATE_DIR), { recursive: true });
  writeFileSync(networkFile(folder), `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
}

export function forgetNetwork(folder: string) {
  rmSync(networkFile(folder), { force: true });
}

export const linkOf = (cfg: NetworkConfig) => inviteUrl(cfg.appUrl, cfg);

/** A new share of a board this device made: a fresh secret, this device as the creator. */
export function newShare(boardId: string, device: DeviceKey, appUrl: string): NetworkConfig {
  return { boardId, secret: newSecret(), root: devicePk(device), appUrl };
}

function rtcPolyfill(): typeof RTCPeerConnection {
  const req = createRequire(import.meta.url);
  const { RTCPeerConnection } = req('node-datachannel/polyfill') as { RTCPeerConnection: typeof globalThis.RTCPeerConnection };
  return trysteroCompatibleRtc(RTCPeerConnection);
}

/** Relays for tests and private setups: `AGENT_BOARD_RELAYS=ws://127.0.0.1:7000,...`. Default: Trystero's public list. */
export function relayUrlsFromEnv(): string[] | undefined {
  const v = process.env.AGENT_BOARD_RELAYS?.split(',').map((s) => s.trim()).filter(Boolean);
  return v?.length ? v : undefined;
}

export interface NetworkOptions {
  doc: Y.Doc;
  folder: string;
  cfg: NetworkConfig;
  device: DeviceKey;
  identity: Identity;
  log?: (line: string) => void;
  relayUrls?: string[];
  /** The guest's check failed: the CLI forgets the board. */
  onRejected?: () => void;
}

export interface BoardNetwork {
  peer: BoardPeer;
  link: string;
  /** The board's creator device runs the layout settle; the others do not. */
  isCreator: boolean;
  state(): PeerState;
  stop(): Promise<void>;
}

/** Sign this owner's file items that have no good signature yet (a board made before it was shared). */
export function sealOwnItems(doc: Y.Doc, device: DeviceKey, owner: string, check: (f: FileItem) => boolean | undefined) {
  const pk = devicePk(device);
  doc.transact(() => {
    for (const f of fileItems(doc)) {
      if (f.owner !== owner) continue;
      if (f.device === pk && check(f) === true) continue;
      if (f.device && f.device !== pk) continue; // another device of this person owns it
      doc.getMap('items').set(f.id, signItem(doc, device, f));
    }
  });
}

/** Start the peer for a shared folder. The creator's device also makes itself the root. */
export async function startNetwork(o: NetworkOptions): Promise<BoardNetwork> {
  const log = o.log ?? (() => {});
  const pk = devicePk(o.device);
  const isCreator = o.cfg.root === pk;
  const me = { name: o.identity.name, side: o.identity.side, kind: 'cli' as const };
  if (isCreator) {
    if (boardIdOf(o.doc) !== o.cfg.boardId) throw new Error(`This folder holds board ${boardIdOf(o.doc)}, not ${o.cfg.boardId}`);
    const known = rootOf(o.doc);
    if (known && known !== pk) throw new Error('This board was shared from another device.');
    o.doc.transact(() => {
      sealOwnItems(o.doc, o.device, me.name, () => undefined);
      makeRoot(o.doc, o.device, me);
    });
  }
  const polyfill = rtcPolyfill();
  const relayUrls = o.relayUrls ?? relayUrlsFromEnv();
  const peer = new BoardPeer({
    doc: o.doc,
    device: o.device,
    me,
    root: o.cfg.root,
    connect: () => joinBoardRoom({ secret: o.cfg.secret, relayUrls, rtcPolyfill: polyfill }),
    onRejected: () => {
      log('This invitation did not lead to the board it names. The CLI left it.');
      o.onRejected?.();
    },
  });
  // Seal own items once this device is on the list (a joined CLI wrote them before approval).
  const sealIfMember = () => {
    if (peer.member) sealOwnItems(o.doc, o.device, me.name, (f) => checkItem(o.doc, peer.list, f));
  };
  const offList = peer.list.onChange(sealIfMember);
  sealIfMember();
  // Two people who each accepted on their own device: the block is agreed once both accepts are here.
  const onUpdate = (_u: Uint8Array, origin: unknown) => {
    if (origin instanceof RemoteOrigin) settleAgreements(o.doc, Date.now());
  };
  o.doc.on('update', onUpdate);
  let lastStep = '';
  const offPeer = peer.onChange(() => {
    const s = peer.state();
    if (s.join.step !== lastStep) {
      lastStep = s.join.step;
      if (s.join.step === 'waiting') log(`Waiting for ${s.join.by.join(' or ')} to let you in.`);
      if (s.join.step === 'denied') log(`${s.join.by} said no.`);
      if (s.join.step === 'in' && !isCreator) log("You're in.");
    }
  });
  await peer.start();
  return {
    peer,
    link: linkOf(o.cfg),
    isCreator,
    state: () => peer.state(),
    stop: async () => {
      offList();
      offPeer();
      o.doc.off('update', onUpdate);
      await peer.stop();
      peer.destroy();
    },
  };
}

/** The writer's hooks on a shared board: sign each item; sign the note when a block goes for good. */
export function writerSeal(doc: Y.Doc, device: DeviceKey) {
  return {
    seal: (item: FileItem) => signItem(doc, device, item),
    retired: (id: string) => {
      const f = fileItems(doc).find((i) => i.id === id);
      if (f) retiredMap(doc).set(id, signRetired(doc, device, id, f.owner));
    },
  };
}

export function hasBoardDoc(folder: string, docFile: string): boolean {
  return existsSync(join(folder, STATE_DIR, docFile));
}
