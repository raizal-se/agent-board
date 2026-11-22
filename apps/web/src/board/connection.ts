import { boardIdOf, createBoardDoc } from '@agent-board/model';
import { boardSocketUrl, WebSocketClientTransport, YjsSync, type ConnectionStatus } from '@agent-board/sync';
import type * as Y from 'yjs';
import { EMPTY_VIEW, type Session, type SessionView } from '../peer/session';

export interface BoardConnection {
  doc: Y.Doc;
  status(): ConnectionStatus;
  onStatus(h: (s: ConnectionStatus) => void): () => void;
  /** People, requests and the invite of a shared board. */
  session?: Session;
}

/**
 * The page's copy of the board, synced with the CLI that served it. The CLI keeps the board on
 * disk, so the page keeps no copy of its own.
 */
export function connectBoard(): BoardConnection {
  const doc = createBoardDoc();
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Once the tab knows its board, every reconnect names it: the CLI refuses a tab that holds
  // another board (it restarted on another folder, or the board was reset), and the tab reloads
  // instead of writing the old board into the new one.
  const transport = new WebSocketClientTransport(() => boardSocketUrl(`${proto}//${location.host}/sync`, boardIdOf(doc)));
  transport.onStatus((s) => {
    if (s === 'other-board') location.reload();
  });
  new YjsSync(doc, transport);
  return {
    doc,
    status: () => transport.status,
    onStatus: (h) => transport.onStatus(h),
    session: hubSession(transport),
  };
}

/** The CLI's view of the shared board, on the `ctl` channel (apps/cli/src/server.ts). */
function hubSession(transport: WebSocketClientTransport): Session {
  const ctl = transport.channel('ctl');
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let view: SessionView = EMPTY_VIEW;
  const listeners = new Set<() => void>();
  ctl.onMessage((data) => {
    try {
      const v = JSON.parse(dec.decode(data)) as Partial<SessionView>;
      view = { ...EMPTY_VIEW, ...v, mode: 'hub' };
      listeners.forEach((l) => l());
    } catch {
      // not JSON: ignore
    }
  });
  const send = (cmd: object) => {
    if (transport.peers().length) ctl.send(enc.encode(JSON.stringify(cmd)));
  };
  let cursorTimer: ReturnType<typeof setTimeout> | undefined;
  let nextCursor: { x: number; y: number } | null = null;
  return {
    view: () => view,
    onChange: (h) => {
      listeners.add(h);
      return () => listeners.delete(h);
    },
    approve: (pk) => send({ cmd: 'approve', pk }),
    deny: (pk) => send({ cmd: 'deny', pk }),
    revoke: (pk) => send({ cmd: 'revoke', pk }),
    setCursor: (cursor) => {
      nextCursor = cursor;
      cursorTimer ??= setTimeout(() => {
        cursorTimer = undefined;
        send({ cmd: 'cursor', cursor: nextCursor });
      }, 60);
    },
  };
}
