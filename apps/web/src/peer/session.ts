import type { Person } from '@agent-board/model';
import type { PeerState } from '@agent-board/sync/peer';

/**
 * The page's view of a shared board. Two sources give the same view: the CLI that serves the
 * page (hub mode, on the `ctl` channel), or the browser's own peer (peer mode).
 */
export interface SessionView {
  mode: 'hub' | 'peer';
  /** Who acts on this page. Null until the CLI said it. */
  me: Person | null;
  boardName: string;
  /** Is the board shared (an invite exists)? */
  shared: boolean;
  /** The invite link. Only an approved device gets it. */
  link: string | null;
  /** Where the web app is served (for an invite made from the page). */
  appUrl: string | null;
  /** The peer of this page or of the CLI. Null on a board that is not shared. */
  peer: PeerState | null;
}

export interface Session {
  view(): SessionView;
  onChange(h: () => void): () => void;
  approve(pk: string): void;
  deny(pk: string): void;
  revoke(pk: string): void;
  /** Where this person's pointer is on the canvas (scene coordinates), or null. */
  setCursor(c: { x: number; y: number } | null): void;
}

export const EMPTY_VIEW: SessionView = { mode: 'hub', me: null, boardName: '', shared: false, link: null, appUrl: null, peer: null };

/** A cursor as other pages send it. */
export function cursorOf(v: unknown): { x: number; y: number } | null {
  if (!v || typeof v !== 'object') return null;
  const { x, y } = v as { x?: unknown; y?: unknown };
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}
