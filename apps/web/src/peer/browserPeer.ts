import { createBoardDoc, settleAgreements, type Side } from '@agent-board/model';
import { RemoteOrigin, type ConnectionStatus } from '@agent-board/sync';
import type { Invite } from '@agent-board/sync/peer';
import * as Y from 'yjs';
import type { BoardConnection } from '../board/connection';
import { idbDel, idbGet, idbSet } from './idb';
import type { Session, SessionView } from './session';

const LAST = 'agent-board:last';

/** The invite this browser used last, so the app URL alone opens the board again. */
export function lastInvite(): { invite: string; appUrl: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST) ?? 'null') as { invite?: unknown; appUrl?: unknown } | null;
    return v && typeof v.invite === 'string' && typeof v.appUrl === 'string' ? { invite: v.invite, appUrl: v.appUrl } : null;
  } catch {
    return null;
  }
}

export interface Me {
  name: string;
  side: Side;
}

/** The name and side this browser used on a board. */
export const savedMe = (boardId: string) => idbGet<Me>(`me:${boardId}`);

/** Is this device on the board's approved list, in the copy this browser keeps? Then it rejoins with no prompt. */
export async function knownMember(boardId: string): Promise<boolean> {
  const [mod, device, saved] = await Promise.all([import('@agent-board/sync/peer'), idbGet<unknown>('device'), idbGet<Uint8Array>(`board:${boardId}`)]);
  if (!device || !saved) return false;
  const doc = createBoardDoc();
  Y.applyUpdate(doc, saved);
  const pk = mod.devicePk(mod.deviceFromJson(device));
  const list = new mod.MemberList(doc, () => mod.rootOf(doc));
  const ok = list.approved(pk);
  doc.destroy();
  return ok;
}

export interface PeerConnection extends BoardConnection {
  session: Session;
  stop(): Promise<void>;
}

/**
 * The browser as a full peer of a shared board: its own copy in IndexedDB, synced with whoever is
 * online over WebRTC (Trystero, public Nostr relays). It works on when the host's CLI is offline.
 */
export async function connectPeer(o: { invite: Invite; appUrl: string; me: Me; relayUrls?: string[] }): Promise<PeerConnection> {
  const mod = await import('@agent-board/sync/peer');
  const { invite, appUrl, me } = o;
  const key = `board:${invite.boardId}`;

  let deviceJson = await idbGet<unknown>('device');
  let device;
  try {
    device = deviceJson ? mod.deviceFromJson(deviceJson) : undefined;
  } catch {
    device = undefined;
  }
  if (!device) {
    device = mod.newDeviceKey();
    deviceJson = mod.deviceToJson(device);
    await idbSet('device', deviceJson);
  }

  const doc = createBoardDoc();
  const saved = await idbGet<Uint8Array>(key);
  if (saved) {
    const copy = createBoardDoc();
    Y.applyUpdate(copy, saved);
    // A copy of another board (or of a board under another root) is not used.
    const id = copy.getMap('meta').get('id');
    if ((!id || id === invite.boardId) && (!mod.rootOf(copy) || mod.rootOf(copy) === invite.root)) Y.applyUpdate(doc, saved);
    copy.destroy();
  }
  await idbSet(`me:${invite.boardId}`, me);
  const link = mod.inviteUrl(appUrl, invite);
  localStorage.setItem(LAST, JSON.stringify({ invite: link, appUrl }));

  // Keep the copy: shortly after each burst of changes.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejected = false;
  const save = () => {
    timer = undefined;
    if (!rejected) void idbSet(key, Y.encodeStateAsUpdate(doc));
  };
  const onUpdate = (_u: Uint8Array, origin: unknown) => {
    timer ??= setTimeout(save, 300);
    // Two people who each accepted on their own device: the block is agreed once both accepts are here.
    if (origin instanceof RemoteOrigin) settleAgreements(doc, Date.now());
  };
  doc.on('update', onUpdate);
  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      save();
    }
  };
  window.addEventListener('pagehide', flush);

  const peer = new mod.BoardPeer({
    doc,
    device,
    me: { name: me.name, side: me.side, kind: 'browser' },
    root: invite.root,
    connect: () => mod.joinBoardRoom({ secret: invite.secret, relayUrls: o.relayUrls }),
    onRejected: () => {
      rejected = true;
      void idbDel(key);
      if (lastInvite()?.invite === link) localStorage.removeItem(LAST);
    },
  });

  const listeners = new Set<(s: ConnectionStatus) => void>();
  let status: ConnectionStatus = 'connecting';
  const setStatus = () => {
    const s = peer.state();
    const next: ConnectionStatus = s.linked ? 'online' : s.join.step === 'looking' ? 'connecting' : 'offline';
    if (next !== status) {
      status = next;
      listeners.forEach((l) => l(status));
    }
  };

  let view: SessionView | null = null;
  const viewOf = (): SessionView => {
    const s = peer.state();
    return {
      mode: 'peer',
      me,
      boardName: String(doc.getMap('meta').get('name') ?? ''),
      shared: true,
      link: s.member ? link : null,
      appUrl,
      peer: s,
    };
  };
  const changeListeners = new Set<() => void>();
  peer.onChange(() => {
    view = null;
    setStatus();
    changeListeners.forEach((l) => l());
  });
  // The board name can arrive after the peer state.
  doc.getMap('meta').observe(() => {
    view = null;
    changeListeners.forEach((l) => l());
  });

  let cursorTimer: ReturnType<typeof setTimeout> | undefined;
  let nextCursor: { x: number; y: number } | null = null;

  await peer.start();
  (window as unknown as { __peer?: unknown }).__peer = { peer, doc, pk: mod.devicePk(device) };

  return {
    doc,
    status: () => status,
    onStatus: (h) => {
      listeners.add(h);
      return () => listeners.delete(h);
    },
    session: {
      view: () => (view ??= viewOf()),
      onChange: (h) => {
        changeListeners.add(h);
        return () => changeListeners.delete(h);
      },
      approve: (pk) => peer.approve(pk),
      deny: (pk) => peer.deny(pk),
      revoke: (pk) => peer.revoke(pk),
      setCursor: (c) => {
        nextCursor = c;
        cursorTimer ??= setTimeout(() => {
          cursorTimer = undefined;
          peer.setCursor(nextCursor);
        }, 60);
      },
    },
    stop: async () => {
      flush();
      doc.off('update', onUpdate);
      window.removeEventListener('pagehide', flush);
      await peer.stop();
      peer.destroy();
    },
  };
}
