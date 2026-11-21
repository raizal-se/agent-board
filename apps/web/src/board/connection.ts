import { createBoardDoc } from '@agent-board/model';
import { WebSocketClientTransport, YjsSync, type ConnectionStatus } from '@agent-board/sync';
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
  const transport = new WebSocketClientTransport(`${proto}//${location.host}/sync`);
  new YjsSync(doc, transport);
  return {
    doc,
    status: () => transport.status,
    onStatus: (h) => transport.onStatus(h),
  };
}
