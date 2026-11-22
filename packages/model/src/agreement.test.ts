import { describe, expect, it } from 'vitest';
import { agreeItem, agreementsMap, changedAfterAgreement, isAgreed, keepSnapshot, rejectItem, reviewMark, reviewsMap, stateOf } from './agreement';
import { snapId } from './area';
import { createBoardDoc } from './index';
import { fileItemOf, itemsMap, type FileItem } from './items';
import { AREA_PAD, AREA_TOP, layoutMap } from './layout';
import { commentsOn, entryText, setThreadResolved, threadId, type Person } from './native';

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

const entries = (doc: ReturnType<typeof createBoardDoc>, id: string) => commentsOn(doc, id).map(entryText);

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

describe('agree on a block', () => {
  it('one click: an entry in the thread, a snapshot, and a snapshot card in Agreed', () => {
    const doc = board();
    expect(agreeItem(doc, 'api', { by: dewi, now: 100 })).toBe(true);
    expect(entries(doc, 'api')).toEqual(['✓ Dewi agreed']);
    expect(commentsOn(doc, 'api')[0]).toMatchObject({ verdict: 'agree', author: 'Dewi', at: 100 });
    const a = agreementsMap(doc).get('api')!;
    expect(a).toEqual({ item: 'api', snapshot: { text: 'POST /intents', hash: 'h:POST /intents', type: 'markdown', at: 100 }, accepts: [{ name: 'Dewi', side: 'product', at: 100 }] });
    expect(stateOf(a)).toBe('agreed');
    expect(changedAfterAgreement(fileItemOf(doc, 'api')!, a)).toBe(false);
    // The live block stays where it is; the snapshot card gets the first spot in Agreed.
    expect(layoutMap(doc).get(snapId('api'))).toEqual({ x: AREA_PAD, y: AREA_TOP });
    expect(stateOf(agreementsMap(doc).get('flow'))).toBe('draft');
  });

  it('an optional note goes with the entry', () => {
    const doc = board();
    agreeItem(doc, 'api', { by: dewi, note: '  ship it ', now: 1 });
    expect(entries(doc, 'api')).toEqual(['✓ Dewi agreed: ship it']);
  });

  it('opens a resolved thread again', () => {
    const doc = board();
    setThreadResolved(doc, { target: 'api', by: dewi, resolved: true });
    agreeItem(doc, 'api', { by: dewi });
    expect(itemsMap(doc).get(threadId('api'))).toMatchObject({ resolved: false });
  });

  it('not for a block that is gone or not on the board', () => {
    const doc = board();
    itemsMap(doc).set('flow', { ...fileItemOf(doc, 'flow')!, gone: true });
    expect(agreeItem(doc, 'flow', { by: dewi })).toBe(false);
    expect(agreeItem(doc, 'nope', { by: dewi })).toBe(false);
    expect(agreementsMap(doc).size).toBe(0);
  });

  it('in peer mode one accept records the entry but takes no snapshot yet', () => {
    const doc = board();
    expect(agreeItem(doc, 'flow', { by: dewi, mode: 'peer' })).toBe(true);
    expect(entries(doc, 'flow')).toEqual(['✓ Dewi agreed']);
    expect(agreementsMap(doc).has('flow')).toBe(false);
    expect(layoutMap(doc).has(snapId('flow'))).toBe(false);
  });

  it('two snapshot cards take two spots', () => {
    const doc = board();
    agreeItem(doc, 'api', { by: dewi, now: 1 });
    agreeItem(doc, 'flow', { by: dewi, now: 2 });
    expect(layoutMap(doc).get(snapId('flow'))).not.toEqual(layoutMap(doc).get(snapId('api')));
  });
});

describe('reject on a block', () => {
  it('needs a reason', () => {
    const doc = board();
    expect(rejectItem(doc, 'api', { by: dewi, reason: '   ' })).toBe(false);
    expect(reviewsMap(doc).has('api')).toBe(false);
    expect(commentsOn(doc, 'api')).toEqual([]);
    expect(rejectItem(doc, 'nope', { by: dewi, reason: 'x' })).toBe(false);
  });

  it('an entry with the reason, and the mark "changes requested"; the next save makes it "updated, review again"', () => {
    const doc = board();
    expect(rejectItem(doc, 'api', { by: arif, reason: ' timeout is missing ', now: 7 })).toBe(true);
    expect(entries(doc, 'api')).toEqual(['✗ Arif rejected: timeout is missing']);
    expect(commentsOn(doc, 'api')[0]).toMatchObject({ verdict: 'reject', text: 'timeout is missing' });
    const r = reviewsMap(doc).get('api')!;
    expect(r).toEqual({ item: 'api', by: 'Arif', at: 7, reason: 'timeout is missing', hash: 'h:POST /intents' });
    expect(reviewMark(fileItemOf(doc, 'api')!, r)).toBe('changes requested');
    save(doc, 'api', 'POST /intents\ntimeout: 30s');
    expect(reviewMark(fileItemOf(doc, 'api')!, reviewsMap(doc).get('api'))).toBe('updated, review again');
    expect(reviewMark(fileItemOf(doc, 'flow')!, undefined)).toBeNull();
  });

  it('agree after a reject clears the mark; both entries stay in the thread, in order', () => {
    const doc = board();
    rejectItem(doc, 'api', { by: arif, reason: 'no', now: 1 });
    save(doc, 'api', 'v2');
    agreeItem(doc, 'api', { by: arif, now: 2 });
    expect(reviewsMap(doc).has('api')).toBe(false);
    expect(entries(doc, 'api')).toEqual(['✗ Arif rejected: no', '✓ Arif agreed']);
  });
});

describe('after agreement', () => {
  it('a later save marks the block changed and leaves the snapshot as it was', () => {
    const doc = board();
    agreeItem(doc, 'api', { by: dewi, now: 1 });
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
    agreeItem(doc, 'api', { by: dewi });
    save(doc, 'api', 'v2');
    expect(keepSnapshot(doc, 'api')).toBe(true);
    const a = agreementsMap(doc).get('api')!;
    expect(a.snapshot.text).toBe('POST /intents');
    expect(changedAfterAgreement(fileItemOf(doc, 'api')!, a)).toBe(false);
    save(doc, 'api', 'v3');
    expect(changedAfterAgreement(fileItemOf(doc, 'api')!, agreementsMap(doc).get('api'))).toBe(true);
    expect(keepSnapshot(doc, 'flow')).toBe(false);
  });

  it('agree again replaces the snapshot content; the snapshot card keeps its place', () => {
    const doc = board();
    agreeItem(doc, 'api', { by: dewi, now: 1 });
    layoutMap(doc).set(snapId('api'), { x: 900, y: 500 });
    save(doc, 'api', 'v2');
    keepSnapshot(doc, 'api');
    expect(agreeItem(doc, 'api', { by: arif, now: 50 })).toBe(true);
    const a = agreementsMap(doc).get('api')!;
    expect(a).toEqual({ item: 'api', snapshot: { text: 'v2', hash: 'h:v2', type: 'markdown', at: 50 }, accepts: [{ name: 'Arif', side: 'engineering', at: 50 }] });
    expect(changedAfterAgreement(fileItemOf(doc, 'api')!, a)).toBe(false);
    expect(layoutMap(doc).get(snapId('api'))).toEqual({ x: 900, y: 500 });
    // Peer mode: one accept is not enough, the old snapshot stays.
    save(doc, 'api', 'v3');
    agreeItem(doc, 'api', { by: dewi, mode: 'peer' });
    expect(agreementsMap(doc).get('api')!.snapshot.text).toBe('v2');
  });

  it('an agreement from a decision keeps its decision when agreed again', () => {
    const doc = board();
    agreementsMap(doc).set('api', { item: 'api', decision: 'd_1', snapshot: { text: 'old', hash: 'h:old', type: 'markdown', at: 0 }, accepts: [] });
    agreeItem(doc, 'api', { by: dewi, now: 3 });
    expect(agreementsMap(doc).get('api')).toMatchObject({ decision: 'd_1', snapshot: { text: 'POST /intents' } });
  });
});
