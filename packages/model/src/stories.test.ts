import { describe, expect, it } from 'vitest';
import { agreeItem } from './agreement';
import { boardGeometry, geoInput, switchArea } from './area';
import { exportBoard } from './export';
import { boardMap, createBoardDoc, type Device } from './index';
import { framesMap, itemsMap, type FileItem } from './items';
import { layoutMap, overlaps } from './layout';
import { commentsOn, type Person } from './native';
import {
  addCover,
  addMilestone,
  addStory,
  agreeStory,
  blockerChoices,
  canStart,
  editMilestone,
  editStory,
  importMilestone,
  milestoneCount,
  milestoneFromFile,
  newEntries,
  rejectStory,
  removeCover,
  resolveCover,
  setBlockedBy,
  storiesMap,
  storyFacts,
  storyWorld,
  type MilestoneInput,
} from './stories';

const dewi: Person = { name: 'Dewi', side: 'product' };
const F = 'frame:checkout';

function file(id: string, path: string, opts: Partial<FileItem> = {}): FileItem {
  return { id, kind: 'file', path, frame: F, type: path.endsWith('.html') ? 'html' : 'markdown', text: id, hash: `h-${id}`, owner: 'Arif', gone: false, updatedAt: 0, ...opts };
}

function board() {
  const doc = createBoardDoc();
  boardMap<Device>(doc, 'devices').set('Arif', { id: 'Arif', name: 'Arif', side: 'engineering' });
  framesMap(doc).set(F, { id: F, name: 'checkout' });
  framesMap(doc).set('frame:ui', { id: 'frame:ui', name: 'ui' });
  const form = file('f_form', 'ui/card-form.html', { frame: 'frame:ui', area: 'product' });
  const flow = file('f_flow', 'checkout/flow.md');
  const api = file('f_api', 'checkout/api.md');
  const ms = file('f_ms', 'checkout/milestone-1.md', { text: '# Milestone 1: Pay by card' });
  for (const f of [form, flow, api, ms]) itemsMap(doc).set(f.id, f);
  return { doc, form, flow, api, ms };
}

const INPUT: MilestoneInput = {
  number: 1,
  name: 'Pay by card',
  goal: 'a shopper can pay by card',
  entries: [
    { title: 'Payment ready', story: 'As a shopper, I want x', size: 'S', owner: '', covers: ['card-form.html', 'flow.md'], blockedBy: [], check: 'intent set', unknown: {} },
    { title: 'Pass 3DS', story: 'As a shopper, I want 3DS', size: 'M', owner: 'Mei Ling', covers: ['checkout/api.md', 'nope.md'], blockedBy: ['payment ready'], check: 'challenge shows', unknown: { priority: 'high' } },
  ],
};

describe('importMilestone', () => {
  it('makes a milestone and one draft story per entry, once', () => {
    const { doc, ms, form, flow, api } = board();
    const r = importMilestone(doc, ms, INPUT, { now: 5 });
    const m = milestoneFromFile(doc, ms.id)!;
    expect(m).toMatchObject({ id: r.milestone, frame: F, number: 1, name: 'Pay by card', goal: 'a shopper can pay by card', author: "Arif's agent" });
    expect(m.source).toEqual({ item: ms.id, path: ms.path, titles: ['Payment ready', 'Pass 3DS'], at: 5 });
    const [a, b] = r.stories.map((id) => storiesMap(doc).get(id)!);
    expect(a).toMatchObject({ id: 'story-1', number: 1, title: 'Payment ready', covers: [form.id, flow.id], size: 'S', owner: '', accepts: [], author: "Arif's agent", authorKind: 'agent', linear: null });
    expect(b).toMatchObject({ id: 'story-2', number: 2, covers: [api.id], missing: ['nope.md'], blockedBy: ['story-1'], extra: { priority: 'high' } });
    // Placed in the Milestone area, not on top of each other.
    const cells = boardGeometry(geoInput(doc)).get(F)!.cells.filter((c) => c.area === 'milestone');
    expect(cells.map((c) => c.id).sort()).toEqual([m.id, 'story-1', 'story-2'].sort());
    for (const c of cells) for (const d of cells) if (c !== d) expect(overlaps(c, d)).toBe(false);
    expect(layoutMap(doc).get('story-1')?.placedBy).toBe('board');

    // Importing the same file again changes nothing.
    expect(importMilestone(doc, ms, INPUT).stories).toEqual([]);
    expect(storiesMap(doc).size).toBe(2);
  });

  it('"import new entries" adds only new titles; existing stories never change from the file', () => {
    const { doc, ms } = board();
    importMilestone(doc, ms, INPUT, { now: 5 });
    editStory(doc, 'story-1', { title: 'Payment ready early' });
    const changed: MilestoneInput = {
      ...INPUT,
      entries: [
        { ...INPUT.entries[0]!, story: 'rewritten in the file' },
        INPUT.entries[1]!,
        { title: 'Save the card', story: 's', size: 'S', owner: 'Dewi', covers: [], blockedBy: ['Pass 3DS', 'Payment ready'], check: 'c', unknown: {} },
      ],
    };
    const m = milestoneFromFile(doc, ms.id)!;
    expect(newEntries(m, changed.entries).map((e) => e.title)).toEqual(['Save the card']);
    const r = importMilestone(doc, ms, changed, { now: 9 });
    expect(r.stories).toEqual(['story-3']);
    expect(storiesMap(doc).get('story-1')).toMatchObject({ title: 'Payment ready early', story: 'As a shopper, I want x' });
    expect(storiesMap(doc).get('story-3')).toMatchObject({ number: 3, blockedBy: ['story-2', 'story-1'] });
    expect(milestoneFromFile(doc, ms.id)!.source!.titles).toEqual(['Payment ready', 'Pass 3DS', 'Save the card']);
  });
});

describe('resolveCover', () => {
  it('takes a root path, a path from the file folder, or a file name only one card has', () => {
    const { form, flow, api } = board();
    const files = [form, flow, api];
    const from = { path: 'checkout/milestone-1.md', frame: F };
    expect(resolveCover(files, 'checkout/api.md', from)).toBe(api);
    expect(resolveCover(files, './api.md', from)).toBe(api);
    expect(resolveCover(files, 'card-form.html', from)).toBe(form);
    const other = file('f_flow2', 'ui/flow.md', { frame: 'frame:ui' });
    expect(resolveCover([...files, other], 'flow.md', from)).toBe(flow);
    expect(resolveCover([other, file('f_x', 'x/flow.md', { frame: 'frame:x' })], 'flow.md', from)).toBeNull();
    expect(resolveCover([{ ...api, gone: true }], 'api.md', from)).toBeNull();
  });
});

describe('story fields and accepts', () => {
  function oneStory() {
    const b = board();
    const m = addMilestone(b.doc, { frame: F, name: 'Pay', author: 'Dewi' });
    const id = addStory(b.doc, m, { title: 'T', story: 'S', check: 'C', owner: 'Dewi', size: 'S' }, { author: 'Dewi' })!;
    return { ...b, m, id };
  }

  it('makes a story by hand in a milestone', () => {
    const { doc, m, id } = oneStory();
    expect(storiesMap(doc).get(id)).toMatchObject({ milestone: m, frame: F, number: 1, author: 'Dewi', authorKind: 'human', accepts: [], linear: null });
    expect(addStory(doc, 'nope', {}, { author: 'x' })).toBeNull();
  });

  it('needs an owner and a check, and refuses an L story', () => {
    const { doc, id } = oneStory();
    editStory(doc, id, { owner: '' });
    expect(agreeStory(doc, id, { by: dewi })).toBe('Set an owner first');
    editStory(doc, id, { owner: 'Dewi', check: '' });
    expect(agreeStory(doc, id, { by: dewi })).toBe('Write the check first');
    editStory(doc, id, { check: 'C', size: 'L' });
    expect(agreeStory(doc, id, { by: dewi })).toBe('Too big · split it');
    expect(commentsOn(doc, id)).toEqual([]);
    editStory(doc, id, { size: 'M' });
    expect(agreeStory(doc, id, { by: dewi, now: 3 })).toBe(true);
    expect(storiesMap(doc).get(id)!.accepts).toEqual([{ name: 'Dewi', side: 'product', at: 3 }]);
    expect(commentsOn(doc, id).map((c) => c.verdict)).toEqual(['agree']);
  });

  it('an edit to title, story, check or size resets the accepts; owner, covers, blocked-by and moving do not', () => {
    const { doc, id, m, flow } = oneStory();
    const other = addStory(doc, m, { title: 'O' }, { author: 'Dewi' })!;
    const agreed = () => agreeStory(doc, id, { by: dewi });
    const accepts = () => storiesMap(doc).get(id)!.accepts.length;
    for (const patch of [{ title: 'T2' }, { story: 'S2' }, { check: 'C2' }, { size: 'M' as const }]) {
      agreed();
      expect(accepts()).toBe(1);
      editStory(doc, id, patch);
      expect(accepts()).toBe(0);
    }
    agreed();
    editStory(doc, id, { owner: 'Arif' });
    addCover(doc, id, flow.id);
    setBlockedBy(doc, id, [other]);
    layoutMap(doc).set(id, { x: 999, y: 999 });
    editStory(doc, id, { title: 'T2' }); // the same title: no change
    expect(accepts()).toBe(1);
  });

  it('a reject needs a reason, records it, and takes the person\'s accept away', () => {
    const { doc, id } = oneStory();
    agreeStory(doc, id, { by: dewi, now: 1 });
    expect(rejectStory(doc, id, { by: dewi, reason: ' ' })).toBe(false);
    expect(rejectStory(doc, id, { by: dewi, reason: 'too vague', now: 4 })).toBe(true);
    expect(storiesMap(doc).get(id)).toMatchObject({ accepts: [], rejected: { by: 'Dewi', at: 4, reason: 'too vague' } });
    expect(commentsOn(doc, id).map((c) => c.verdict)).toEqual(['agree', 'reject']);
  });

  it('covers: add and remove a card', () => {
    const { doc, id, flow, api } = oneStory();
    expect(addCover(doc, id, flow.id)).toBe(true);
    expect(addCover(doc, id, flow.id)).toBe(false);
    addCover(doc, id, api.id);
    removeCover(doc, id, flow.id);
    expect(storiesMap(doc).get(id)!.covers).toEqual([api.id]);
  });

  it('edits a milestone', () => {
    const { doc, m } = oneStory();
    expect(editMilestone(doc, m, { name: ' Pay by card ', goal: 'g', number: 2 })).toBe(true);
    expect(editMilestone(doc, m, { number: 0 })).toBe(false);
    expect(doc.getMap('milestones').get(m)).toMatchObject({ name: 'Pay by card', goal: 'g', number: 2 });
  });

  it('a story number is unique in its milestone', () => {
    const { doc, id, m } = oneStory();
    addStory(doc, m, {}, { author: 'Dewi' });
    expect(editStory(doc, id, { number: 2 })).toBe(false);
    expect(editStory(doc, id, { number: 7 })).toBe(true);
  });
});

describe('blocking', () => {
  it('"can start" with no open blocker; only the same milestone; never a loop', () => {
    const { doc } = board();
    const m = addMilestone(doc, { frame: F, author: 'Dewi' });
    const m2 = addMilestone(doc, { frame: F, author: 'Dewi' });
    const a = addStory(doc, m, { title: 'A' }, { author: 'Dewi' })!;
    const b = addStory(doc, m, { title: 'B' }, { author: 'Dewi' })!;
    const c = addStory(doc, m, { title: 'C' }, { author: 'Dewi' })!;
    const x = addStory(doc, m2, { title: 'X' }, { author: 'Dewi' })!;
    const all = () => new Map(storiesMap(doc).entries());
    expect(setBlockedBy(doc, b, [a])).toBe(true);
    expect(setBlockedBy(doc, c, [b])).toBe(true);
    expect(setBlockedBy(doc, a, [c])).toBe(false); // a loop
    expect(setBlockedBy(doc, a, [a])).toBe(false);
    expect(setBlockedBy(doc, a, [x])).toBe(false); // another milestone
    expect(blockerChoices(storiesMap(doc).get(a)!, all()).map((s) => s.id)).toEqual([]);
    expect(canStart(storiesMap(doc).get(a)!, all())).toBe(true);
    expect(canStart(storiesMap(doc).get(b)!, all())).toBe(false);
    // A blocker that is gone does not hold.
    storiesMap(doc).delete(a);
    expect(canStart(storiesMap(doc).get(b)!, all())).toBe(true);
  });
});

describe('storyFacts', () => {
  it('puts each covered card in a half by its area now, with its state', () => {
    const { doc, ms, form, flow, api } = board();
    importMilestone(doc, ms, INPUT);
    agreeItem(doc, form.id, { by: dewi });
    agreeItem(doc, api.id, { by: dewi });
    itemsMap(doc).set(api.id, { ...api, text: 'v2', hash: 'h2' });
    const s1 = storiesMap(doc).get('story-1')!;
    let f = storyFacts(s1, storyWorld(doc), 'solo');
    expect(f.product.map((c) => [c.path, c.state])).toEqual([['ui/card-form.html', 'agreed']]);
    expect(f.engineering.map((c) => [c.path, c.state])).toEqual([['checkout/flow.md', 'not agreed']]);
    // A person switches flow.md to Product: it moves to the product half.
    switchArea(doc, flow.id, 'product', { by: dewi });
    f = storyFacts(s1, storyWorld(doc), 'solo');
    expect(f.product.map((c) => c.path)).toEqual(['ui/card-form.html', 'checkout/flow.md']);
    expect(f.engineering).toEqual([]);
    const s2 = storyFacts(storiesMap(doc).get('story-2')!, storyWorld(doc), 'solo');
    expect(s2.engineering.map((c) => c.state)).toEqual(['changed after agreement']);
    expect(s2.coverChanged).toBe(true);
    expect(s2.canStart).toBe(false);
    expect(s2.blockers.map((b) => b.id)).toEqual(['story-1']);
  });

  it('ready_for_linear: approved, not L, no covered card changed after agreement', () => {
    const { doc, ms, api } = board();
    importMilestone(doc, ms, INPUT);
    const id = 'story-2';
    const ready = () => storyFacts(storiesMap(doc).get(id)!, storyWorld(doc), 'solo').readyForLinear;
    expect(ready()).toBe(false);
    agreeStory(doc, id, { by: dewi });
    expect(ready()).toBe(true);
    agreeItem(doc, api.id, { by: dewi });
    itemsMap(doc).set(api.id, { ...api, text: 'v2', hash: 'h2' });
    expect(ready()).toBe(false); // approved, but a covered card changed
    agreeItem(doc, api.id, { by: dewi }); // agreed again
    expect(ready()).toBe(true);
    // Peer mode needs a product and an engineering accept.
    expect(storyFacts(storiesMap(doc).get(id)!, storyWorld(doc), 'peer').readyForLinear).toBe(false);
  });
});

describe('the export', () => {
  it('holds milestones and stories with every field, and no position', () => {
    const { doc, ms, form, flow } = board();
    importMilestone(doc, ms, INPUT, { now: 0 });
    agreeItem(doc, form.id, { by: dewi });
    agreeStory(doc, 'story-2', { by: dewi, now: 0 });
    const out = exportBoard(doc);
    expect(out.milestones).toEqual([
      expect.objectContaining({
        frame: F,
        number: 1,
        name: 'Pay by card',
        goal: 'a shopper can pay by card',
        source_path: 'checkout/milestone-1.md',
        stories: ['story-1', 'story-2'],
        summary: '2 stories · 1 approved · 1 can start',
        linear: null,
      }),
    ]);
    expect(out.stories[0]).toEqual({
      id: 'story-1',
      milestone: out.milestones[0]!.id,
      frame: F,
      number: 1,
      title: 'Payment ready',
      story: 'As a shopper, I want x',
      covers: [
        { id: form.id, path: 'ui/card-form.html', area: 'product', state: 'agreed' },
        { id: flow.id, path: 'checkout/flow.md', area: 'engineering', state: 'not agreed' },
      ],
      covers_missing: [],
      check: 'intent set',
      owner: null,
      size: 'S',
      blocked_by: [],
      can_start: true,
      accepts: [],
      approved: false,
      cannot_accept: 'Set an owner first',
      rejected: null,
      covered_card_changed: false,
      ready_for_linear: false,
      linear: null,
      author: "Arif's agent",
      author_kind: 'agent',
      source: { path: 'checkout/milestone-1.md', title: 'Payment ready' },
      extra_fields: {},
      created_at: '1970-01-01T00:00:00.000Z',
      updated_at: '1970-01-01T00:00:00.000Z',
    });
    expect(out.stories[1]).toMatchObject({
      blocked_by: ['story-1'],
      can_start: false,
      approved: true,
      ready_for_linear: true,
      covers_missing: ['nope.md'],
      accepts: [{ name: 'Dewi', side: 'product', at: '1970-01-01T00:00:00.000Z' }],
    });
    expect(JSON.stringify(out.stories)).not.toMatch(/"(x|y|w|h)":/);
  });

  it('milestoneCount reads like the design', () => {
    const { doc, ms } = board();
    importMilestone(doc, ms, INPUT);
    const all = new Map(storiesMap(doc).entries());
    expect(milestoneCount([...all.values()], all, 'solo')).toBe('2 stories · 0 approved · 1 can start');
  });
});
