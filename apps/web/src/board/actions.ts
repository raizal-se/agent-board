import { createBoardDoc, type FileItem, type Person, type Side } from '@agent-board/model';
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
  /** "✓ Agree" on a file block: one click. */
  agree(itemId: string): void;
  /** "✗ Reject" on a file block: asks for the reason. */
  reject(itemId: string): void;
  /** A person moves a file block to the Product or Engineering area. */
  switchArea(itemId: string, side: Side): void;
  /** A card measured its content: its height follows it (a layout id: a block's or a snapshot card's). */
  fitHeight(layoutId: string, h: number): void;
}

export const BoardActionsContext = createContext<BoardActions>({
  doc: createBoardDoc(),
  me: { name: 'me', side: 'product' },
  open: () => {},
  openThread: () => {},
  compare: () => {},
  selectEdge: () => {},
  agree: () => {},
  reject: () => {},
  switchArea: () => {},
  fitHeight: () => {},
});
export const useBoardActions = () => useContext(BoardActionsContext);
