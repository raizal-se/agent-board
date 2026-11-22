import type * as Y from 'yjs';
import { agreementsMap, changedAfterAgreement, isAgreed, reviewMark, reviewsMap, stateOf, type AgreeMode } from './agreement';
import { resolveArea, sidesMap } from './area';
import { edgesMap, isFileEdge } from './edges';
import { boardIdOf, boardMap, type Device, type Side } from './index';
import { framesMap, isFileItem, itemsMap } from './items';
import { activeMembers, boardModeOf, pendingAccepts, peopleOf } from './people';
import { entryText, isComment, isDecision, isSticky, isThread, type CommentItem } from './native';
import { milestoneCount, milestonesMap, storiesOf, storyFacts, storyWorld } from './stories';

/**
 * The board as JSON for agents (design 3.1 and 8). It holds meaning only: no `x`, `y` or size.
 * Agents read it; they never write it, and they cannot make sticky notes or comments.
 */
export const EXPORT_FORMAT = 'agent-board/1';

const iso = (ms: number | undefined) => (ms === undefined ? null : new Date(ms).toISOString());

export function exportBoard(doc: Y.Doc, opts: { mode?: AgreeMode; online?: readonly string[] } = {}) {
  const mode = opts.mode ?? boardModeOf(doc);
  const online = new Set(opts.online ?? []);
  const meta = boardMap<string>(doc, 'meta');
  const devices = boardMap<Device>(doc, 'devices');
  const sideOf = (name: string): Side => devices.get(name)?.side ?? 'product';
  const agreements = agreementsMap(doc);
  const sides = sidesMap(doc);
  const reviews = reviewsMap(doc);
  const all = [...itemsMap(doc).values()].filter(Boolean);

  const files = all.filter(isFileItem).sort((a, b) => a.path.localeCompare(b.path)).map((f) => {
    const a = agreements.get(f.id);
    const where = resolveArea(f, sideOf(f.owner), sides.get(f.id));
    const review = reviews.get(f.id);
    const mark = reviewMark(f, review);
    return {
      id: f.id,
      kind: 'file' as const,
      type: f.type,
      path: f.path,
      frame: f.frame,
      state: stateOf(a),
      area: where.area,
      area_source: where.source,
      area_set_by: where.source === 'human' ? (where.by ?? null) : null,
      area_set_at: where.source === 'human' ? iso(where.at) : null,
      author: `${f.owner}'s agent`,
      author_kind: 'agent' as const,
      owner: f.owner,
      owner_device: f.device ?? null,
      gone: f.gone,
      updated_at: iso(f.updatedAt),
      content: f.text,
      snapshot: a
        ? { content: a.snapshot.text, agreed_at: iso(a.snapshot.at), decision: a.decision ?? null, accepts: a.accepts.map((x) => ({ name: x.name, side: x.side, at: iso(x.at) })) }
        : null,
      changed_after_agreement: changedAfterAgreement(f, a),
      /** Accepts of the current version that do not make it agreed yet (peer mode). */
      pending_accepts:
        a && a.snapshot.hash === f.hash
          ? []
          : pendingAccepts(doc, f.id, f.hash).map((x) => ({ name: x.name, side: x.side, at: iso(x.at) })),
      review: review && mark ? { state: mark, by: review.by, at: iso(review.at), reason: review.reason } : null,
    };
  });

  const stickies = all.filter(isSticky).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).map((s) => ({
    id: s.id,
    kind: 'sticky' as const,
    path: null,
    frame: s.frame,
    state: 'draft' as const,
    area: null,
    area_source: null,
    area_set_by: null,
    area_set_at: null,
    author: s.author,
    author_kind: 'human' as const,
    owner: null,
    created_at: iso(s.createdAt),
    updated_at: iso(s.updatedAt),
    content: s.text,
    snapshot: null,
    changed_after_agreement: false,
    pending_accepts: [],
    review: null,
  }));

  const threads = new Map<string, CommentItem[]>();
  for (const c of all.filter(isComment)) threads.set(c.target, [...(threads.get(c.target) ?? []), c]);
  const comments = [...threads.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([target, list]) => {
    const t = all.find((i) => isThread(i) && i.target === target);
    const resolved = isThread(t) && t.resolved;
    return {
      target,
      resolved,
      resolved_by: resolved && isThread(t) ? (t.by ?? null) : null,
      comments: list
        .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
        .map((c) => ({ id: c.id, author: c.author, verdict: c.verdict ?? null, text: c.text, entry: entryText(c), at: iso(c.at) })),
    };
  });

  const decisions = all.filter(isDecision).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).map((d) => ({
    id: d.id,
    frame: d.frame,
    text: d.text,
    covers: d.covers,
    accepts: d.accepts.map((a) => ({ name: a.name, side: a.side, at: iso(a.at) })),
    agreed: isAgreed(d.accepts, mode),
    area: 'agreed' as const,
    author: d.author,
    created_at: iso(d.createdAt),
  }));

  const edges = [...edgesMap(doc).values()].filter(Boolean).sort((a, b) => a.id.localeCompare(b.id)).map((e) =>
    isFileEdge(e)
      ? { id: e.id, source: 'file' as const, from: e.from, to: e.to, to_path: e.toPath, label: e.label, author: null }
      : { id: e.id, source: 'human' as const, from: e.from, to: e.to, to_path: null, label: e.label, author: e.author },
  );

  const world = storyWorld(doc);
  const allStories = [...world.stories.values()].filter(Boolean);
  const milestoneList = [...milestonesMap(doc).values()].filter(Boolean).sort((a, b) => a.frame.localeCompare(b.frame) || a.number - b.number || a.id.localeCompare(b.id));
  const milestones = milestoneList.map((m) => {
    const list = storiesOf(allStories, m.id);
    return {
      id: m.id,
      frame: m.frame,
      number: m.number,
      name: m.name,
      goal: m.goal,
      author: m.author,
      source_path: m.source?.path ?? null,
      imported_titles: m.source?.titles ?? [],
      stories: list.map((s) => s.id),
      summary: milestoneCount(list, world.stories, mode),
      linear: null,
      created_at: iso(m.createdAt),
      updated_at: iso(m.updatedAt),
    };
  });
  const stories = milestoneList.flatMap((m) => storiesOf(allStories, m.id)).map((s) => {
    const f = storyFacts(s, world, mode);
    return {
      id: s.id,
      milestone: s.milestone,
      frame: s.frame,
      number: s.number,
      title: s.title,
      story: s.story,
      covers: f.covers.map((c) => ({ id: c.id, path: c.path, area: c.area, state: c.state })),
      covers_missing: s.missing ?? [],
      check: s.check,
      owner: s.owner || null,
      size: s.size,
      blocked_by: s.blockedBy,
      can_start: f.canStart,
      accepts: s.accepts.map((a) => ({ name: a.name, side: a.side, at: iso(a.at) })),
      approved: f.approved,
      cannot_accept: f.acceptBlock,
      rejected: s.rejected ? { by: s.rejected.by, at: iso(s.rejected.at), reason: s.rejected.reason } : null,
      covered_card_changed: f.coverChanged,
      ready_for_linear: f.readyForLinear,
      linear: s.linear,
      author: s.author,
      author_kind: s.authorKind,
      source: s.source ? { path: s.source.path, title: s.source.title } : null,
      extra_fields: s.extra ?? {},
      created_at: iso(s.createdAt),
      updated_at: iso(s.updatedAt),
    };
  });

  return {
    format: EXPORT_FORMAT,
    read_only: 'Agents read this file. Never edit it: the board rewrites it after each change.',
    agreement_mode: mode,
    board: { id: boardIdOf(doc) ?? null, name: meta.get('name') ?? null },
    people: peopleOf(doc).map((p) => ({
      name: p.name,
      side: p.side,
      online: online.has(p.name),
      devices: activeMembers(doc)
        .filter((m) => m.name === p.name)
        .map((m) => ({ device: m.pk, kind: m.kind })),
    })),
    frames: [...framesMap(doc).values()].filter(Boolean).sort((a, b) => a.name.localeCompare(b.name)).map((f) => ({ id: f.id, name: f.name })),
    items: [...files, ...stickies],
    edges,
    comments,
    decisions,
    milestones,
    stories,
  };
}

export type BoardExport = ReturnType<typeof exportBoard>;
