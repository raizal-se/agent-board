import { BLOCK_W, FRAME_MIN_W, type FileEdge, type FileItem, type Layout } from '@agent-board/model';
import { describe, expect, it } from 'vitest';
import { derive } from './derive';

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
    expect(d.edges[0]).toMatchObject({ source: 'x', target: 'y', label: 'calls · x.md', className: 'file-edge' });
    const x = d.nodes.find((n) => n.id === 'x')!;
    expect(x.data).toMatchObject({ missing: ['a/z.md', 'later.md'] });
  });
});
