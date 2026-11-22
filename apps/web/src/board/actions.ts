import { createBoardDoc, type FileItem, type Person } from '@agent-board/model';
import { createContext, useContext } from 'react';
import type * as Y from 'yjs';

/** What nodes and edges can do. Kept in context so node data stays plain. */
export interface BoardActions {
  doc: Y.Doc;
  /** Who acts in this tab: the person running the CLI. */
  me: Person;
  open(item: FileItem): void;
  /** Open the comment thread on an item. */
  openThread(target: string): void;
  /** Open "compare" for an agreed file block. */
  compare(itemId: string): void;
  /** Select an edge someone drew, to edit its label or delete it. */
  selectEdge(id: string): void;
}

export const BoardActionsContext = createContext<BoardActions>({
  doc: createBoardDoc(),
  me: { name: 'me', side: 'product' },
  open: () => {},
  openThread: () => {},
  compare: () => {},
  selectEdge: () => {},
});
export const useBoardActions = () => useContext(BoardActionsContext);
