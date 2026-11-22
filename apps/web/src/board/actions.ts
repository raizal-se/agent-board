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
  /** Can this person change the card (its area)? On a shared board only its owner can. Default: yes. */
  canChange?(item: FileItem): boolean;
  /** A card measured its content: its height follows it (a layout id: a block's or a snapshot card's). */
  fitHeight(layoutId: string, h: number): void;
  /** Select a thing on the board and bring it into view ("from snapshot"). */
  show(id: string): void;
  /** "✓ Agree" on a story. */
  agreeStory(storyId: string): void;
  /** "✗ Reject" on a story: asks for the reason. */
  rejectStory(storyId: string): void;
  /** Edit a story's fields. */
  editStory(storyId: string): void;
  /** Pick the cards a story covers. */
  pickCovers(storyId: string): void;
  /** "+ story" in a milestone. */
  addStory(milestoneId: string): void;
  /** "+ story" in an empty Milestone area: makes Milestone 1 and a story in it. */
  startMilestone(frameId: string): void;
  editMilestone(milestoneId: string): void;
  /** Import a milestone file block: the first time, or its new entries. */
  importMilestone(fileId: string): void;
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
  show: () => {},
  agreeStory: () => {},
  rejectStory: () => {},
  editStory: () => {},
  pickCovers: () => {},
  addStory: () => {},
  startMilestone: () => {},
  editMilestone: () => {},
  importMilestone: () => {},
});
export const useBoardActions = () => useContext(BoardActionsContext);
