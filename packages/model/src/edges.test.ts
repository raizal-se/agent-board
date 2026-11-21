import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { edgesMap, fileEdgeId, fileEdgesOf, resolveEdgesTo, syncFileEdges } from './edges';
import { createBoardDoc } from './index';

const A = 'f_a';

describe('syncFileEdges', () => {
  it('adding a link creates an edge from the file that holds it', () => {
    const doc = createBoardDoc();
    syncFileEdges(doc, A, [{ to: 'checkout/api.md', label: 'calls' }], () => 'f_api');
    expect(fileEdgesOf(doc, A)).toEqual([
      { id: fileEdgeId(A, 'checkout/api.md', 'calls'), source: 'file', from: A, toPath: 'checkout/api.md', to: 'f_api', label: 'calls' },
    ]);
  });

  it('a link to a missing file is kept with no target', () => {
    const doc = createBoardDoc();
    syncFileEdges(doc, A, [{ to: 'later.md', label: '' }]);
    expect(fileEdgesOf(doc, A)[0]).toMatchObject({ toPath: 'later.md', to: null });
  });

  it('removing the link deletes the edge', () => {
    const doc = createBoardDoc();
    syncFileEdges(doc, A, [{ to: 'x.md', label: '' }, { to: 'y.md', label: '' }]);
    const r = syncFileEdges(doc, A, [{ to: 'y.md', label: '' }]);
    expect(r.removed).toEqual([fileEdgeId(A, 'x.md', '')]);
    expect(fileEdgesOf(doc, A).map((e) => e.toPath)).toEqual(['y.md']);
    syncFileEdges(doc, A, []);
    expect(fileEdgesOf(doc, A)).toEqual([]);
  });

  it('a changed label is a new edge and the old one goes', () => {
    const doc = createBoardDoc();
    syncFileEdges(doc, A, [{ to: 'x.md', label: 'calls' }]);
    syncFileEdges(doc, A, [{ to: 'x.md', label: 'reads' }]);
    expect(fileEdgesOf(doc, A).map((e) => e.label)).toEqual(['reads']);
  });

  it('never touches edges owned by another file or drawn by a human', () => {
    const doc = createBoardDoc();
    const B = 'f_b';
    syncFileEdges(doc, B, [{ to: 'x.md', label: '' }]);
    edgesMap(doc).set('h1', { id: 'h1', source: 'human', from: A, to: 'f_x', label: '' } as never);
    syncFileEdges(doc, A, [{ to: 'x.md', label: '' }]);
    syncFileEdges(doc, A, []);
    expect(edgesMap(doc).has('h1')).toBe(true);
    expect(fileEdgesOf(doc, B)).toHaveLength(1);
  });

  it('a save without link changes writes no update', () => {
    const doc = createBoardDoc();
    syncFileEdges(doc, A, [{ to: 'x.md', label: '' }], () => 'f_x');
    let updates = 0;
    doc.on('update', () => updates++);
    syncFileEdges(doc, A, [{ to: 'x.md', label: '' }], () => 'f_x');
    expect(updates).toBe(0);
  });

  it('a resolved edge keeps its target when the target path no longer resolves (target renamed)', () => {
    const doc = createBoardDoc();
    syncFileEdges(doc, A, [{ to: 'x.md', label: '' }], () => 'f_x');
    syncFileEdges(doc, A, [{ to: 'x.md', label: '' }], () => null);
    expect(fileEdgesOf(doc, A)[0]?.to).toBe('f_x');
  });

  it('add and remove reach a second doc', () => {
    const a = createBoardDoc();
    const b = createBoardDoc();
    a.on('update', (u: Uint8Array) => Y.applyUpdate(b, u));
    syncFileEdges(a, A, [{ to: 'x.md', label: 'calls' }]);
    expect(fileEdgesOf(b, A)).toHaveLength(1);
    syncFileEdges(a, A, []);
    expect(fileEdgesOf(b, A)).toHaveLength(0);
  });
});

describe('resolveEdgesTo', () => {
  it('points waiting edges at the new block, and only those', () => {
    const doc = createBoardDoc();
    syncFileEdges(doc, A, [{ to: 'later.md', label: '' }, { to: 'other.md', label: '' }]);
    expect(resolveEdgesTo(doc, 'later.md', 'f_later')).toBe(1);
    const byPath = Object.fromEntries(fileEdgesOf(doc, A).map((e) => [e.toPath, e.to]));
    expect(byPath).toEqual({ 'later.md': 'f_later', 'other.md': null });
  });
});
