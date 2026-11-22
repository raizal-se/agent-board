import { describe, expect, it } from 'vitest';
import { agreeItem, rejectItem } from './agreement';
import { switchArea } from './area';
import { syncFileEdges } from './edges';
import { exportBoard } from './export';
import { boardMap, createBoardDoc, ensureBoardId, type Device } from './index';
import { framesMap, itemsMap, type FileItem } from './items';
import { layoutMap } from './layout';
import { addComment, addHumanEdge, addSticky, setThreadResolved, type DecisionItem, type Person } from './native';

const dewi: Person = { name: 'Dewi', side: 'product' };

function hasKey(v: unknown, keys: string[]): boolean {
  if (Array.isArray(v)) return v.some((x) => hasKey(x, keys));
  if (v && typeof v === 'object') return Object.entries(v).some(([k, x]) => keys.includes(k) || hasKey(x, keys));
  return false;
}

describe('exportBoard', () => {
  it('holds frames, items with their area and review, edges, thread entries and decisions, and no position', () => {
    const doc = createBoardDoc();
    ensureBoardId(doc);
    boardMap<string>(doc, 'meta').set('name', 'payments');
    boardMap<Device>(doc, 'devices').set('Arif', { id: 'Arif', name: 'Arif', side: 'engineering' });
    framesMap(doc).set('frame:checkout', { id: 'frame:checkout', name: 'checkout' });
    layoutMap(doc).set('frame:checkout', { x: 10, y: 20 });
    const api: FileItem = { id: 'f_api', kind: 'file', path: 'checkout/api.md', frame: 'frame:checkout', type: 'markdown', text: 'v1', hash: 'h1', owner: 'Arif', gone: false, updatedAt: 0 };
    const flow: FileItem = { ...api, id: 'f_flow', path: 'checkout/flow.md', text: 'flow', hash: 'hf' };
    itemsMap(doc).set(api.id, api);
    itemsMap(doc).set(flow.id, flow);
    layoutMap(doc).set(api.id, { x: 1, y: 2 });
    syncFileEdges(doc, flow.id, [{ to: 'checkout/api.md', label: 'calls' }], () => api.id);
    const sticky = addSticky(doc, { by: dewi, frame: null, x: 5, y: 5, text: 'idempotency?' });
    addHumanEdge(doc, { from: sticky, to: api.id, label: 'about', by: dewi });
    addComment(doc, { target: api.id, by: dewi, text: 'timeout 30s?', now: 0 });
    setThreadResolved(doc, { target: api.id, by: dewi, resolved: true, now: 0 });
    agreeItem(doc, api.id, { by: dewi, note: 'ship it', now: 1000 });
    itemsMap(doc).set(api.id, { ...api, text: 'v2', hash: 'h2' });
    const db: FileItem = { ...api, id: 'f_db', path: 'checkout/db.md', text: 'db', hash: 'hd', area: 'product' };
    itemsMap(doc).set(db.id, db);
    rejectItem(doc, db.id, { by: dewi, reason: 'no indexes', now: 0 });
    switchArea(doc, flow.id, 'product', { by: dewi, now: 0 });
    // A decision from before agree-on-the-card still exports.
    const d: DecisionItem = { id: 'd_old', kind: 'decision', text: 'Intent first', covers: [api.id], frame: 'frame:checkout', author: 'Dewi', accepts: [{ name: 'Dewi', side: 'product', at: 0 }], createdAt: 0 };
    itemsMap(doc).set(d.id, d);

    const out = exportBoard(doc);
    expect(hasKey(out, ['x', 'y', 'w', 'h', 'layout'])).toBe(false);
    expect(out.board.name).toBe('payments');
    expect(out.frames).toEqual([{ id: 'frame:checkout', name: 'checkout' }]);

    const apiOut = out.items.find((i) => i.id === api.id)!;
    expect(apiOut).toMatchObject({
      kind: 'file',
      path: 'checkout/api.md',
      state: 'agreed',
      area: 'engineering',
      area_source: 'owner side',
      area_set_by: null,
      author: "Arif's agent",
      author_kind: 'agent',
      owner: 'Arif',
      content: 'v2',
      snapshot: { content: 'v1', decision: null, accepts: [{ name: 'Dewi', side: 'product', at: '1970-01-01T00:00:01.000Z' }] },
      changed_after_agreement: true,
      review: null,
    });
    expect(out.items.find((i) => i.id === flow.id)).toMatchObject({
      state: 'draft',
      area: 'product',
      area_source: 'human',
      area_set_by: 'Dewi',
      area_set_at: '1970-01-01T00:00:00.000Z',
      snapshot: null,
      changed_after_agreement: false,
    });
    expect(out.items.find((i) => i.id === db.id)).toMatchObject({
      area: 'product',
      area_source: 'file',
      review: { state: 'changes requested', by: 'Dewi', at: '1970-01-01T00:00:00.000Z', reason: 'no indexes' },
    });
    expect(out.items.find((i) => i.id === sticky)).toMatchObject({ kind: 'sticky', author: 'Dewi', author_kind: 'human', content: 'idempotency?', area: null, frame: null });

    expect(out.edges.map((e) => [e.source, e.label])).toEqual(expect.arrayContaining([['file', 'calls'], ['human', 'about']]));
    const apiThread = out.comments.find((t) => t.target === api.id)!;
    // The agree opened the resolved thread again.
    expect(apiThread.resolved).toBe(false);
    expect(apiThread.comments).toEqual([
      expect.objectContaining({ author: 'Dewi', verdict: null, text: 'timeout 30s?', entry: 'timeout 30s?', at: '1970-01-01T00:00:00.000Z' }),
      expect.objectContaining({ author: 'Dewi', verdict: 'agree', text: 'ship it', entry: '✓ Dewi agreed: ship it' }),
    ]);
    expect(out.comments.find((t) => t.target === db.id)!.comments).toEqual([
      expect.objectContaining({ verdict: 'reject', entry: '✗ Dewi rejected: no indexes' }),
    ]);
    expect(out.decisions).toEqual([expect.objectContaining({ id: d.id, text: 'Intent first', covers: [api.id], area: 'agreed', agreed: true, accepts: [{ name: 'Dewi', side: 'product', at: '1970-01-01T00:00:00.000Z' }] })]);
    // Plain JSON: it survives a round trip.
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });
});
