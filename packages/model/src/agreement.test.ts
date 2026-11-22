import { describe, expect, it } from 'vitest';
import { agree, agreeAgain, agreementsMap, changedAfterAgreement, isAgreed, keepSnapshot, stateOf, zoneOf } from './agreement';
import { createBoardDoc } from './index';
import { fileItemOf, itemsMap, type FileItem } from './items';
import { layoutMap, zoneX } from './layout';
import { isDecision, type Person } from './native';

const dewi: Person = { name: 'Dewi', side: 'product' };
const arif: Person = { name: 'Arif', side: 'engineering' };

function file(id: string, text: string, frame = 'frame:checkout'): FileItem {
  return { id, kind: 'file', path: `checkout/${id}.md`, frame, type: 'markdown', text, hash: `h:${text}`, owner: 'Dewi', gone: false, updatedAt: 0 };
}

/** What the CLI does on a save: a new text and hash on the same item. */
function save(doc: ReturnType<typeof createBoardDoc>, id: string, text: string) {
  const f = fileItemOf(doc, id)!;
  itemsMap(doc).set(id, { ...f, text, hash: `h:${text}` });
}

function board() {
  const doc = createBoardDoc();
  for (const f of [file('flow', 'cart then intent'), file('api', 'POST /intents'), file('other', 'x', 'frame:ui')]) itemsMap(doc).set(f.id, f);
  return doc;
}

describe('isAgreed', () => {
  it('solo: one accept is enough; peer: one product and one engineering accept', () => {
    const a = { name: 'Dewi', side: 'product' as const, at: 1 };
    const b = { name: 'Arif', side: 'engineering' as const, at: 2 };
    expect(isAgreed([], 'solo')).toBe(false);
    expect(isAgreed([a], 'solo')).toBe(true);
    expect(isAgreed([a], 'peer')).toBe(false);
    expect(isAgreed([a, { ...a, name: 'Mei' }], 'peer')).toBe(false);
    expect(isAgreed([a, b], 'peer')).toBe(true);
  });
});

describe('agree', () => {
  it('makes a decision block in the agreed zone and freezes a snapshot of each covered block', () => {
    const doc = board();
    const d = agree(doc, { text: ' Intent before the card form. ', covers: ['flow', 'api'], by: dewi, now: 100 })!;
    const decision = itemsMap(doc).get(d);
    expect(isDecision(decision) && decision).toMatchObject({ text: 'Intent before the card form.', covers: ['flow', 'api'], frame: 'frame:checkout', author: 'Dewi', accepts: [{ name: 'Dewi', side: 'product', at: 100 }] });
    expect(layoutMap(doc).get(d)?.x).toBe(zoneX('agreed'));
    const a = agreementsMap(doc).get('api')!;
    expect(a).toMatchObject({ decision: d, snapshot: { text: 'POST /intents', hash: 'h:POST /intents', type: 'markdown', at: 100 } });
    expect(stateOf(a)).toBe('agreed');
    expect(zoneOf(a, 'product')).toBe('agreed');
    expect(zoneOf(undefined, 'engineering')).toBe('engineering');
    expect(changedAfterAgreement(fileItemOf(doc, 'api')!, a)).toBe(false);
  });

  it('covers only file blocks of the first block frame, and needs a text', () => {
    const doc = board();
    expect(agree(doc, { text: '  ', covers: ['flow'], by: dewi })).toBeNull();
    expect(agree(doc, { text: 'x', covers: ['nope'], by: dewi })).toBeNull();
    const d = agree(doc, { text: 'ok', covers: ['flow', 'other', 'nope'], by: dewi })!;
    expect(itemsMap(doc).get(d)).toMatchObject({ covers: ['flow'] });
    expect(agreementsMap(doc).has('other')).toBe(false);
  });

  it('in peer mode one accept makes the decision but no snapshot yet', () => {
    const doc = board();
    expect(agree(doc, { text: 'x', covers: ['flow'], by: dewi, mode: 'peer' })).not.toBeNull();
    expect(agreementsMap(doc).has('flow')).toBe(false);
  });
});

describe('after agreement', () => {
  it('a later save marks the block changed and leaves the snapshot as it was', () => {
    const doc = board();
    agree(doc, { text: 'ok', covers: ['api'], by: dewi, now: 1 });
    save(doc, 'api', 'POST /intents\nGET /intents/:id');
    const a = agreementsMap(doc).get('api')!;
    expect(a.snapshot.text).toBe('POST /intents');
    expect(changedAfterAgreement(fileItemOf(doc, 'api')!, a)).toBe(true);
    // Saving the agreed text again clears the mark.
    save(doc, 'api', 'POST /intents');
    expect(changedAfterAgreement(fileItemOf(doc, 'api')!, agreementsMap(doc).get('api'))).toBe(false);
  });

  it('keep snapshot clears the mark until the next change, and keeps the old snapshot', () => {
    const doc = board();
    agree(doc, { text: 'ok', covers: ['api'], by: dewi });
    save(doc, 'api', 'v2');
    expect(keepSnapshot(doc, 'api')).toBe(true);
    const a = agreementsMap(doc).get('api')!;
    expect(a.snapshot.text).toBe('POST /intents');
    expect(changedAfterAgreement(fileItemOf(doc, 'api')!, a)).toBe(false);
    save(doc, 'api', 'v3');
    expect(changedAfterAgreement(fileItemOf(doc, 'api')!, agreementsMap(doc).get('api'))).toBe(true);
    expect(keepSnapshot(doc, 'flow')).toBe(false);
  });

  it('agree again takes a new snapshot of the current file', () => {
    const doc = board();
    const d = agree(doc, { text: 'ok', covers: ['api'], by: dewi, now: 1 })!;
    save(doc, 'api', 'v2');
    keepSnapshot(doc, 'api');
    expect(agreeAgain(doc, 'api', { by: arif, now: 50 })).toBe(true);
    const a = agreementsMap(doc).get('api')!;
    expect(a).toEqual({ item: 'api', decision: d, snapshot: { text: 'v2', hash: 'h:v2', type: 'markdown', at: 50 }, accepts: [{ name: 'Arif', side: 'engineering', at: 50 }] });
    expect(changedAfterAgreement(fileItemOf(doc, 'api')!, a)).toBe(false);
    expect(agreeAgain(doc, 'flow', { by: dewi })).toBe(false);
    // Peer mode: one accept is not enough, the old snapshot stays.
    save(doc, 'api', 'v3');
    expect(agreeAgain(doc, 'api', { by: dewi, mode: 'peer' })).toBe(false);
    expect(agreementsMap(doc).get('api')!.snapshot.text).toBe('v2');
  });
});
