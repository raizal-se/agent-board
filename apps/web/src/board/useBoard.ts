import {
  boardMap,
  edgesMap,
  framesMap,
  isFileItem,
  itemsMap,
  layoutMap,
  type FileEdge,
  type Frame,
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

/** The board as plain values. Unchanged Yjs entries keep their object identity between versions. */
export function useBoardState(doc: Y.Doc): BoardState {
  const version = useDocVersion(doc);
  return useMemo(() => {
    void version;
    return {
      frames: [...framesMap(doc).values()].filter((f): f is Frame => !!f && typeof f.id === 'string'),
      items: [...itemsMap(doc).values()].filter(isFileItem),
      edges: [...edgesMap(doc).values()].filter((e): e is FileEdge => e?.source === 'file'),
      layout: new Map(layoutMap(doc).entries()),
      name: boardMap<string>(doc, 'meta').get('name'),
    };
  }, [doc, version]);
}
