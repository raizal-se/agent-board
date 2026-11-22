import { describe, expect, it } from 'vitest';
import { agreeItem, agreementsMap, settleAgreements, waitingAccepts } from './agreement';
import { edgesMap, resolveEdgesTo } from './edges';
import { exportBoard } from './export';
import { createBoardDoc } from './index';
import { fileItemOf, itemsMap, type FileItem } from './items';
import { acceptKey, acceptsMap, boardModeOf, membersMap, peopleOf, revokedMap, waitingText, type Member } from './people';
import type { Person } from './native';

const raizal: Person = { name: 'Raizal', side: 'engineering' };
const dewi: Person = { name: 'Dewi', side: 'product' };

function member(pk: string, p: Person, at: number, kind: Member['kind'] = 'browser'): Member {
  return { pk, name: p.name, side: p.side, kind, by: null, at, sig: 'x' };
}

function file(id: string, text: string, owner = 'Raizal'): FileItem {
  return { id, kind: 'file', path: `checkout/${id}.md`, frame: 'frame:checkout', type: 'markdown', text, hash: `h:${text}`, owner, gone: false, updatedAt: 0 };
}

function shared() {
  const doc = createBoardDoc();
  membersMap(doc).set('a1', member('a1', raizal, 1, 'cli'));
  membersMap(doc).set('a2', member('a2', raizal, 2));
  membersMap(doc).set('d1', member('d1', dewi, 3));
  itemsMap(doc).set('api', file('api', 'POST /intents'));
  return doc;
}

describe('people and mode', () => {
  it('one entry per person; a solo board and a one-person board keep one accept', () => {
    const doc = createBoardDoc();
    expect(boardModeOf(doc)).toBe('solo');
    membersMap(doc).set('a1', member('a1', raizal, 1, 'cli'));
    membersMap(doc).set('a2', member('a2', raizal, 2));
    expect(peopleOf(doc)).toEqual([raizal]);
    expect(boardModeOf(doc)).toBe('solo');
    membersMap(doc).set('d1', member('d1', dewi, 3));
    expect(peopleOf(doc)).toEqual([raizal, dewi]);
    expect(boardModeOf(doc)).toBe('peer');
  });

  it('a revoked device is not on the board; a person with no device left is not either', () => {
    const doc = shared();
    revokedMap(doc).set('d1', { pk: 'd1', by: 'a1', at: 9, sig: 'x' });
    expect(peopleOf(doc)).toEqual([raizal]);
    expect(boardModeOf(doc)).toBe('solo');
  });
});

describe('agree in peer mode', () => {
  it('one side alone waits: "1 of 2 · waiting for engineering"; the other side makes it agreed', () => {
    const doc = shared();
    agreeItem(doc, 'api', { by: dewi, now: 10 });
    expect(agreementsMap(doc).get('api')).toBeUndefined();
    expect(waitingAccepts(doc, 'api').map((a) => a.name)).toEqual(['Dewi']);
    expect(waitingText(waitingAccepts(doc, 'api'))).toBe('1 of 2 · waiting for engineering');
    agreeItem(doc, 'api', { by: raizal, now: 20 });
    const a = agreementsMap(doc).get('api')!;
    expect(a.snapshot).toMatchObject({ text: 'POST /intents', at: 20 });
    expect(a.accepts.map((x) => `${x.name}:${x.side}`)).toEqual(['Dewi:product', 'Raizal:engineering']);
    expect(waitingAccepts(doc, 'api')).toEqual([]);
  });

  it('two accepts of the same side are not enough', () => {
    const doc = shared();
    membersMap(doc).set('m1', member('m1', { name: 'Mei', side: 'product' }, 4));
    agreeItem(doc, 'api', { by: dewi, now: 10 });
    agreeItem(doc, 'api', { by: { name: 'Mei', side: 'product' }, now: 11 });
    expect(agreementsMap(doc).get('api')).toBeUndefined();
  });

  it('an accept counts for the version it saw: a save in between starts over', () => {
    const doc = shared();
    agreeItem(doc, 'api', { by: dewi, now: 10 });
    itemsMap(doc).set('api', { ...fileItemOf(doc, 'api')!, text: 'POST /v2', hash: 'h:POST /v2' });
    expect(waitingAccepts(doc, 'api')).toEqual([]);
    agreeItem(doc, 'api', { by: raizal, now: 20 });
    expect(agreementsMap(doc).get('api')).toBeUndefined();
    expect(waitingText(waitingAccepts(doc, 'api'))).toBe('1 of 2 · waiting for product');
  });

  it('two devices that each saw only their own accept: settleAgreements makes it agreed after sync', () => {
    const doc = shared();
    // Both accepts arrive by sync (no agreeItem on this device).
    acceptsMap(doc).set(acceptKey('api', 'Dewi'), { item: 'api', name: 'Dewi', side: 'product', hash: 'h:POST /intents', at: 10 });
    acceptsMap(doc).set(acceptKey('api', 'Raizal'), { item: 'api', name: 'Raizal', side: 'engineering', hash: 'h:POST /intents', at: 11 });
    expect(settleAgreements(doc, 30)).toEqual(['api']);
    expect(agreementsMap(doc).get('api')!.snapshot.at).toBe(30);
    expect(settleAgreements(doc, 40)).toEqual([]);
  });
});

describe('links on a shared board', () => {
  it('resolve inside the owner folder only', () => {
    const doc = shared();
    itemsMap(doc).set('dewiFlow', file('dewiFlow', 'x', 'Dewi'));
    itemsMap(doc).set('raizalFlow', file('raizalFlow', 'y', 'Raizal'));
    edgesMap(doc).set('e1', { id: 'e1', source: 'file', from: 'dewiFlow', toPath: 'checkout/api.md', to: null, label: '' });
    edgesMap(doc).set('e2', { id: 'e2', source: 'file', from: 'raizalFlow', toPath: 'checkout/api.md', to: null, label: '' });
    const raizals = (id: string) => fileItemOf(doc, id)?.owner === 'Raizal';
    expect(resolveEdgesTo(doc, 'checkout/api.md', 'api', raizals)).toBe(1);
    expect(edgesMap(doc).get('e1')).toMatchObject({ to: null });
    expect(edgesMap(doc).get('e2')).toMatchObject({ to: 'api' });
  });
});

describe('export on a shared board', () => {
  it('has people with sides and online, the owner device, and accepts with sides', () => {
    const doc = shared();
    itemsMap(doc).set('api', { ...file('api', 'POST /intents'), device: 'a1', sig: 's' });
    agreeItem(doc, 'api', { by: dewi, now: Date.UTC(2026, 0, 1) });
    const out = exportBoard(doc, { online: ['Dewi'] });
    expect(out.agreement_mode).toBe('peer');
    expect(out.people).toEqual([
      { name: 'Raizal', side: 'engineering', online: false, devices: [{ device: 'a1', kind: 'cli' }, { device: 'a2', kind: 'browser' }] },
      { name: 'Dewi', side: 'product', online: true, devices: [{ device: 'd1', kind: 'browser' }] },
    ]);
    const api = out.items.find((i) => i.id === 'api')!;
    expect(api).toMatchObject({ owner: 'Raizal', owner_device: 'a1', state: 'draft' });
    expect(api.pending_accepts).toEqual([{ name: 'Dewi', side: 'product', at: '2026-01-01T00:00:00.000Z' }]);
  });
});
