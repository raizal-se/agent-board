import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createBoardDoc } from '@agent-board/model';
import * as Y from 'yjs';

/** Where the CLI keeps the board for a watched folder. The watcher ignores this folder. */
export const STATE_DIR = '.agent-board';
export const DOC_FILE = 'board.ydoc';

/** Load the saved doc, or a new empty board. */
export function loadDoc(file: string): Y.Doc {
  const doc = createBoardDoc();
  let bytes: Uint8Array | undefined;
  try {
    bytes = readFileSync(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  if (bytes && bytes.length > 0) Y.applyUpdate(doc, bytes);
  return doc;
}

export function saveDoc(doc: Y.Doc, file: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, Y.encodeStateAsUpdate(doc));
  renameSync(tmp, file); // atomic: a crash never leaves half a file
}

export interface AutoSave {
  /** Write now if anything changed. */
  flush(): void;
  close(): void;
}

/** Save the doc to disk shortly after each change. The CLI is the source of truth. */
export function autoSave(doc: Y.Doc, file: string, delayMs = 150): AutoSave {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!dirty) return;
    dirty = false;
    saveDoc(doc, file);
  };
  const onUpdate = () => {
    dirty = true;
    if (!timer) timer = setTimeout(flush, delayMs);
  };
  doc.on('update', onUpdate);
  return {
    flush,
    close: () => {
      doc.off('update', onUpdate);
      flush();
    },
  };
}
