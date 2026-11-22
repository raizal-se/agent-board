import { createHash } from 'node:crypto';
import { fileTypeOf, parseFileArea, parseFileLinks } from '@agent-board/formats';
import {
  estimateCardH,
  fileItemOf,
  frameId,
  frameNameForPath,
  framesMap,
  itemsMap,
  layoutMap,
  newItemId,
  nextFrameSpot,
  boardPlaced,
  nextItemSpot,
  overrideHolds,
  resolveArea,
  resolveEdgesTo,
  sidesMap,
  syncFileEdges,
  isFileItem,
  type FileItem,
  type Side,
} from '@agent-board/model';
import type * as Y from 'yjs';

export type UpsertResult = 'new' | 'changed' | 'same' | 'renamed' | 'back' | 'skipped';

export interface BoardWriterOptions {
  /** Owner name stored on each item. */
  owner: string;
  /** The owner's side: a block whose file says no `area` goes in that side's area. Default product. */
  side?: Side;
  /** Frame name for files at the root of the watched folder. */
  rootName: string;
  /** Does a file still exist at this path (relative to the root)? Used for rename detection. */
  exists: (path: string) => boolean;
  /** An unlink then an add with the same content within this window is a rename. Default 1000 ms. */
  renameWindowMs?: number;
  now?: () => number;
  /**
   * On a shared board: sign each file item as this device before it goes on the board, and sign
   * the note that a block was removed for good. Without them the items are not signed (solo board).
   */
  seal?: (item: FileItem) => FileItem;
  retired?: (id: string) => void;
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
  private readonly side: Side;

  constructor(
    private readonly doc: Y.Doc,
    private readonly opts: BoardWriterOptions,
  ) {
    this.windowMs = opts.renameWindowMs ?? 1000;
    this.now = opts.now ?? Date.now;
    this.side = opts.side ?? 'product';
    for (const item of itemsMap(doc).values()) {
      if (isFileItem(item) && item.owner === opts.owner) this.index.set(item.path, item.id);
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
    const area = parseFileArea(path, text);
    let result: UpsertResult;

    this.doc.transact(() => {
      let known = this.index.get(path);
      let prev = known ? fileItemOf(this.doc, known) : undefined;
      // A file moved onto the path of a deleted file is that moved file's block, not the old one:
      // the old block leaves the board, and the moved block takes its path and incoming links.
      if (known && prev?.gone && this.findRenameSource(hash, path)) {
        this.retire(known, path);
        known = undefined;
        prev = undefined;
      }
      if (known && prev) {
        this.cancelGone(known);
        if (prev.hash === hash && !prev.gone) {
          result = 'same';
        } else {
          result = prev.gone ? 'back' : 'changed';
          const next: FileItem = { ...prev, text, hash, type, area, gone: false, updatedAt: this.now() };
          this.followArea(prev, next);
          this.put(next);
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
        const next: FileItem = { ...renamedFrom, path, frame, type, text, hash, area, gone: false, updatedAt: this.now() };
        if (frame !== renamedFrom.frame) {
          // Another frame: a person's switch was about the old place; the file decides here.
          sidesMap(this.doc).delete(renamedFrom.id);
          this.placeIn(next);
        } else {
          this.followArea(renamedFrom, next);
        }
        this.put(next);
        resolveEdgesTo(this.doc, path, renamedFrom.id, this.mine);
        this.syncEdges(renamedFrom.id, path, text);
        result = 'renamed';
        return;
      }

      const id = newItemId();
      const frame = this.ensureFrame(path);
      const item: FileItem = { id, kind: 'file', path, frame, type, text, hash, area, owner: this.opts.owner, gone: false, updatedAt: this.now() };
      this.placeIn(item);
      this.put(item);
      this.index.set(path, id);
      resolveEdgesTo(this.doc, path, id, this.mine);
      this.syncEdges(id, path, text);
      result = 'new';
    });
    return result!;
  }

  /** A file was deleted. The block hides after the rename window unless a rename claims it. */
  unlink(path: string): void {
    const id = this.index.get(path);
    if (!id || this.pendingGone.has(id)) return;
    const item = fileItemOf(this.doc, id);
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

  dispose(): void {
    for (const t of this.pendingGone.values()) clearTimeout(t);
    this.pendingGone.clear();
  }

  /** Links resolve only from this owner's files: other people have their own folders with the same paths. */
  private readonly mine = (fromId: string) => fileItemOf(this.doc, fromId)?.owner === this.opts.owner;

  private put(item: FileItem) {
    itemsMap(this.doc).set(item.id, this.opts.seal ? this.opts.seal(item) : item);
  }

  /** Remove a gone block for good: its item, its place and the edges its file declared. */
  private retire(id: string, path: string) {
    syncFileEdges(this.doc, id, []);
    this.opts.retired?.(id);
    itemsMap(this.doc).delete(id);
    layoutMap(this.doc).delete(id);
    this.index.delete(path);
  }

  /**
   * A block's place, once: a free spot in its area. After that only a person moves it, unless its
   * area changes.
   */
  private placeIn(item: FileItem) {
    const where = resolveArea(item, this.side, sidesMap(this.doc).get(item.id));
    const l = layoutMap(this.doc).get(item.id);
    const spot = nextItemSpot(this.doc, item.frame, { area: where.area, exceptId: item.id, w: l?.w, h: l?.h ?? estimateCardH(item.type, item.text) });
    layoutMap(this.doc).set(item.id, boardPlaced(l, spot));
  }

  /**
   * The last statement wins: a save whose `area` differs from before clears a person's switch, and
   * the block moves to a free spot in its new area if that changed. The same `area` keeps the switch.
   */
  private followArea(prev: FileItem, next: FileItem) {
    if ((prev.area ?? null) === (next.area ?? null)) return;
    const sides = sidesMap(this.doc);
    const ov = sides.get(prev.id);
    const before = resolveArea(prev, this.side, ov).area;
    if (ov && !overrideHolds(next, ov)) sides.delete(prev.id);
    const after = resolveArea(next, this.side, sides.get(prev.id)).area;
    if (before !== after) this.placeIn(next);
  }

  private markGone(id: string): boolean {
    const item = fileItemOf(this.doc, id);
    if (!item || item.gone) return false;
    this.put({ ...item, gone: true, updatedAt: this.now() });
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
    for (const [path, id] of this.index) {
      if (path === newPath) continue;
      const item = fileItemOf(this.doc, id);
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
