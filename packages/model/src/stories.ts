import type * as Y from 'yjs';
import { changedAfterAgreement, isAgreed, type AgreeMode, type Agreement } from './agreement';
import { boardPlaced, nextItemSpot, ownerSideOf, resolveArea, sidesMap } from './area';
import type { Side } from './index';
import { edgesMap, isHumanEdge } from './edges';
import { fileItems, fileName, itemsMap, type FileItem } from './items';
import { layoutMap } from './layout';
import { addVerdict, isComment, isThread, type Accept, type Person } from './native';
import { acceptsMap } from './people';

/**
 * Milestones and stories (design 5). A milestone is the goal of a phase of one feature frame; it
 * holds stories. A story is one user story, small enough to build, test and merge fast. Both are
 * board-native: people own them. An agent writes the first cut as a milestone file, which the board
 * reads once (see `importMilestone`); after that the file never changes a story.
 *
 * They live in their own maps (`milestones`, `stories`), keyed by id, with their places in
 * `layout` (relative to the frame's Milestone area, like the other cards). Comments, agrees and
 * rejects go to the story's thread in `items`, like a card's.
 */

export type StorySize = 'S' | 'M' | 'L';

/** Where a milestone came from: the milestone file block, and the story titles taken from it. */
export interface MilestoneSource {
  /** The file block's id (a rename keeps it). */
  item: string;
  path: string;
  /** Titles imported so far, as written. An entry with another title is a new entry. */
  titles: string[];
  at: number;
}

export interface MilestoneItem {
  id: string;
  kind: 'milestone';
  frame: string;
  number: number;
  name: string;
  goal: string;
  author: string;
  source?: MilestoneSource;
  createdAt: number;
  updatedAt: number;
}

export interface StoryItem {
  /** `story-<n>`, unique on the board. */
  id: string;
  kind: 'story';
  milestone: string;
  frame: string;
  /** A name only, not an order: "Story 3". Unique in its milestone. */
  number: number;
  title: string;
  /** "As a …, I want …, so that …" */
  story: string;
  /** Ids of the file cards it covers. */
  covers: string[];
  /** Names in the milestone file that matched no card at import. */
  missing?: string[];
  /** One acceptance check: "We know it works when …". */
  check: string;
  owner: string;
  size: StorySize | null;
  /** Ids of other stories in the same milestone. */
  blockedBy: string[];
  accepts: Accept[];
  /** The last reject, until the next edit or accept. */
  rejected?: { by: string; at: number; reason: string };
  /** A person, or a person's agent ("Arif's agent"). */
  author: string;
  authorKind: 'human' | 'agent';
  /** The milestone file entry it came from. */
  source?: { path: string; title: string };
  /** Fields of the milestone file entry the board does not know, kept as written. */
  extra?: Record<string, string>;
  /** Set by the Linear push (not in this build). */
  linear: null;
  createdAt: number;
  updatedAt: number;
}

export const STORY_W = 440;
export const STORY_H = 600;
export const MILESTONE_W = STORY_W * 2 + 40;
export const MILESTONE_H = 150;

export function milestonesMap(doc: Y.Doc): Y.Map<MilestoneItem> {
  return doc.getMap<MilestoneItem>('milestones');
}
export function storiesMap(doc: Y.Doc): Y.Map<StoryItem> {
  return doc.getMap<StoryItem>('stories');
}

export const isMilestone = (v: unknown): v is MilestoneItem => !!v && typeof v === 'object' && (v as MilestoneItem).kind === 'milestone';
export const isStory = (v: unknown): v is StoryItem => !!v && typeof v === 'object' && (v as StoryItem).kind === 'story';

export function storiesOf(stories: Iterable<StoryItem>, milestone: string): StoryItem[] {
  return [...stories].filter((s) => s.milestone === milestone).sort((a, b) => a.number - b.number || a.id.localeCompare(b.id));
}

// --- rules on plain values (the page and the export share them) ---

/** Why nobody can accept this story now, or null. */
export function acceptBlock(s: Pick<StoryItem, 'owner' | 'check' | 'size'>): string | null {
  if (s.size === 'L') return 'Too big · split it';
  if (!s.owner.trim()) return 'Set an owner first';
  if (!s.check.trim()) return 'Write the check first';
  return null;
}

export function isApproved(s: Pick<StoryItem, 'accepts'>, mode: AgreeMode): boolean {
  return isAgreed(s.accepts, mode);
}

/** The blockers that still hold: stories that exist, in the same milestone. */
export function openBlockers(s: StoryItem, stories: ReadonlyMap<string, StoryItem>): StoryItem[] {
  return s.blockedBy.map((id) => stories.get(id)).filter((b): b is StoryItem => !!b && b.milestone === s.milestone && b.id !== s.id);
}

/**
 * "can start" when no blocker is open. Without Linear there is no "done" yet, so every blocker
 * that still exists is open.
 */
export function canStart(s: StoryItem, stories: ReadonlyMap<string, StoryItem>): boolean {
  return openBlockers(s, stories).length === 0;
}

export type CoverState = 'agreed' | 'not agreed' | 'changed after agreement' | 'gone';

export interface CoverFact {
  id: string;
  path: string | null;
  /** The card's area now (its file's value, its owner's side, or a person's switch). */
  area: Side | null;
  state: CoverState;
  file: FileItem | null;
}

export interface StoryWorld {
  files: ReadonlyMap<string, FileItem>;
  agreements: ReadonlyMap<string, Agreement>;
  /** The area a file card is in now. */
  areaOf: (f: FileItem) => Side;
  stories: ReadonlyMap<string, StoryItem>;
}

export function coverFacts(s: Pick<StoryItem, 'covers'>, w: StoryWorld): CoverFact[] {
  return s.covers.map((id) => {
    const f = w.files.get(id);
    if (!f) return { id, path: null, area: null, state: 'gone', file: null };
    const a = w.agreements.get(id);
    const state: CoverState = f.gone ? 'gone' : !a ? 'not agreed' : changedAfterAgreement(f, a) ? 'changed after agreement' : 'agreed';
    return { id, path: f.path, area: w.areaOf(f), state, file: f };
  });
}

export interface StoryFacts {
  covers: CoverFact[];
  /** Covered cards in Product, then Engineering, by their area now. */
  product: CoverFact[];
  engineering: CoverFact[];
  approved: boolean;
  canStart: boolean;
  blockers: StoryItem[];
  /** A covered card changed after it was agreed. */
  coverChanged: boolean;
  acceptBlock: string | null;
  readyForLinear: boolean;
}

export function storyFacts(s: StoryItem, w: StoryWorld, mode: AgreeMode): StoryFacts {
  const covers = coverFacts(s, w);
  const blockers = openBlockers(s, w.stories);
  const approved = isApproved(s, mode);
  const coverChanged = covers.some((c) => c.state === 'changed after agreement');
  const block = acceptBlock(s);
  return {
    covers,
    product: covers.filter((c) => c.area === 'product'),
    engineering: covers.filter((c) => c.area === 'engineering'),
    approved,
    canStart: blockers.length === 0,
    blockers,
    coverChanged,
    acceptBlock: block,
    readyForLinear: approved && block === null && s.size !== null && !coverChanged,
  };
}

/** The world from the doc. */
export function storyWorld(doc: Y.Doc): StoryWorld {
  const sides = sidesMap(doc);
  return {
    files: new Map(fileItems(doc).map((f) => [f.id, f])),
    agreements: new Map(doc.getMap<Agreement>('agreements').entries()),
    areaOf: (f) => resolveArea(f, ownerSideOf(doc, f.owner), sides.get(f.id)).area,
    stories: new Map(storiesMap(doc).entries()),
  };
}

// --- making and editing ---

/** The meta key that holds the highest story number used, so a deleted story's id is not used again. */
const LAST_STORY = 'lastStory';

function storyIdNumber(id: string): number {
  const m = /^story-(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}

function nextStoryId(doc: Y.Doc): string {
  const last = doc.getMap('meta').get(LAST_STORY);
  let n = typeof last === 'number' ? last : 0;
  for (const id of storiesMap(doc).keys()) {
    const m = /^story-(\d+)$/.exec(id);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `story-${n + 1}`;
}

function nextNumber(doc: Y.Doc, milestone: string): number {
  return Math.max(0, ...storiesOf(storiesMap(doc).values(), milestone).map((s) => s.number)) + 1;
}

function milestoneId(doc: Y.Doc, frame: string, number: number): string {
  const base = `milestone:${frame}:${number}`;
  let id = base;
  for (let i = 2; milestonesMap(doc).has(id); i++) id = `${base}:${i}`;
  return id;
}

function place(doc: Y.Doc, id: string, frame: string, w: number, h: number): void {
  const layout = layoutMap(doc);
  if (!layout.has(id)) layout.set(id, { ...boardPlaced(undefined, nextItemSpot(doc, frame, { area: 'milestone', w, h })), w, h });
}

export function addMilestone(
  doc: Y.Doc,
  opts: { frame: string; number?: number; name?: string; goal?: string; author: string; source?: MilestoneSource; now?: number },
): string {
  const now = opts.now ?? Date.now();
  const used = [...milestonesMap(doc).values()].filter((m) => m.frame === opts.frame).map((m) => m.number);
  const number = opts.number ?? Math.max(0, ...used) + 1;
  const id = milestoneId(doc, opts.frame, number);
  doc.transact(() => {
    milestonesMap(doc).set(id, {
      id,
      kind: 'milestone',
      frame: opts.frame,
      number,
      name: (opts.name ?? '').trim(),
      goal: (opts.goal ?? '').trim(),
      author: opts.author,
      ...(opts.source ? { source: opts.source } : {}),
      createdAt: now,
      updatedAt: now,
    });
    place(doc, id, opts.frame, MILESTONE_W, MILESTONE_H);
  });
  return id;
}

export function editMilestone(doc: Y.Doc, id: string, patch: Partial<Pick<MilestoneItem, 'number' | 'name' | 'goal'>>, now = Date.now()): boolean {
  const m = milestonesMap(doc).get(id);
  if (!m) return false;
  const next = { ...m, ...clean(patch), updatedAt: now };
  if (next.number < 1 || !Number.isInteger(next.number)) return false;
  milestonesMap(doc).set(id, next);
  return true;
}

function clean<T extends object>(patch: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) out[k] = typeof v === 'string' ? v.trim() : v;
  return out as T;
}

export interface NewStory {
  title?: string;
  story?: string;
  covers?: string[];
  missing?: string[];
  check?: string;
  owner?: string;
  size?: StorySize | null;
  blockedBy?: string[];
  source?: { path: string; title: string };
  extra?: Record<string, string>;
}

/** A new draft story in a milestone, at a free spot in the Milestone area. Returns its id. */
export function addStory(doc: Y.Doc, milestone: string, story: NewStory, opts: { author: string; authorKind?: 'human' | 'agent'; now?: number }): string | null {
  const m = milestonesMap(doc).get(milestone);
  if (!m) return null;
  const now = opts.now ?? Date.now();
  const id = nextStoryId(doc);
  doc.transact(() => {
    storiesMap(doc).set(id, {
      id,
      kind: 'story',
      milestone,
      frame: m.frame,
      number: nextNumber(doc, milestone),
      title: (story.title ?? '').trim(),
      story: (story.story ?? '').trim(),
      covers: [...new Set(story.covers ?? [])],
      ...(story.missing?.length ? { missing: story.missing } : {}),
      check: (story.check ?? '').trim(),
      owner: (story.owner ?? '').trim(),
      size: story.size ?? null,
      blockedBy: [...new Set(story.blockedBy ?? [])],
      accepts: [],
      author: opts.author,
      authorKind: opts.authorKind ?? 'human',
      ...(story.source ? { source: story.source } : {}),
      ...(story.extra && Object.keys(story.extra).length ? { extra: story.extra } : {}),
      linear: null,
      createdAt: now,
      updatedAt: now,
    });
    place(doc, id, m.frame, STORY_W, STORY_H);
  });
  return id;
}

/** An edit to one of these resets the accepts (design 5.6). Owner, covers and blocked-by do not. */
export const RESETS_ACCEPTS = ['title', 'story', 'check', 'size'] as const;

export type StoryPatch = Partial<Pick<StoryItem, 'title' | 'story' | 'check' | 'size' | 'owner' | 'number'>>;

/**
 * Edit a story's fields. A change to the title, story, check or size resets its accepts; a change
 * to the owner (or the number) does not. False for an unknown story or a number already used.
 */
export function editStory(doc: Y.Doc, id: string, patch: StoryPatch, now = Date.now()): boolean {
  const s = storiesMap(doc).get(id);
  if (!s) return false;
  const p = clean(patch);
  if (p.number !== undefined) {
    if (!Number.isInteger(p.number) || p.number < 1) return false;
    if (storiesOf(storiesMap(doc).values(), s.milestone).some((o) => o.id !== id && o.number === p.number)) return false;
  }
  const next: StoryItem = { ...s, ...p, updatedAt: now };
  const reset = RESETS_ACCEPTS.some((k) => next[k] !== s[k]);
  if (reset) {
    next.accepts = [];
    delete next.rejected;
  }
  storiesMap(doc).set(id, next);
  return true;
}

export function setCovers(doc: Y.Doc, id: string, covers: string[], now = Date.now()): boolean {
  const s = storiesMap(doc).get(id);
  if (!s) return false;
  storiesMap(doc).set(id, { ...s, covers: [...new Set(covers)], updatedAt: now });
  return true;
}

export function addCover(doc: Y.Doc, id: string, item: string, now = Date.now()): boolean {
  const s = storiesMap(doc).get(id);
  if (!s || s.covers.includes(item)) return false;
  return setCovers(doc, id, [...s.covers, item], now);
}

export function removeCover(doc: Y.Doc, id: string, item: string, now = Date.now()): boolean {
  const s = storiesMap(doc).get(id);
  if (!s || !s.covers.includes(item)) return false;
  return setCovers(doc, id, s.covers.filter((c) => c !== item), now);
}

/** Whether `from` (transitively) waits on `to`. */
function waitsOn(stories: ReadonlyMap<string, StoryItem>, from: string, to: string, seen = new Set<string>()): boolean {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return (stories.get(from)?.blockedBy ?? []).some((b) => waitsOn(stories, b, to, seen));
}

/** Stories this one may be blocked by: the others in its milestone that do not wait on it. */
export function blockerChoices(s: StoryItem, stories: ReadonlyMap<string, StoryItem>): StoryItem[] {
  return storiesOf(stories.values(), s.milestone).filter((o) => o.id !== s.id && !waitsOn(stories, o.id, s.id));
}

/**
 * Set "blocked by". Only stories in the same milestone, never itself, never a loop. Does not reset
 * the accepts. False when one of them is not allowed.
 */
export function setBlockedBy(doc: Y.Doc, id: string, blockedBy: string[], now = Date.now()): boolean {
  const stories = new Map(storiesMap(doc).entries());
  const s = stories.get(id);
  if (!s) return false;
  const want = [...new Set(blockedBy)];
  const allowed = new Set(blockerChoices(s, stories).map((o) => o.id));
  if (!want.every((b) => allowed.has(b))) return false;
  storiesMap(doc).set(id, { ...s, blockedBy: want, updatedAt: now });
  return true;
}

/**
 * "✓ Agree" on a story: recorded in its thread, and the person's accept goes on the story.
 * Refused (with the reason) for a story with no owner, no check, or size L.
 */
export function agreeStory(doc: Y.Doc, id: string, opts: { by: Person; note?: string; now?: number }): true | string {
  const s = storiesMap(doc).get(id);
  if (!s) return 'No such story';
  const block = acceptBlock(s);
  if (block) return block;
  const at = opts.now ?? Date.now();
  doc.transact(() => {
    addVerdict(doc, { target: id, by: opts.by, verdict: 'agree', text: opts.note, now: at });
    const accepts = [...s.accepts.filter((a) => a.name !== opts.by.name), { name: opts.by.name, side: opts.by.side, at }];
    const next: StoryItem = { ...s, accepts };
    delete next.rejected;
    storiesMap(doc).set(id, next);
  });
  return true;
}

/** "✗ Reject" on a story: needs a reason. Recorded in its thread; the person's own accept goes. */
export function rejectStory(doc: Y.Doc, id: string, opts: { by: Person; reason: string; now?: number }): boolean {
  const reason = opts.reason.trim();
  const s = storiesMap(doc).get(id);
  if (!s || !reason) return false;
  const at = opts.now ?? Date.now();
  doc.transact(() => {
    addVerdict(doc, { target: id, by: opts.by, verdict: 'reject', text: reason, now: at });
    storiesMap(doc).set(id, { ...s, accepts: s.accepts.filter((a) => a.name !== opts.by.name), rejected: { by: opts.by.name, at, reason } });
  });
  return true;
}

// --- deleting ---

/**
 * A milestone file whose milestone a person deleted. The CLI does not import this file again by
 * itself. The file block shows "import", and a person can import it again. Key: the file block id.
 */
export interface DroppedImport {
  item: string;
  path: string;
  by: string;
  at: number;
}

export function droppedImportsMap(doc: Y.Doc): Y.Map<DroppedImport> {
  return doc.getMap<DroppedImport>('droppedImports');
}

/** Remove the things that point to a story or a milestone: its place, its thread and its links. */
function dropTraces(doc: Y.Doc, id: string): void {
  layoutMap(doc).delete(id);
  const items = itemsMap(doc);
  for (const [cid, c] of items.entries()) if ((isComment(c) || isThread(c)) && c.target === id) items.delete(cid);
  const edges = edgesMap(doc);
  for (const [eid, e] of edges.entries()) if (isHumanEdge(e) && (e.from === id || e.to === id)) edges.delete(eid);
  const accepts = acceptsMap(doc);
  for (const [k, a] of accepts.entries()) if (a?.item === id) accepts.delete(k);
}

/**
 * Delete a story: the story, its place, its comment thread and its accepts. The stories that it
 * blocked lose it as a blocker. If the story came from a milestone file, its title stays in the
 * milestone's imported titles, so "import new entries" does not offer it again.
 * False for an unknown story.
 */
export function deleteStory(doc: Y.Doc, id: string, now = Date.now()): boolean {
  const stories = storiesMap(doc);
  if (!stories.has(id)) return false;
  doc.transact(() => {
    const meta = doc.getMap('meta');
    const last = meta.get(LAST_STORY);
    if (storyIdNumber(id) > (typeof last === 'number' ? last : 0)) meta.set(LAST_STORY, storyIdNumber(id));
    stories.delete(id);
    dropTraces(doc, id);
    for (const [oid, o] of stories.entries()) {
      if (o?.blockedBy.includes(id)) stories.set(oid, { ...o, blockedBy: o.blockedBy.filter((b) => b !== id), updatedAt: now });
    }
  });
  return true;
}

/**
 * Delete a milestone and all its stories (as `deleteStory`). If it came from a milestone file, the
 * file stays: the CLI does not import it again by itself, and a person can import it again.
 * False for an unknown milestone.
 */
export function deleteMilestone(doc: Y.Doc, id: string, opts: { by?: string; now?: number } = {}): boolean {
  const m = milestonesMap(doc).get(id);
  if (!m) return false;
  const now = opts.now ?? Date.now();
  doc.transact(() => {
    for (const s of storiesOf(storiesMap(doc).values(), id)) deleteStory(doc, s.id, now);
    milestonesMap(doc).delete(id);
    dropTraces(doc, id);
    if (m.source) droppedImportsMap(doc).set(m.source.item, { item: m.source.item, path: m.source.path, by: opts.by ?? '', at: now });
  });
  return true;
}

/** Whether a person deleted the milestone of this file block (and did not import it again). */
export function isDroppedImport(doc: Y.Doc, fileId: string): boolean {
  return droppedImportsMap(doc).has(fileId);
}

// --- import from a milestone file ---

/** One milestone file, parsed (the shape of `MilestoneFile` in @agent-board/formats). */
export interface MilestoneInput {
  number: number;
  name: string;
  goal: string;
  entries: {
    title: string;
    story: string;
    size: StorySize | null;
    owner: string;
    covers: string[];
    blockedBy: string[];
    check: string;
    unknown: Record<string, string>;
  }[];
}

/**
 * The card a name in `covers` means: a path from the root, a path from the milestone file's
 * folder, or a file name that only one card has (in the same frame first, then on the board).
 */
export function resolveCover(files: readonly FileItem[], name: string, from: { path: string; frame: string }): FileItem | null {
  const n = name.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!n) return null;
  const live = files.filter((f) => !f.gone);
  const exact = live.find((f) => f.path === n);
  if (exact) return exact;
  const dir = from.path.includes('/') ? from.path.slice(0, from.path.lastIndexOf('/') + 1) : '';
  const rel = live.find((f) => f.path === dir + n);
  if (rel) return rel;
  const base = fileName(n);
  const inFrame = live.filter((f) => f.frame === from.frame && fileName(f.path) === base);
  if (inFrame.length === 1) return inFrame[0]!;
  const anywhere = live.filter((f) => fileName(f.path) === base);
  return anywhere.length === 1 ? anywhere[0]! : null;
}

/** The milestone made from this file block, if any. */
export function milestoneFromFile(doc: Y.Doc, fileId: string): MilestoneItem | undefined {
  return [...milestonesMap(doc).values()].find((m) => m.source?.item === fileId);
}

/** Entries of the file that are not imported yet (by title, in any case). */
export function newEntries<E extends { title: string }>(m: Pick<MilestoneItem, 'source'>, entries: readonly E[]): E[] {
  const known = new Set((m.source?.titles ?? []).map((t) => t.toLowerCase()));
  return entries.filter((e) => !known.has(e.title.toLowerCase()));
}

/**
 * Import a milestone file block: the first time, a milestone with one draft story per entry; after
 * that, only the entries with a new title ("import new entries"). A story that exists never changes
 * from the file. Blocked-by titles point to the stories of this milestone, old or new.
 * Returns the milestone id and the ids of the stories made.
 */
export function importMilestone(
  doc: Y.Doc,
  file: Pick<FileItem, 'id' | 'path' | 'frame' | 'owner'>,
  input: MilestoneInput,
  opts: { now?: number } = {},
): { milestone: string; stories: string[] } {
  const now = opts.now ?? Date.now();
  const author = `${file.owner}'s agent`;
  const files = fileItems(doc);
  const made: string[] = [];
  let mid = '';
  doc.transact(() => {
    droppedImportsMap(doc).delete(file.id);
    const existing = milestoneFromFile(doc, file.id);
    mid =
      existing?.id ??
      addMilestone(doc, {
        frame: file.frame,
        number: input.number,
        name: input.name,
        goal: input.goal,
        author,
        source: { item: file.id, path: file.path, titles: [], at: now },
        now,
      });
    const m = milestonesMap(doc).get(mid)!;
    const fresh = newEntries(m, input.entries);
    if (fresh.length === 0 && existing) return;
    const byTitle = new Map(storiesOf(storiesMap(doc).values(), mid).filter((s) => s.source).map((s) => [s.source!.title.toLowerCase(), s.id]));
    const ids: { id: string; blockedBy: string[] }[] = [];
    for (const e of fresh) {
      const covers: string[] = [];
      const missing: string[] = [];
      for (const c of e.covers) {
        const f = resolveCover(files, c, file);
        if (f) covers.push(f.id);
        else missing.push(c);
      }
      const id = addStory(
        doc,
        mid,
        { title: e.title, story: e.story, covers, missing, check: e.check, owner: e.owner, size: e.size, source: { path: file.path, title: e.title }, extra: e.unknown },
        { author, authorKind: 'agent', now },
      )!;
      byTitle.set(e.title.toLowerCase(), id);
      ids.push({ id, blockedBy: e.blockedBy });
      made.push(id);
    }
    for (const { id, blockedBy } of ids) {
      const want = blockedBy.map((t) => byTitle.get(t.toLowerCase())).filter((b): b is string => !!b && b !== id);
      if (want.length) {
        const s = storiesMap(doc).get(id)!;
        storiesMap(doc).set(id, { ...s, blockedBy: [...new Set(want)] });
      }
    }
    milestonesMap(doc).set(mid, {
      ...m,
      source: { item: file.id, path: file.path, titles: [...(m.source?.titles ?? []), ...fresh.map((e) => e.title)], at: now },
      updatedAt: now,
    });
  });
  return { milestone: mid, stories: made };
}

/** "4 stories · 2 approved · 1 can start" */
export function milestoneCount(stories: readonly StoryItem[], all: ReadonlyMap<string, StoryItem>, mode: AgreeMode): string {
  const n = stories.length;
  const approved = stories.filter((s) => isApproved(s, mode)).length;
  const start = stories.filter((s) => canStart(s, all)).length;
  return `${n} ${n === 1 ? 'story' : 'stories'} · ${approved} approved · ${start} can start`;
}
