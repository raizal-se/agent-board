import { isMilestonePath, parseMilestoneFile } from '@agent-board/formats';
import {
  AREA_PAD,
  AREA_TOP,
  BLOCK_W,
  boardGeometry,
  changedAfterAgreement,
  DECISION_H,
  DECISION_W,
  estimateCardH,
  resolveArea,
  reviewMark,
  snapId,
  STICKY_H,
  STICKY_W,
  type Agreement,
  type Area,
  type AreaOverride,
  type AreaSource,
  type CanvasShape,
  type CommentItem,
  type DecisionItem,
  type Device,
  type FileEdge,
  type FileItem,
  type Frame,
  type Grid,
  type HumanEdge,
  type Layout,
  type MilestoneItem,
  type Rect,
  type Review,
  type ReviewMark,
  type Side,
  type Snapshot,
  type StickyItem,
  type StoryFacts,
  type StoryItem,
  type ThreadItem,
  milestoneCount,
  newEntries,
  storiesOf,
  storyFacts,
  type CoverFact,
  type StoryWorld,
} from '@agent-board/model';

export interface BoardState {
  frames: Frame[];
  /** File blocks. */
  items: FileItem[];
  /** Edges from links in files. */
  edges: FileEdge[];
  layout: ReadonlyMap<string, Layout>;
  /** Board name (the watched folder's name). */
  name?: string;
  /** The person running the CLI. */
  owner?: string;
  stickies?: StickyItem[];
  decisions?: DecisionItem[];
  comments?: CommentItem[];
  /** Thread state by target id. */
  threads?: ReadonlyMap<string, ThreadItem>;
  /** Edges people drew. */
  humanEdges?: HumanEdge[];
  /** Agreements by file item id. */
  agreements?: ReadonlyMap<string, Agreement>;
  devices?: ReadonlyMap<string, Device>;
  /** Free drawing, by element id. */
  canvas?: ReadonlyMap<string, CanvasShape>;
  /** People's area switches, by file item id. */
  sides?: ReadonlyMap<string, AreaOverride>;
  /** The grid each frame has grown to, by frame id. */
  grids?: ReadonlyMap<string, Grid>;
  /** Rejects, by file item id. */
  reviews?: ReadonlyMap<string, Review>;
  milestones?: MilestoneItem[];
  stories?: StoryItem[];
}

/** The comment pin of an item: how many comments, and whether its thread is resolved. */
export interface Pin {
  count: number;
  resolved: boolean;
}

export type BlockData = {
  item: FileItem;
  missing: string[];
  agreement?: Agreement;
  changed: boolean;
  /** Product or Engineering, and who said so. */
  area: Side;
  areaSource: AreaSource;
  /** Who switched it and when, for a person's switch. */
  areaBy?: { name: string; at: number };
  review?: Review;
  /** "changes requested" after a reject, "updated, review again" once the file is saved. */
  mark: ReviewMark | null;
  pin: Pin;
  /** The agent's colour: one per owner. */
  agentColor: string;
  /** For a milestone file: what was imported from it, and how many entries are new since. */
  milestoneFile?: MilestoneFileData;
};
export interface MilestoneFileData {
  /** The milestone made from it, if it was imported. */
  milestone: string | null;
  /** Stories in that milestone now. */
  stories: number;
  /** Entries in the file with a title not imported yet. */
  fresh: number;
}
/** One covered card in a story half: its facts, and the text to preview (the snapshot when agreed). */
export interface CoverView extends CoverFact {
  snapshot: Snapshot | null;
  /** What the preview shows: the agreed snapshot, else the file as it is now. */
  preview: { type: FileItem['type']; text: string } | null;
}
export type StoryData = {
  story: StoryItem;
  milestone: MilestoneItem;
  facts: StoryFacts;
  product: CoverView[];
  engineering: CoverView[];
  /** Covered cards that are gone. */
  gone: CoverView[];
  /** "Story N" of each open blocker. */
  blockerNames: string[];
  pin: Pin;
};
export type MilestoneData = {
  milestone: MilestoneItem;
  /** "4 stories · 2 approved · 1 can start" */
  count: string;
  stories: string[];
  pin: Pin;
};
/** A "blocks" arrow: from the blocker to the story that waits on it. */
export interface StoryEdge {
  id: string;
  from: string;
  to: string;
}
export type StickyData = { sticky: StickyItem; pin: Pin };
export type DecisionData = { decision: DecisionItem; covers: string[]; pin: Pin };
/** The frozen copy of an agreed block, as a card in Agreed. */
export type SnapshotData = {
  /** `snap:<item id>`. */
  id: string;
  item: FileItem;
  agreement: Agreement;
  /** The live file changed after the agreement. */
  changed: boolean;
};

/** A link drawn between two things on the board. */
export interface DrawnEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  kind: 'file' | 'human';
}

export interface FrameView {
  frame: Frame;
  /** Visible file blocks in it. */
  count: number;
  /** Position (absolute) and size: room for its four areas and every note in it. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Its four areas, relative to it. */
  areas: Record<Area, Rect>;
}

export interface Views {
  frames: FrameView[];
  /** File blocks on the board, by item id (not gone, in a known frame). */
  blocks: Map<string, BlockData>;
  decisions: Map<string, DecisionData>;
  /** Snapshot cards, by `snap:<item id>`. */
  snapshots: Map<string, SnapshotData>;
  stickies: Map<string, StickyData>;
  /** The area of each block, snapshot card and decision, by id: its place is relative to it. */
  areaOf: Map<string, Area>;
  /** Edges with both ends on the board. */
  edges: DrawnEdge[];
  /** Blocks of deleted files, for the "hidden blocks" list. */
  hidden: FileItem[];
  milestones: Map<string, MilestoneData>;
  stories: Map<string, StoryData>;
  storyEdges: StoryEdge[];
  /** Frames with no milestone yet: their Milestone area offers to start one, by frame id. */
  noMilestone: Set<string>;
}

/** The id of the "start a milestone" card in a frame's empty Milestone area. */
export const milestoneStartId = (frame: string) => `${frame}~milestone-start`;
export const isMilestoneStartId = (id: string) => id.endsWith('~milestone-start');
export const frameOfMilestoneStart = (id: string) => id.slice(0, -'~milestone-start'.length);
/** The id of the "blocks" arrow from `blocker` to `story`. */
export const storyEdgeId = (blocker: string, story: string) => `${blocker}~blocks~${story}`;
/** Stories are named by number: "Story 3". */
export const storyName = (s: Pick<StoryItem, 'number' | 'title'>, withTitle = true) => `Story ${s.number}${withTitle && s.title ? ` · ${s.title}` : ''}`;
export const milestoneName = (m: Pick<MilestoneItem, 'number' | 'name'>) => `Milestone ${m.number}${m.name ? ` · ${m.name}` : ''}`;
const quoted = (t: string) => (t ? ` '${t}'` : '');
const nStories = (n: number) => `${n} ${n === 1 ? 'story' : 'stories'}`;

/**
 * The question before a delete of stories and milestones: "Delete Story 3 'Pay by card'? This can
 * not be undone." A milestone says how many stories go with it.
 */
export function deleteQuestion(
  ids: readonly string[],
  stories: readonly Pick<StoryItem, 'id' | 'number' | 'title' | 'milestone'>[],
  milestones: readonly Pick<MilestoneItem, 'id' | 'number' | 'name'>[],
): { title: string; text: string } | null {
  const ms = milestones.filter((m) => ids.includes(m.id));
  const gone = new Set(ms.map((m) => m.id));
  // A story in a selected milestone goes with the milestone.
  const sts = stories.filter((st) => ids.includes(st.id) && !gone.has(st.milestone));
  const withM = stories.filter((st) => gone.has(st.milestone)).length;
  const end = '? This can not be undone.';
  if (ms.length === 0 && sts.length === 0) return null;
  if (ms.length === 0 && sts.length === 1) {
    const st = sts[0]!;
    return { title: 'Delete story', text: `Delete Story ${st.number}${quoted(st.title)}${end}` };
  }
  if (ms.length === 1 && sts.length === 0) {
    const m = ms[0]!;
    return { title: 'Delete milestone', text: `Delete Milestone ${m.number}${quoted(m.name)}${withM ? ` and its ${nStories(withM)}` : ''}${end}` };
  }
  const parts: string[] = [];
  if (ms.length) parts.push(`${ms.length} ${ms.length === 1 ? 'milestone' : 'milestones'}${withM ? ` with ${nStories(withM)}` : ''}`);
  if (sts.length) parts.push(nStories(sts.length));
  return { title: 'Delete', text: `Delete ${parts.join(' and ')}${end}` };
}

export const AREA_LABEL: Record<Area, string> = { product: 'Product', engineering: 'Engineering', agreed: 'Agreed', milestone: 'Milestone' };
/** How the web agrees: one person's accept is enough (as for cards). */
export const AGREE_MODE = 'solo' as const;

export const ORIGIN: Layout = { x: 0, y: 0 };
/** Where something in an area with no place yet shows: the first spot. */
export const AREA_START: Layout = { x: AREA_PAD, y: AREA_TOP };
const NO_PIN: Pin = { count: 0, resolved: false };

const AGENT_COLORS = ['#7C3AED', '#0891B2', '#DB2777', '#65A30D', '#C2410C', '#2563EB'];

/** A steady colour per owner, so each person's agent looks the same everywhere. */
export function agentColor(owner: string): string {
  let h = 0;
  for (const c of owner) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AGENT_COLORS[h % AGENT_COLORS.length]!;
}

/** A short name for any item, for labels and screen readers. */
export function nameOf(item: FileItem | StickyItem | DecisionItem): string {
  if (item.kind === 'file') return item.path;
  if (item.kind === 'sticky') return `note by ${item.author}`;
  return `decision "${item.text.length > 40 ? `${item.text.slice(0, 40)}…` : item.text}"`;
}

/** The size a note or decision takes: its own if it was resized, else the default for its kind. */
export function sizeIn(layout: Layout | undefined, kind: 'sticky' | 'decision'): { w: number; h: number } {
  const d = kind === 'sticky' ? { w: STICKY_W, h: STICKY_H } : { w: DECISION_W, h: DECISION_H };
  return { w: layout?.w ?? d.w, h: layout?.h ?? d.h };
}

/** A card's size: as measured (its content) or resized, else a guess from its content. */
export function cardSize(layout: Layout | undefined, content: { type: FileItem['type']; text: string }): { w: number; h: number } {
  return { w: layout?.w ?? BLOCK_W, h: layout?.h ?? estimateCardH(content.type, content.text) };
}

/**
 * What the board shows, from the doc: frames with their four areas and size, the data each block,
 * snapshot card, note and decision draws, and the edges whose two ends are on the board. Blocks and
 * cards are placed relative to their area, notes relative to their frame (as in the doc).
 */
export function views(state: BoardState): Views {
  const stickies = state.stickies ?? [];
  const decisions = state.decisions ?? [];
  const agreements = state.agreements ?? new Map<string, Agreement>();
  const devices = state.devices ?? new Map<string, Device>();
  const threads = state.threads ?? new Map<string, ThreadItem>();
  const frameIds = new Set(state.frames.map((f) => f.id));

  const pins = new Map<string, Pin>();
  for (const c of state.comments ?? []) {
    const p = pins.get(c.target) ?? { count: 0, resolved: !!threads.get(c.target)?.resolved };
    p.count++;
    pins.set(c.target, p);
  }
  const pinOf = (id: string) => pins.get(id) ?? NO_PIN;

  const byId = new Map<string, FileItem | StickyItem | DecisionItem>();
  for (const i of [...state.items, ...stickies, ...decisions]) byId.set(i.id, i);

  const ownerSide = (owner: string): Side => devices.get(owner)?.side ?? 'product';
  const sides = state.sides ?? new Map<string, AreaOverride>();
  const reviews = state.reviews ?? new Map<string, Review>();
  const geo = boardGeometry({
    frames: state.frames,
    files: state.items,
    stickies,
    decisions,
    agreements,
    layout: state.layout,
    sides,
    grids: state.grids ?? new Map<string, Grid>(),
    ownerSide,
    milestones: (state.milestones ?? []).filter((m) => frameIds.has(m.frame)),
    stories: (state.stories ?? []).filter((st) => frameIds.has(st.frame)),
  });
  const frames: FrameView[] = [...state.frames]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((frame) => {
      const l = state.layout.get(frame.id) ?? ORIGIN;
      const g = geo.get(frame.id)!;
      const count = state.items.filter((i) => i.frame === frame.id && !i.gone).length;
      return { frame, count, x: l.x, y: l.y, w: g.w, h: g.h, areas: g.areas };
    });
  const areaOf = new Map<string, Area>();

  const missingOf = new Map<string, string[]>();
  for (const e of state.edges) {
    const target = e.to ? byId.get(e.to) : undefined;
    if (target && !(target.kind === 'file' && target.gone)) continue;
    const list = missingOf.get(e.from) ?? [];
    list.push(e.toPath);
    missingOf.set(e.from, list);
  }

  // Milestones and stories.
  const allMilestones = (state.milestones ?? []).filter((m) => frameIds.has(m.frame));
  const allStories = (state.stories ?? []).filter((st) => frameIds.has(st.frame) && allMilestones.some((m) => m.id === st.milestone));
  const storyById = new Map(allStories.map((st) => [st.id, st]));
  const milestoneFileOf = (item: FileItem): { milestoneFile?: MilestoneFileData } => {
    const parsed = parseMilestoneFile(item.path, item.text);
    if (!parsed) return {};
    const m = allMilestones.find((x) => x.source?.item === item.id);
    return {
      milestoneFile: {
        milestone: m?.id ?? null,
        stories: m ? allStories.filter((st) => st.milestone === m.id).length : 0,
        fresh: m ? newEntries(m, parsed.entries).length : parsed.entries.length,
      },
    };
  };

  const blocks = new Map<string, BlockData>();
  const snapshots = new Map<string, SnapshotData>();
  for (const item of [...state.items].sort((a, b) => a.path.localeCompare(b.path))) {
    if (item.gone || !frameIds.has(item.frame)) continue;
    const agreement = agreements.get(item.id);
    const where = resolveArea(item, ownerSide(item.owner), sides.get(item.id));
    const review = reviews.get(item.id);
    const changed = changedAfterAgreement(item, agreement);
    areaOf.set(item.id, where.area);
    blocks.set(item.id, {
      item,
      missing: missingOf.get(item.id)?.sort() ?? [],
      agreement,
      changed,
      area: where.area,
      areaSource: where.source,
      ...(where.source === 'human' ? { areaBy: { name: where.by ?? '', at: where.at ?? 0 } } : {}),
      review,
      mark: reviewMark(item, review),
      pin: pinOf(item.id),
      agentColor: agentColor(item.owner),
      ...(isMilestonePath(item.path) ? milestoneFileOf(item) : {}),
    });
    if (agreement) {
      areaOf.set(snapId(item.id), 'agreed');
      snapshots.set(snapId(item.id), { id: snapId(item.id), item, agreement, changed });
    }
  }

  const decisionData = new Map<string, DecisionData>();
  for (const d of [...decisions].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))) {
    if (!frameIds.has(d.frame)) continue;
    const covers = d.covers.map((id) => byId.get(id)).map((i) => (i?.kind === 'file' ? i.path : '(removed)'));
    areaOf.set(d.id, 'agreed');
    decisionData.set(d.id, { decision: d, covers, pin: pinOf(d.id) });
  }

  // A note whose frame is gone stands on its own.
  const stickyData = new Map<string, StickyData>();
  for (const s of [...stickies].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))) {
    stickyData.set(s.id, { sticky: s.frame && !frameIds.has(s.frame) ? { ...s, frame: null } : s, pin: pinOf(s.id) });
  }

  const drawn = (id: string | null) => !!id && (blocks.has(id) || decisionData.has(id) || stickyData.has(id));
  const edges: DrawnEdge[] = [];
  for (const e of state.edges) if (drawn(e.from) && drawn(e.to)) edges.push({ id: e.id, from: e.from, to: e.to!, label: e.label, kind: 'file' });
  for (const e of state.humanEdges ?? []) if (drawn(e.from) && drawn(e.to)) edges.push({ id: e.id, from: e.from, to: e.to, label: e.label, kind: 'human' });

  const world: StoryWorld = {
    files: new Map(state.items.map((i) => [i.id, i])),
    agreements,
    areaOf: (f) => resolveArea(f, ownerSide(f.owner), sides.get(f.id)).area,
    stories: storyById,
  };
  const coverView = (c: CoverFact): CoverView => {
    const snapshot = agreements.get(c.id)?.snapshot ?? null;
    const preview = snapshot ? { type: snapshot.type, text: snapshot.text } : c.file && !c.file.gone ? { type: c.file.type, text: c.file.text } : null;
    return { ...c, snapshot, preview };
  };
  const milestones = new Map<string, MilestoneData>();
  for (const m of [...allMilestones].sort((a, b) => a.frame.localeCompare(b.frame) || a.number - b.number || a.id.localeCompare(b.id))) {
    const list = storiesOf(allStories, m.id);
    areaOf.set(m.id, 'milestone');
    milestones.set(m.id, { milestone: m, count: milestoneCount(list, storyById, AGREE_MODE), stories: list.map((st) => st.id), pin: pinOf(m.id) });
  }
  const stories = new Map<string, StoryData>();
  const storyEdges: StoryEdge[] = [];
  for (const md of milestones.values()) {
    for (const id of md.stories) {
      const st = storyById.get(id)!;
      const facts = storyFacts(st, world, AGREE_MODE);
      const covers = facts.covers.map(coverView);
      areaOf.set(id, 'milestone');
      stories.set(id, {
        story: st,
        milestone: md.milestone,
        facts,
        product: covers.filter((c) => c.state !== 'gone' && c.area === 'product'),
        engineering: covers.filter((c) => c.state !== 'gone' && c.area === 'engineering'),
        gone: covers.filter((c) => c.state === 'gone'),
        blockerNames: facts.blockers.map((b) => storyName(b, false)),
        pin: pinOf(id),
      });
      for (const b of facts.blockers) storyEdges.push({ id: storyEdgeId(b.id, id), from: b.id, to: id });
    }
  }
  const noMilestone = new Set(state.frames.filter((f) => !allMilestones.some((m) => m.frame === f.id)).map((f) => f.id));

  const hidden = state.items.filter((i) => i.gone).sort((a, b) => a.path.localeCompare(b.path));
  return { frames, blocks, decisions: decisionData, snapshots, stickies: stickyData, areaOf, edges, hidden, milestones, stories, storyEdges, noMilestone };
}
