// Device keys: each CLI and each browser makes its own ed25519 key pair once and keeps it. The
// key proves the device on each new link (the hello), signs the approval of other devices, and
// signs the owner's file items.

import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export interface DeviceKey {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

export const HELLO = 'agent-board/hello/v1';
export const NAME_MAX = 40;
const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;

export function newDeviceKey(): DeviceKey {
  const { secretKey, publicKey } = ed25519.keygen();
  return { secretKey, publicKey };
}

/** The device key as hex, the form the board stores. */
export function devicePk(device: DeviceKey): string {
  return bytesToHex(device.publicKey);
}

export function isDevicePk(v: unknown): v is string {
  return typeof v === 'string' && HEX64.test(v);
}

/** Save and load a device key (the CLI keeps it in a file only the user can read). */
export function deviceToJson(device: DeviceKey): { publicKey: string; secretKey: string } {
  return { publicKey: bytesToHex(device.publicKey), secretKey: bytesToHex(device.secretKey) };
}

export function deviceFromJson(v: unknown): DeviceKey {
  const o = v as { publicKey?: unknown; secretKey?: unknown };
  if (typeof o?.secretKey !== 'string' || !HEX64.test(o.secretKey)) throw new Error('bad device key');
  const secretKey = hexToBytes(o.secretKey);
  const publicKey = ed25519.getPublicKey(secretKey);
  if (typeof o.publicKey === 'string' && o.publicKey !== bytesToHex(publicKey)) throw new Error('device key does not match');
  return { secretKey, publicKey };
}

/**
 * A short fingerprint of a device key, as people compare it: 8 hex digits in two groups
 * ("3f9a 0c41"). It is for a person's eye, next to the name; it is not a check.
 */
export function fingerprint(pkHex: string): string {
  const h = bytesToHex(sha256(utf8ToBytes(`agent-board/fingerprint/v1:${pkHex}`)));
  return `${h.slice(0, 4)} ${h.slice(4, 8)}`;
}

/**
 * A person's name as the board shows it: Unicode NFC, no control or format characters, spaces
 * collapsed, at most 40 characters. Empty when nothing is left. Two requests that look the same to
 * a person then have the same name.
 */
export function normalizeName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const clean = raw
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return [...clean].slice(0, NAME_MAX).join('').trim();
}

export function newNonce(): string {
  return bytesToHex(randomBytes(16));
}

/** Length-prefixed concatenation: no two lists of parts give the same bytes. */
export function lvCat(...parts: Uint8Array[]): Uint8Array {
  const out: Uint8Array[] = [];
  for (const p of parts) {
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, p.length);
    out.push(len, p);
  }
  return concatBytes(...out);
}

/**
 * The hello on a new link. Each side sends `{ pk, nonce }`; each side then signs the other side's
 * nonce, its own key and the link binding (the two DTLS fingerprints of this WebRTC link, sorted).
 * A device that someone in the middle relays has other fingerprints on each half, so its proof
 * fails. Approval is a separate step: the caller checks the proven key against the approved list.
 */
export function helloProof(device: DeviceKey, peerNonce: string, binding: string): string {
  return bytesToHex(ed25519.sign(helloMessage(hexToBytes(peerNonce), device.publicKey, binding), device.secretKey));
}

export function checkHelloProof(pkHex: string, myNonce: string, binding: string, sigHex: string): boolean {
  try {
    if (!HEX64.test(pkHex) || !HEX128.test(sigHex)) return false;
    const pk = hexToBytes(pkHex);
    return ed25519.verify(hexToBytes(sigHex), helloMessage(hexToBytes(myNonce), pk, binding), pk);
  } catch {
    return false;
  }
}

function helloMessage(nonce: Uint8Array, pk: Uint8Array, binding: string): Uint8Array {
  return lvCat(utf8ToBytes(HELLO), nonce, pk, utf8ToBytes(binding));
}

/** Sign a value for the board under a label (domain separation): hex signature. */
export function signFor(device: DeviceKey, label: string, data: string): string {
  return bytesToHex(ed25519.sign(lvCat(utf8ToBytes(label), utf8ToBytes(data)), device.secretKey));
}

export function verifyFor(pkHex: string, label: string, data: string, sigHex: unknown): boolean {
  try {
    if (!HEX64.test(pkHex) || typeof sigHex !== 'string' || !HEX128.test(sigHex)) return false;
    return ed25519.verify(hexToBytes(sigHex), lvCat(utf8ToBytes(label), utf8ToBytes(data)), hexToBytes(pkHex));
  } catch {
    return false;
  }
}

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)));
}

/** A random secret for an invite: 32 bytes, base64url. */
export function newSecret(): string {
  return toB64url(randomBytes(32));
}

export function toB64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
