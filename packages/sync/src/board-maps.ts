import type * as Y from 'yjs';

/**
 * The parts of the board this package reads and signs. The model package owns these shapes
 * (`packages/model/src/people.ts`, `items.ts`); the sync package does not depend on the model, so
 * it names the same maps and fields here. Keep the two in step.
 */

export type DeviceKind = 'cli' | 'browser';
export type Side = 'product' | 'engineering';

export interface Member {
  pk: string;
  name: string;
  side: Side;
  kind: DeviceKind;
  by: string | null;
  at: number;
  sig: string;
}

export interface Revocation {
  pk: string;
  by: string;
  at: number;
  sig: string;
}

export interface Retired {
  id: string;
  owner: string;
  device: string;
  at: number;
  sig: string;
}

/** The fields of a file item the owner signs. */
export interface SignedFile {
  id: string;
  kind: 'file';
  path: string;
  frame: string;
  type: string;
  text: string;
  hash: string;
  area?: Side | null;
  owner: string;
  gone: boolean;
  updatedAt: number;
  device?: string;
  sig?: string;
}

export const membersMap = (doc: Y.Doc) => doc.getMap<Member>('members');
export const revokedMap = (doc: Y.Doc) => doc.getMap<Revocation>('revoked');
export const retiredMap = (doc: Y.Doc) => doc.getMap<Retired>('retired');
export const itemsMap = (doc: Y.Doc) => doc.getMap<unknown>('items');

export function boardIdOf(doc: Y.Doc): string | undefined {
  const id = doc.getMap('meta').get('id');
  return typeof id === 'string' ? id : undefined;
}
