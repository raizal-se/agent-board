import { createHash } from 'node:crypto';
import { fileTypeOf, parseFileLinks } from '@agent-board/formats';
import {
  frameId,
  frameNameForPath,
  framesMap,
  itemsMap,
  layoutMap,
  newItemId,
  nextFrameSpot,
  nextItemSpot,
  resolveEdgesTo,
  syncFileEdges,
  type FileItem,
} from '@agent-board/model';
import type * as Y from 'yjs';

export type UpsertResult = 'new' | 'changed' | 'same' | 'renamed' | 'back' | 'skipped';

export interface BoardWriterOptions {
  /** Owner name stored on each item. */
  owner: string;
  /** Frame name for files at the root of the watched folder. */
  rootName: string;
  /** Does a file still exist at this path (relative to the root)? Used for rename detection. */
  exists: (path: string) => boolean;
  /** An unlink then an add with the same content within this window is a rename. Default 1000 ms. */
  renameWindowMs?: number;
  now?: () => number;
}

export function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Turns file events into board changes. Knows nothing about chokidar, so tests drive it directly.
 *
 * - Block identity: a random id plus `path`; `index` maps path to id for this owner.
 * - Delete: the block is marked gone after the rename window (if no rename claims it first).
 *   Its layout and edges stay; when the file comes back at the same path, so does the block.
 * - Rename: a new path whose content hash equals a block whose file just went away (an unlink
 *   in the window, or a file that no longer exists on disk) takes over that block.
 */
export class BoardWriter {
  private readonly index = new Map<string, string>();
  private readonly pendingGone = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(
    private readonly doc: Y.Doc,
    private readonly opts: BoardWriterOptions,
  ) {
    this.windowMs = opts.renameWindowMs ?? 1000;
    this.now = opts.now ?? Date.now;
    for (const item of itemsMap(doc).values()) {
      if (item.kind === 'file' && item.owner === opts.owner) this.index.set(item.path, item.id);
    }
  }

  idOf(path: string): string | undefined {
    return this.index.get(path);
  }

  /** A file was added or changed. */
  upsert(path: string, text: string): UpsertResult {
    const type = fileTypeOf(path);
    if (!type) return 'skipped';
    const hash = contentHash(text);
    const items = itemsMap(this.doc);
    let result: UpsertResult;

    this.doc.transact(() => {
      const known = this.index.get(path);
      const prev = known ? items.get(known) : undefined;
      if (known && prev) {
        this.cancelGone(known);
        if (prev.hash === hash && !prev.gone) {
          result = 'same';
        } else {
          result = prev.gone ? 'back' : 'changed';
          items.set(known, { ...prev, text, hash, type, gone: false, updatedAt: this.now() });
        }
        this.syncEdges(known, path, text);
        return;
      }

      const renamedFrom = this.findRenameSource(hash, path);
      if (renamedFrom) {
        this.cancelGone(renamedFrom.id);
        this.index.delete(renamedFrom.path);
        this.index.set(path, renamedFrom.id);
        const frame = this.ensureFrame(path);
        if (frame !== renamedFrom.frame) layoutMap(this.doc).set(renamedFrom.id, nextItemSpot(this.doc, frame, renamedFrom.id));
        items.set(renamedFrom.id, { ...renamedFrom, path, frame, type, text, hash, gone: false, updatedAt: this.now() });
        resolveEdgesTo(this.doc, path, renamedFrom.id);
        this.syncEdges(renamedFrom.id, path, text);
        result = 'renamed';
        return;
      }

      const id = newItemId();
      const frame = this.ensureFrame(path);
      layoutMap(this.doc).set(id, nextItemSpot(this.doc, frame));
      items.set(id, { id, kind: 'file', path, frame, type, text, hash, owner: this.opts.owner, gone: false, updatedAt: this.now() });
      this.index.set(path, id);
      resolveEdgesTo(this.doc, path, id);
      this.syncEdges(id, path, text);
      result = 'new';
    });
    return result!;
  }

  /** A file was deleted. The block hides after the rename window unless a rename claims it. */
  unlink(path: string): void {
    const id = this.index.get(path);
    if (!id || this.pendingGone.has(id)) return;
    const item = itemsMap(this.doc).get(id);
    if (!item || item.gone) return;
    this.pendingGone.set(
      id,
      setTimeout(() => {
        this.pendingGone.delete(id);
        this.markGone(id);
      }, this.windowMs),
    );
  }

  /**
   * After the first scan: every block of this owner whose file is not on disk is gone. This covers
   * files deleted while the CLI was not running.
   */
  reconcile(present: ReadonlySet<string>): string[] {
    const goneNow: string[] = [];
    this.doc.transact(() => {
      for (const [path, id] of this.index) {
        if (present.has(path) || this.pendingGone.has(id)) continue;
        if (this.markGone(id)) goneNow.push(path);
      }
    });
    return goneNow;
  }

  /** Mark every pending delete as gone now (used on shutdown and in tests). */
  flushPending(): void {
    for (const [id, t] of this.pendingGone) {
      clearTimeout(t);
      this.markGone(id);
    }
    this.pendingGone.clear();
  }

  dispose(): void {
    for (const t of this.pendingGone.values()) clearTimeout(t);
    this.pendingGone.clear();
  }

  private markGone(id: string): boolean {
    const items = itemsMap(this.doc);
    const item = items.get(id);
    if (!item || item.gone) return false;
    items.set(id, { ...item, gone: true, updatedAt: this.now() });
    return true;
  }

  private cancelGone(id: string) {
    const t = this.pendingGone.get(id);
    if (t !== undefined) {
      clearTimeout(t);
      this.pendingGone.delete(id);
    }
  }

  private findRenameSource(hash: string, newPath: string): FileItem | undefined {
    const items = itemsMap(this.doc);
    for (const [path, id] of this.index) {
      if (path === newPath) continue;
      const item = items.get(id);
      if (!item || item.hash !== hash) continue;
      if (this.pendingGone.has(id)) return item;
      if (!item.gone && !this.opts.exists(path)) return item;
    }
    return undefined;
  }

  private ensureFrame(path: string): string {
    const name = frameNameForPath(path, this.opts.rootName);
    const id = frameId(name);
    const frames = framesMap(this.doc);
    if (!frames.has(id)) {
      layoutMap(this.doc).set(id, nextFrameSpot(this.doc));
      frames.set(id, { id, name });
    }
    return id;
  }

  private syncEdges(id: string, path: string, text: string) {
    syncFileEdges(this.doc, id, parseFileLinks(path, text), (p) => this.index.get(p) ?? null);
  }
}
