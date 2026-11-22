import {
  BLOCK_W,
  FRAME_MIN_W,
  STICKY_H,
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
import { agentColor, derive } from './derive';

function item(id: string, path: string, frame: string, extra: Partial<FileItem> = {}): FileItem {
  return { id, kind: 'file', path, frame, type: 'markdown', text: '', hash: '', owner: 'me', gone: false, updatedAt: 0, ...extra };
}
function edge(from: string, toPath: string, to: string | null, label = ''): FileEdge {
  return { id: `fe:${from}->${toPath}#${label}`, source: 'file', from, toPath, to, label };
}

const frames = [{ id: 'frame:b', name: 'b' }, { id: 'frame:a', name: 'a' }];

describe('derive', () => {
  it('puts frames first, blocks inside their frame at their layout', () => {
    const layout = new Map<string, Layout>([
      ['frame:a', { x: 10, y: 20 }],
      ['x', { x: 32, y: 48 }],
    ]);
    const d = derive({ frames, items: [item('x', 'a/x.md', 'frame:a')], edges: [], layout });
    expect(d.nodes.map((n) => n.id)).toEqual(['frame:a', 'frame:b', 'x']);
    expect(d.nodes[0]).toMatchObject({ type: 'frame', position: { x: 10, y: 20 } });
    expect(d.nodes[2]).toMatchObject({ type: 'markdown', parentId: 'frame:a', position: { x: 32, y: 48 } });
  });

  it('a frame grows to hold a block dragged to its edge', () => {
    const layout = new Map<string, Layout>([['x', { x: 2000, y: 48 }]]);
    const d = derive({ frames, items: [item('x', 'a/x.md', 'frame:a')], edges: [], layout });
    const a = d.nodes.find((n) => n.id === 'frame:a')!;
    expect(a.style?.width).toBeGreaterThanOrEqual(2000 + BLOCK_W);
    expect(d.nodes.find((n) => n.id === 'frame:b')!.style?.width).toBe(FRAME_MIN_W);
  });

  it('hides gone blocks and lists them', () => {
    const d = derive({ frames, items: [item('x', 'a/x.md', 'frame:a', { gone: true })], edges: [], layout: new Map() });
    expect(d.nodes.some((n) => n.id === 'x')).toBe(false);
    expect(d.hidden.map((i) => i.path)).toEqual(['a/x.md']);
  });

  it('draws an edge only when both blocks are visible, and notes missing targets', () => {
    const items = [item('x', 'a/x.md', 'frame:a'), item('y', 'a/y.md', 'frame:a'), item('z', 'a/z.md', 'frame:a', { gone: true })];
    const edges = [edge('x', 'a/y.md', 'y', 'calls'), edge('x', 'later.md', null), edge('x', 'a/z.md', 'z')];
    const d = derive({ frames, items, edges, layout: new Map() });
    expect(d.edges).toHaveLength(1);
    expect(d.edges[0]).toMatchObject({ source: 'x', target: 'y', type: 'floating', label: 'calls', className: 'file-edge' });
    const x = d.nodes.find((n) => n.id === 'x')!;
    expect(x.data).toMatchObject({ missing: ['a/z.md', 'later.md'] });
  });

  it('file blocks carry the agent mark colour, the owner side zone, and agreed state from the agreement', () => {
    const items = [item('x', 'a/x.md', 'frame:a', { hash: 'h2', owner: 'dewi' }), item('y', 'a/y.md', 'frame:a', { hash: 'h1', owner: 'dewi' })];
    const snap = (hash: string) => ({ text: 'old', hash, type: 'markdown' as const, at: 1 });
    const agreements = new Map<string, Agreement>([
      ['x', { item: 'x', decision: 'd1', snapshot: snap('h1'), accepts: [] }],
      ['y', { item: 'y', decision: 'd1', snapshot: snap('h1'), accepts: [] }],
    ]);
    const devices = new Map([['dewi', { id: 'dewi', name: 'dewi', side: 'engineering' as const }]]);
    const plain = derive({ frames, items, edges: [], layout: new Map(), devices });
    expect(plain.nodes.find((n) => n.id === 'x')!.data).toMatchObject({ zone: 'engineering', changed: false, agentColor: agentColor('dewi') });

    const d = derive({ frames, items, edges: [], layout: new Map(), devices, agreements });
    expect(d.nodes.find((n) => n.id === 'x')!.data).toMatchObject({ zone: 'agreed', changed: true });
    expect(d.nodes.find((n) => n.id === 'y')!.data).toMatchObject({ zone: 'agreed', changed: false });
    // Kept against this version: no mark.
    agreements.set('x', { ...agreements.get('x')!, keptHash: 'h2' });
    expect(derive({ frames, items, edges: [], layout: new Map(), agreements }).nodes.find((n) => n.id === 'x')!.data).toMatchObject({ changed: false });
  });

  it('notes sit in their frame or on their own, above blocks; a frame grows to hold one', () => {
    const sticky = (id: string, frame: string | null): StickyItem => ({ id, kind: 'sticky', text: 'hi', frame, author: 'dewi', side: 'product', createdAt: 1, updatedAt: 1 });
    const layout = new Map<string, Layout>([['in', { x: 3000, y: 100 }], ['out', { x: -500, y: -50 }]]);
    const d = derive({ frames, items: [], edges: [], layout, stickies: [sticky('in', 'frame:a'), sticky('out', null), sticky('lost', 'frame:gone')] });
    const inside = d.nodes.find((n) => n.id === 'in')!;
    expect(inside).toMatchObject({ type: 'sticky', parentId: 'frame:a', position: { x: 3000, y: 100 }, zIndex: 2 });
    expect(d.nodes.find((n) => n.id === 'out')!.parentId).toBeUndefined();
    expect(d.nodes.find((n) => n.id === 'lost')!.parentId).toBeUndefined();
    const a = d.nodes.find((n) => n.id === 'frame:a')!;
    expect(a.style?.width).toBeGreaterThanOrEqual(3000 + 200);
    expect(a.style?.height).toBeGreaterThanOrEqual(100 + STICKY_H);
    expect(a.data).toHaveProperty('zones.agreed');
  });

  it('decisions show the paths they cover; pins count comments and show a resolved thread', () => {
    const decision: DecisionItem = { id: 'd1', kind: 'decision', frame: 'frame:a', text: 'ok', covers: ['x'], accepts: [{ name: 'dewi', side: 'product', at: 1 }], author: 'dewi', createdAt: 1 };
    const comment = (id: string, target: string): CommentItem => ({ id, kind: 'comment', target, author: 'dewi', text: 't', at: 1 });
    const d = derive({
      frames,
      items: [item('x', 'a/x.md', 'frame:a')],
      edges: [],
      layout: new Map(),
      decisions: [decision],
      comments: [comment('c1', 'x'), comment('c2', 'x'), comment('c3', 'd1')],
      threads: new Map([['d1', { id: 'thread:d1', kind: 'thread', target: 'd1', resolved: true }]]),
    });
    expect(d.nodes.find((n) => n.id === 'd1')).toMatchObject({ type: 'decision', parentId: 'frame:a', data: { covers: ['a/x.md'], pin: { count: 1, resolved: true } } });
    expect(d.nodes.find((n) => n.id === 'x')!.data).toMatchObject({ pin: { count: 2, resolved: false } });
  });

  it('a drawn edge is solid and selectable; a file edge is dotted, names its file, and is not', () => {
    const items = [item('x', 'a/x.md', 'frame:a'), item('y', 'a/y.md', 'frame:a')];
    const human: HumanEdge = { id: 'e1', source: 'human', from: 'y', to: 'x', label: 'depends on', author: 'dewi', createdAt: 1 };
    const d = derive({ frames, items, edges: [edge('x', 'a/y.md', 'y', 'calls')], layout: new Map(), humanEdges: [human, { ...human, id: 'e2', to: 'nope' }] });
    expect(d.edges).toHaveLength(2);
    const [file, drawn] = d.edges;
    expect(file).toMatchObject({ selectable: false, data: { kind: 'file', file: 'x.md' }, style: { strokeDasharray: '2 5' } });
    expect(drawn).toMatchObject({ id: 'e1', selectable: true, label: 'depends on', className: 'human-edge', data: { kind: 'human' } });
    expect(drawn!.style).not.toHaveProperty('strokeDasharray');
  });
});
