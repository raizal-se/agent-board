import { fromB64url, toB64url } from './device';

/**
 * The invitation link: `<app URL>/#<board id>.<secret>.<creator key>`.
 *
 * - Everything after `#` stays in the browser: it is never sent to the server that serves the app,
 *   so a static host or its logs never see the secret.
 * - `secret` (32 random bytes) is the room password: it hides the room from everyone else on the
 *   public relays and encrypts the WebRTC handshake.
 * - `creator key` is the board creator's device key. The guest checks the approved list it gets
 *   against it: a person who only has the link cannot pass off a board of their own as this one.
 */
export interface Invite {
  boardId: string;
  secret: string;
  /** The creator's device key, hex. */
  root: string;
}

const BOARD_ID = /^[A-Za-z0-9-]{8,64}$/;

export function inviteFragment(inv: Invite): string {
  return `${inv.boardId}.${inv.secret}.${toB64url(hexToBytes(inv.root))}`;
}

/** The full link. `appUrl` is where the web app is served (the CLI's `--app-url`). */
export function inviteUrl(appUrl: string, inv: Invite): string {
  const base = appUrl.replace(/#.*$/, '').replace(/\/?$/, '/');
  return `${base}#${inviteFragment(inv)}`;
}

/** Read an invite from a link, a fragment or `agent-board://join/...`. Null when it is not one. */
export function parseInvite(text: string): Invite | null {
  const raw = text.trim();
  const hash = raw.includes('#') ? raw.slice(raw.indexOf('#') + 1) : raw;
  const parts = hash.split('.');
  if (parts.length !== 3) return null;
  const [boardId, secret, rootB64] = parts as [string, string, string];
  if (!BOARD_ID.test(boardId)) return null;
  const s = fromB64url(secret);
  const r = fromB64url(rootB64);
  if (!s || s.length < 16 || !r || r.length !== 32) return null;
  return { boardId, secret, root: bytesToHex(r) };
}

/** The app URL part of a link (what comes before `#`). */
export function appUrlOf(link: string): string {
  return link.replace(/#.*$/, '');
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
