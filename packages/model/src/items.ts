import type * as Y from 'yjs';
import type { Side } from './index';

export type FileType = 'markdown' | 'html';

/**
 * A file block (design 4.1). The id is stable and random: a rename changes `path`, never `id`.
 * Only the owner's CLI writes it.
 */
export interface FileItem {
  id: string;
  kind: 'file';
  /** Path relative to the watched folder root, with `/` separators. */
  path: string;
  /** Frame id (see `frameId`). */
  frame: string;
  type: FileType;
  /** Full file text, written on each save. */
  text: string;
  /** SHA-256 of `text`, hex. Used to detect renames. */
  hash: string;
  /** Name of the person whose CLI owns the file. */
  owner: string;
  /** The file was deleted. The block is hidden; its edges and layout stay. */
  gone: boolean;
  /** Last write by the CLI, ms since epoch. */
  updatedAt: number;
}

/** A feature frame. Each first-level subfolder is one; files at the root go to a frame named after the folder. */
export interface Frame {
  id: string;
  name: string;
}

/** One person's device. In this slice: one entry per owner name. */
export interface Device {
  id: string;
  name: string;
  side: Side;
}

export function frameId(name: string): string {
  return `frame:${name}`;
}

/** Frame name for a file path: its first folder, or `rootName` for files at the root. */
export function frameNameForPath(path: string, rootName: string): string {
  const slash = path.indexOf('/');
  return slash === -1 ? rootName : path.slice(0, slash);
}

export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function newItemId(): string {
  return `f_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function itemsMap(doc: Y.Doc): Y.Map<FileItem> {
  return doc.getMap<FileItem>('items');
}

export function framesMap(doc: Y.Doc): Y.Map<Frame> {
  return doc.getMap<Frame>('frames');
}

export function isFileItem(v: unknown): v is FileItem {
  return !!v && typeof v === 'object' && (v as FileItem).kind === 'file';
}
