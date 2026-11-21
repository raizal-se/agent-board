import { boardIdOf, createBoardDoc } from '@agent-board/model';
import { boardSocketUrl, WebSocketClientTransport, YjsSync, type ConnectionStatus } from '@agent-board/sync';
import type * as Y from 'yjs';

export interface BoardConnection {
  doc: Y.Doc;
  status(): ConnectionStatus;
  onStatus(h: (s: ConnectionStatus) => void): () => void;
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
  };
}
