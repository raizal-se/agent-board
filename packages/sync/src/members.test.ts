import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { membersMap, revokedMap, itemsMap, retiredMap, type SignedFile } from './board-maps';
import { devicePk, newDeviceKey, newSecret, normalizeName, sha256Hex, fingerprint } from './device';
import { inviteUrl, parseInvite } from './invite';
import { approve, makeRoot, MemberList, revoke, rootOf } from './members';
import { GUARD, OwnerGuard, signItem, signRetired } from './owner';

function board() {
  const doc = new Y.Doc();
  doc.getMap('meta').set('id', 'board-0001');
  const raizal = newDeviceKey();
  makeRoot(doc, raizal, { name: 'Raizal', side: 'engineering', kind: 'cli' }, 1);
  const list = new MemberList(doc, () => rootOf(doc));
  return { doc, raizal, list };
}

function file(owner: string, text: string, updatedAt = 1): SignedFile {
  return { id: 'f1', kind: 'file', path: 'checkout/api.md', frame: 'frame:checkout', type: 'markdown', text, hash: sha256Hex(text), area: null, owner, gone: false, updatedAt };
}

describe('invite link', () => {
  it('round trips; the secret stays after #', () => {
    const inv = { boardId: 'board-0001', secret: newSecret(), root: devicePk(newDeviceKey()) };
    const url = inviteUrl('https://board.example/app', inv);
    expect(url.startsWith('https://board.example/app/#board-0001.')).toBe(true);
    expect(parseInvite(url)).toEqual(inv);
    expect(parseInvite(url.split('#')[1]!)).toEqual(inv);
  });

  it('refuses links that are not invites', () => {
    expect(parseInvite('https://board.example/')).toBeNull();
    expect(parseInvite('https://x/#a.b.c')).toBeNull();
    expect(parseInvite('https://x/#board-0001.short.AAAA')).toBeNull();
  });
});

describe('names and fingerprints', () => {
  it('names are NFC, without control or format characters, and at most 40 characters', () => {
    expect(normalizeName('  Déwi​ \n ')).toBe('Déwi');
    expect(normalizeName('x'.repeat(80))).toHaveLength(40);
    expect(normalizeName('‮')).toBe('');
    expect(normalizeName(42)).toBe('');
  });

  it('a fingerprint is two groups of 4 hex digits, stable per key', () => {
    const pk = devicePk(newDeviceKey());
    expect(fingerprint(pk)).toMatch(/^[0-9a-f]{4} [0-9a-f]{4}$/);
    expect(fingerprint(pk)).toBe(fingerprint(pk));
  });
});

describe('approved list', () => {
  it('the creator is the root; a device it approves is on the list, and so is one that device approves', () => {
    const { doc, raizal, list } = board();
    const dewi = newDeviceKey();
    const tan = newDeviceKey();
    approve(doc, raizal, { pk: devicePk(dewi), name: 'Dewi', side: 'product', kind: 'browser' }, 2);
    approve(doc, dewi, { pk: devicePk(tan), name: 'Tan', side: 'engineering', kind: 'cli' }, 3);
    expect(list.list().map((m) => m.name)).toEqual(['Raizal', 'Dewi', 'Tan']);
    expect(list.approved(devicePk(tan))).toBe(true);
  });

  it('an entry that does not chain to the root approves nothing', () => {
    const { doc, list } = board();
    const mallory = newDeviceKey();
    const eve = newDeviceKey();
    approve(doc, mallory, { pk: devicePk(mallory), name: 'Mallory', side: 'product', kind: 'browser' }, 2, null);
    approve(doc, mallory, { pk: devicePk(eve), name: 'Eve', side: 'product', kind: 'browser' }, 3);
    expect(list.approved(devicePk(mallory))).toBe(false);
    expect(list.approved(devicePk(eve))).toBe(false);
  });

  it('a changed entry fails its signature', () => {
    const { doc, raizal, list } = board();
    const dewi = newDeviceKey();
    const m = approve(doc, raizal, { pk: devicePk(dewi), name: 'Dewi', side: 'product', kind: 'browser' }, 2);
    membersMap(doc).set(m.pk, { ...m, side: 'engineering' });
    expect(list.approved(m.pk)).toBe(false);
  });

  it('a board made by someone else does not pass for the invited board', () => {
    const { doc } = board();
    const other = devicePk(newDeviceKey());
    const asGuest = new MemberList(doc, () => other);
    expect(asGuest.list()).toEqual([]);
  });

  it('any member can revoke a device; the root cannot be revoked; a forged revoke does nothing', () => {
    const { doc, raizal, list } = board();
    const dewi = newDeviceKey();
    const tan = newDeviceKey();
    approve(doc, raizal, { pk: devicePk(dewi), name: 'Dewi', side: 'product', kind: 'browser' }, 2);
    approve(doc, raizal, { pk: devicePk(tan), name: 'Tan', side: 'engineering', kind: 'browser' }, 3);
    revoke(doc, newDeviceKey(), devicePk(tan), 4);
    expect(list.approved(devicePk(tan))).toBe(true);
    revoke(doc, dewi, devicePk(tan), 5);
    expect(list.approved(devicePk(tan))).toBe(false);
    revoke(doc, dewi, devicePk(raizal), 6);
    expect(list.approved(devicePk(raizal))).toBe(true);
    expect(revokedMap(doc).size).toBe(2);
  });

  it('the list tells listeners when it changes', () => {
    const { doc, raizal, list } = board();
    let n = 0;
    list.onChange(() => n++);
    approve(doc, raizal, { pk: devicePk(newDeviceKey()), name: 'Dewi', side: 'product', kind: 'browser' }, 2);
    expect(n).toBe(1);
  });
});

describe('owner check', () => {
  function shared() {
    const b = board();
    const dewi = newDeviceKey();
    approve(b.doc, b.raizal, { pk: devicePk(dewi), name: 'Dewi', side: 'product', kind: 'browser' }, 2);
    const guard = new OwnerGuard(b.doc, b.list);
    return { ...b, dewi, guard };
  }

  it('the owner can change its card', () => {
    const { doc, raizal } = shared();
    itemsMap(doc).set('f1', signItem(doc, raizal, file('Raizal', 'v1')));
    itemsMap(doc).set('f1', signItem(doc, raizal, file('Raizal', 'v2', 2)));
    expect((itemsMap(doc).get('f1') as SignedFile).text).toBe('v2');
  });

  it('another member cannot change, take over or delete the card', () => {
    const { doc, raizal, dewi, guard } = shared();
    itemsMap(doc).set('f1', signItem(doc, raizal, file('Raizal', 'v1')));
    itemsMap(doc).set('f1', { ...(itemsMap(doc).get('f1') as SignedFile), text: 'hacked', hash: sha256Hex('hacked') });
    expect((itemsMap(doc).get('f1') as SignedFile).text).toBe('v1');
    itemsMap(doc).set('f1', signItem(doc, dewi, file('Dewi', 'mine', 5)));
    expect((itemsMap(doc).get('f1') as SignedFile).owner).toBe('Raizal');
    itemsMap(doc).set('f1', signItem(doc, dewi, file('Raizal', 'mine', 5)));
    expect((itemsMap(doc).get('f1') as SignedFile).text).toBe('v1');
    itemsMap(doc).delete('f1');
    expect((itemsMap(doc).get('f1') as SignedFile).text).toBe('v1');
    expect(guard.stats.restored).toBe(4);
  });

  it('an older version does not replace a newer one', () => {
    const { doc, raizal } = shared();
    const old = signItem(doc, raizal, file('Raizal', 'v1', 1));
    itemsMap(doc).set('f1', signItem(doc, raizal, file('Raizal', 'v2', 2)));
    itemsMap(doc).set('f1', old);
    expect((itemsMap(doc).get('f1') as SignedFile).text).toBe('v2');
  });

  it('the owner retires a card with a signed note; a note from another member does nothing', () => {
    const { doc, raizal, dewi } = shared();
    itemsMap(doc).set('f1', signItem(doc, raizal, file('Raizal', 'v1')));
    doc.transact(() => {
      retiredMap(doc).set('f1', signRetired(doc, dewi, 'f1', 'Raizal', 3));
      itemsMap(doc).delete('f1');
    });
    expect(itemsMap(doc).has('f1')).toBe(true);
    doc.transact(() => {
      retiredMap(doc).set('f1', signRetired(doc, raizal, 'f1', 'Raizal', 4));
      itemsMap(doc).delete('f1');
    });
    expect(itemsMap(doc).has('f1')).toBe(false);
  });

  it('a card with a bad signature and no good value is removed', () => {
    const { doc, raizal, guard } = shared();
    itemsMap(doc).set('f1', { ...signItem(doc, raizal, file('Raizal', 'v1')), text: 'x' });
    expect(itemsMap(doc).has('f1')).toBe(false);
    expect(guard.stats.removed).toBe(1);
  });

  it('a card from a device not on the list yet waits for the list, then is judged', () => {
    const { doc, raizal, guard } = shared();
    const tan = newDeviceKey();
    itemsMap(doc).set('f1', signItem(doc, tan, file('Tan', 'v1')));
    expect(guard.stats.held).toBe(1);
    expect(itemsMap(doc).has('f1')).toBe(true);
    approve(doc, raizal, { pk: devicePk(tan), name: 'Tan', side: 'engineering', kind: 'cli' }, 3);
    expect(itemsMap(doc).has('f1')).toBe(true);

    const ghost = newDeviceKey();
    itemsMap(doc).set('f2', { ...signItem(doc, ghost, { ...file('Ghost', 'x'), id: 'f2' }) });
    approve(doc, raizal, { pk: devicePk(ghost), name: 'Not Ghost', side: 'product', kind: 'cli' }, 4);
    expect(itemsMap(doc).has('f2')).toBe(false);
  });

  it('a solo board (no list) is not checked; repairs use the GUARD origin', () => {
    const doc = new Y.Doc();
    doc.getMap('meta').set('id', 'board-0002');
    const list = new MemberList(doc, () => rootOf(doc));
    new OwnerGuard(doc, list);
    itemsMap(doc).set('f1', file('Raizal', 'unsigned'));
    expect(itemsMap(doc).has('f1')).toBe(true);

    const s = shared();
    const origins: unknown[] = [];
    s.doc.on('afterTransaction', (tr: Y.Transaction) => origins.push(tr.origin));
    itemsMap(s.doc).set('f9', { ...file('Raizal', 'bad'), id: 'f9' });
    expect(origins).toContain(GUARD);
  });
});
