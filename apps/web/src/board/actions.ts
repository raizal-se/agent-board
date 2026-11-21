import type { FileItem } from '@agent-board/model';
import { createContext, useContext } from 'react';

/** Actions a block can call. Kept in context so node data stays plain. */
export interface BoardActions {
  open(item: FileItem): void;
}

export const BoardActionsContext = createContext<BoardActions>({ open: () => {} });
export const useBoardActions = () => useContext(BoardActionsContext);
