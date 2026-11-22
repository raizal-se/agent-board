import {
  BLOCK_W,
  FRAME_PAD,
  frameSizeFor,
  MIN_GRID,
  STICKY_H,
  type AreaOverride,
  type Review,
  type Agreement,
  type CommentItem,
  type DecisionItem,
  type FileEdge,
  type FileItem,
  type HumanEdge,
  type Layout,
  type StickyItem,
} from '@agent-board/model';
import { describe, expect, it } from 'vitest';
import { agentColor, views } from './derive';

function item(id: string, path: string, frame: string, extra: Partial<FileItem> = {}): FileItem {
  return { id, kind: 'file', path, frame, type: 'markdown', text: '', hash: '', owner: 'me', gone: false, updatedAt: 0, ...extra };
}
function edge(from: string, toPath: string, to: string | null, label = ''): FileEdge {
  return { id: `fe:${from}->${toPath}#${label}`, source: 'file', from, toPath, to, label };
}

const frames = [{ id: 'frame:b', name: 'b' }, { id: 'frame:a', name: 'a' }];

describe('views', () => {
  it('lists frames by name at their layout, and blocks in a known frame', () => {
    const layout = new Map<string, Layout>([['frame:a', { x: 10, y: 20 }]]);
    const v = views({ frames, items: [item('x', 'a/x.md', 'frame:a'), item('o', 'o.md', 'frame:nope')], edges: [], layout });
    expect(v.frames.map((f) => f.frame.id)).toEqual(['frame:a', 'frame:b']);
    expect(v.frames[0]).toMatchObject({ x: 10, y: 20, count: 1 });
    expect([...v.blocks.keys()]).toEqual(['x']);
  });

  it('a frame grows to hold a block dragged to its edge', () => {
    const layout = new Map<string, Layout>([['x', { x: 2000, y: 48 }]]);
    const v = views({ frames, items: [item('x', 'a/x.md', 'frame:a')], edges: [], layout });
    // The block's place is relative to its area (Product, at the frame's top left).
    expect(v.frames[0]!.w).toBeGreaterThanOrEqual(FRAME_PAD + 2000 + BLOCK_W);
    expect(v.frames[1]!.w).toBe(frameSizeFor(MIN_GRID).w);
  });

  it('hides gone blocks and lists them', () => {
    const v = views({ frames, items: [item('x', 'a/x.md', 'frame:a', { gone: true })], edges: [], layout: new Map() });
    expect(v.blocks.has('x')).toBe(false);
    expect(v.hidden.map((i) => i.path)).toEqual(['a/x.md']);
  });

  it('keeps an edge only when both ends are on the board, and notes missing targets', () => {
    const items = [item('x', 'a/x.md', 'frame:a'), item('y', 'a/y.md', 'frame:a'), item('z', 'a/z.md', 'frame:a', { gone: true })];
    const edges = [edge('x', 'a/y.md', 'y', 'calls'), edge('x', 'later.md', null), edge('x', 'a/z.md', 'z')];
    const v = views({ frames, items, edges, layout: new Map() });
    expect(v.edges).toEqual([{ id: 'fe:x->a/y.md#calls', from: 'x', to: 'y', label: 'calls', kind: 'file' }]);
    expect(v.blocks.get('x')!.missing).toEqual(['a/z.md', 'later.md']);
  });

  it('file blocks carry the agent colour and their area: the owner side, the file, or a person', () => {
    const items = [
      item('x', 'a/x.md', 'frame:a', { owner: 'dewi' }),
      item('f', 'a/f.md', 'frame:a', { owner: 'dewi', area: 'product' }),
      item('h', 'a/h.md', 'frame:a', { owner: 'dewi' }),
    ];
    const devices = new Map([['dewi', { id: 'dewi', name: 'dewi', side: 'engineering' as const }]]);
    const sides = new Map<string, AreaOverride>([['h', { item: 'h', side: 'product', by: 'raizal', at: 5, fileArea: null }]]);
    const v = views({ frames, items, edges: [], layout: new Map(), devices, sides });
    expect(v.blocks.get('x')).toMatchObject({ area: 'engineering', areaSource: 'owner side', agentColor: agentColor('dewi') });
    expect(v.blocks.get('f')).toMatchObject({ area: 'product', areaSource: 'file' });
    expect(v.blocks.get('h')).toMatchObject({ area: 'product', areaSource: 'human', areaBy: { name: 'raizal', at: 5 } });
    expect(v.areaOf.get('x')).toBe('engineering');
  });

  it('an agreed block stays in its area; its snapshot card is in Agreed; both show a change after the agreement', () => {
    const items = [item('x', 'a/x.md', 'frame:a', { hash: 'h2', owner: 'dewi' }), item('y', 'a/y.md', 'frame:a', { hash: 'h1', owner: 'dewi' })];
    const snap = (hash: string) => ({ text: 'old', hash, type: 'markdown' as const, at: 1 });
    const agreements = new Map<string, Agreement>([
      ['x', { item: 'x', snapshot: snap('h1'), accepts: [{ name: 'raizal', side: 'product', at: 1 }] }],
      ['y', { item: 'y', snapshot: snap('h1'), accepts: [{ name: 'raizal', side: 'product', at: 1 }] }],
    ]);
    const devices = new Map([['dewi', { id: 'dewi', name: 'dewi', side: 'engineering' as const }]]);
    const v = views({ frames, items, edges: [], layout: new Map(), devices, agreements });
    expect(v.blocks.get('x')).toMatchObject({ area: 'engineering', changed: true });
    expect(v.blocks.get('y')).toMatchObject({ area: 'engineering', changed: false });
    expect(v.snapshots.get('snap:x')).toMatchObject({ item: { id: 'x' }, changed: true });
    expect(v.snapshots.get('snap:y')).toMatchObject({ changed: false });
    expect(v.areaOf.get('snap:x')).toBe('agreed');
    // Kept against this version: no mark.
    agreements.set('x', { ...agreements.get('x')!, keptHash: 'h2' });
    const kept = views({ frames, items, edges: [], layout: new Map(), agreements });
    expect(kept.blocks.get('x')).toMatchObject({ changed: false });
    expect(kept.snapshots.get('snap:x')).toMatchObject({ changed: false });
    // A gone file has no snapshot card.
    expect(views({ frames, items: [{ ...items[0]!, gone: true }], edges: [], layout: new Map(), agreements }).snapshots.size).toBe(0);
  });

  it('a rejected block is marked "changes requested" until its file changes, then "updated, review again"', () => {
    const review: Review = { item: 'x', by: 'raizal', at: 1, reason: 'too vague', hash: 'h1' };
    const reviews = new Map([['x', review]]);
    const at = (hash: string) => views({ frames, items: [item('x', 'a/x.md', 'frame:a', { hash })], edges: [], layout: new Map(), reviews }).blocks.get('x')!;
    expect(at('h1')).toMatchObject({ mark: 'changes requested', review });
    expect(at('h2')).toMatchObject({ mark: 'updated, review again' });
    expect(views({ frames, items: [item('x', 'a/x.md', 'frame:a')], edges: [], layout: new Map() }).blocks.get('x')!.mark).toBeNull();
  });

  it('notes sit in their frame or on their own; a frame grows to hold one', () => {
    const sticky = (id: string, frame: string | null): StickyItem => ({ id, kind: 'sticky', text: 'hi', frame, author: 'dewi', side: 'product', createdAt: 1, updatedAt: 1 });
    const layout = new Map<string, Layout>([['in', { x: 3000, y: 100 }], ['out', { x: -500, y: -50 }]]);
    const v = views({ frames, items: [], edges: [], layout, stickies: [sticky('in', 'frame:a'), sticky('out', null), sticky('lost', 'frame:gone')] });
    expect(v.stickies.get('in')!.sticky.frame).toBe('frame:a');
    expect(v.stickies.get('out')!.sticky.frame).toBeNull();
    expect(v.stickies.get('lost')!.sticky.frame).toBeNull();
    expect(v.frames[0]!.w).toBeGreaterThanOrEqual(3000 + 200);
    expect(v.frames[0]!.h).toBeGreaterThanOrEqual(100 + STICKY_H);
  });

  it('decisions show the paths they cover; pins count comments and show a resolved thread', () => {
    const decision: DecisionItem = { id: 'd1', kind: 'decision', frame: 'frame:a', text: 'ok', covers: ['x'], accepts: [{ name: 'dewi', side: 'product', at: 1 }], author: 'dewi', createdAt: 1 };
    const comment = (id: string, target: string): CommentItem => ({ id, kind: 'comment', target, author: 'dewi', text: 't', at: 1 });
    const v = views({
      frames,
      items: [item('x', 'a/x.md', 'frame:a')],
      edges: [],
      layout: new Map(),
      decisions: [decision],
      comments: [comment('c1', 'x'), comment('c2', 'x'), comment('c3', 'd1')],
      threads: new Map([['d1', { id: 'thread:d1', kind: 'thread', target: 'd1', resolved: true }]]),
    });
    expect(v.decisions.get('d1')).toMatchObject({ covers: ['a/x.md'], pin: { count: 1, resolved: true } });
    expect(v.blocks.get('x')).toMatchObject({ pin: { count: 2, resolved: false } });
  });

  it('a drawn edge to something not on the board is left out', () => {
    const items = [item('x', 'a/x.md', 'frame:a'), item('y', 'a/y.md', 'frame:a')];
    const human: HumanEdge = { id: 'e1', source: 'human', from: 'y', to: 'x', label: 'depends on', author: 'dewi', createdAt: 1 };
    const v = views({ frames, items, edges: [edge('x', 'a/y.md', 'y', 'calls')], layout: new Map(), humanEdges: [human, { ...human, id: 'e2', to: 'nope' }] });
    expect(v.edges.map((e) => [e.id, e.kind])).toEqual([
      ['fe:x->a/y.md#calls', 'file'],
      ['e1', 'human'],
    ]);
  });
});
