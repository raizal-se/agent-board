import {
  agreementsMap,
  boardMap,
  edgesMap,
  framesMap,
  isComment,
  isDecision,
  isFileEdge,
  isFileItem,
  isHumanEdge,
  isSticky,
  isThread,
  itemsMap,
  layoutMap,
  type Agreement,
  type CommentItem,
  type DecisionItem,
  type Device,
  type FileEdge,
  type FileItem,
  type Frame,
  type HumanEdge,
  type StickyItem,
  type ThreadItem,
} from '@agent-board/model';
import { useMemo, useSyncExternalStore } from 'react';
import type * as Y from 'yjs';
import type { BoardState } from './derive';

/** A version number that changes on each doc update, for useSyncExternalStore. */
function useDocVersion(doc: Y.Doc): number {
  const store = useMemo(() => {
    let version = 0;
    return {
      subscribe(cb: () => void) {
        const on = () => {
          version++;
          cb();
        };
        doc.on('update', on);
        return () => doc.off('update', on);
      },
      get: () => version,
    };
  }, [doc]);
  return useSyncExternalStore(store.subscribe, store.get);
}

/** The whole board as plain values. Unchanged Yjs entries keep their object identity between versions. */
export function readBoard(doc: Y.Doc): Required<BoardState> {
  const items: FileItem[] = [];
  const stickies: StickyItem[] = [];
  const decisions: DecisionItem[] = [];
  const comments: CommentItem[] = [];
  const threads = new Map<string, ThreadItem>();
  for (const i of itemsMap(doc).values()) {
    if (isFileItem(i)) items.push(i);
    else if (isSticky(i)) stickies.push(i);
    else if (isDecision(i)) decisions.push(i);
    else if (isComment(i)) comments.push(i);
    else if (isThread(i)) threads.set(i.target, i);
  }
  const edges: FileEdge[] = [];
  const humanEdges: HumanEdge[] = [];
  for (const e of edgesMap(doc).values()) {
    if (isFileEdge(e)) edges.push(e);
    else if (isHumanEdge(e)) humanEdges.push(e);
  }
  const meta = boardMap<string>(doc, 'meta');
  return {
    frames: [...framesMap(doc).values()].filter((f): f is Frame => !!f && typeof f.id === 'string'),
    items,
    edges,
    layout: new Map(layoutMap(doc).entries()),
    name: meta.get('name') ?? '',
    owner: meta.get('owner') ?? '',
    stickies,
    decisions,
    comments,
    threads,
    humanEdges,
    agreements: new Map<string, Agreement>(agreementsMap(doc).entries()),
    devices: new Map(boardMap<Device>(doc, 'devices').entries()),
  };
}

export function useBoardState(doc: Y.Doc): Required<BoardState> {
  const version = useDocVersion(doc);
  return useMemo(() => {
    void version;
    return readBoard(doc);
  }, [doc, version]);
}
