import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createBoardDoc, exportBoard, settleAreas, settleFrames } from '@agent-board/model';
import * as Y from 'yjs';

/** Where the CLI keeps the board for a watched folder. The watcher ignores this folder. */
export const STATE_DIR = '.agent-board';
export const DOC_FILE = 'board.ydoc';
/** The board as JSON for agents (docs/agents.md). Written by the CLI, read by agents. */
export const EXPORT_FILE = 'board.json';

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

/** Write to a temp file, then rename: a crash or a reader never sees half a file. */
function writeAtomic(file: string, data: string | Uint8Array): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

export function saveDoc(doc: Y.Doc, file: string): void {
  writeAtomic(file, Y.encodeStateAsUpdate(doc));
}

export function writeExport(doc: Y.Doc, file: string): void {
  writeAtomic(file, `${JSON.stringify(exportBoard(doc), null, 2)}\n`);
}

export interface AutoSave {
  /** Write now if anything changed. */
  flush(): void;
  close(): void;
}

/** Save the doc to disk shortly after each change. The CLI is the source of truth. */
export function autoSave(doc: Y.Doc, file: string, delayMs = 150): AutoSave {
  return afterChanges(doc, delayMs, () => saveDoc(doc, file));
}

/**
 * Write the JSON export about 300 ms after the last of a burst of changes (a long burst still
 * writes at least once a second), and once now, so it is there from the start.
 */
export function autoExport(doc: Y.Doc, file: string, delayMs = 300): AutoSave {
  writeExport(doc, file);
  return afterChanges(doc, delayMs, () => writeExport(doc, file), 1000);
}

/**
 * Keep the areas at the size they grew to (and give a snapshot card with no place one), and keep
 * frames from overlapping: settle them now (a board saved with narrower frames can overlap on
 * load) and shortly after each burst of changes (a frame grows as items are added or moved). The
 * moved positions go into the doc, so they are saved and reach the page.
 */
export function autoSettle(doc: Y.Doc, delayMs = 100): AutoSave {
  const settle = () => {
    settleAreas(doc);
    settleFrames(doc);
  };
  settle();
  return afterChanges(doc, delayMs, settle);
}

/** Run `write` `delayMs` after the last change; with `maxWaitMs`, no later than that after the first. */
function afterChanges(doc: Y.Doc, delayMs: number, write: () => void, maxWaitMs?: number): AutoSave {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let first = 0;
  let dirty = false;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!dirty) return;
    dirty = false;
    write();
  };
  const onUpdate = () => {
    const now = Date.now();
    if (!dirty) first = now;
    dirty = true;
    if (maxWaitMs === undefined) {
      if (!timer) timer = setTimeout(flush, delayMs);
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(flush, Math.max(0, Math.min(delayMs, first + maxWaitMs - now)));
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
