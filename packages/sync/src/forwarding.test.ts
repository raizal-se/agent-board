import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { FakeNetwork } from './testing/fake-network';
import { YjsSync } from './yjs-sync';
import { Presence } from './awareness';

function peer(net: FakeNetwork, id: string, forward = true) {
  const doc = new Y.Doc();
  const t = net.join(id);
  const sync = new YjsSync(doc, t, { forward });
  const text = doc.getText('t');
  return { id, doc, t, sync, text };
}
type Peer = ReturnType<typeof peer>;
const state = (p: Peer) => Y.encodeStateAsUpdate(p.doc);
const allEqual = (ps: Peer[]) => ps.every((p) => p.text.toString() === ps[0]!.text.toString());

describe('two peers', () => {
  it('sync a change and a late joiner gets the full state', async () => {
    const net = new FakeNetwork();
    const a = peer(net, 'A');
    const b = peer(net, 'B');
    await net.settle();
    a.text.insert(0, 'hello');
    await net.settle();
    expect(b.text.toString()).toBe('hello');
    const late = peer(net, 'L');
    await net.settle();
    expect(late.text.toString()).toBe('hello');
  });
});

describe('three peers, A to C blocked', () => {
  it('control: without forwarding, a change from A never reaches C', async () => {
    const net = new FakeNetwork();
    net.block('A', 'C');
    const [a, b, c] = ['A', 'B', 'C'].map((id) => peer(net, id, false)) as [Peer, Peer, Peer];
    await net.settle();
    expect(a.t.peers()).toEqual(['B']);
    expect(c.t.peers()).toEqual(['B']);
    a.text.insert(0, 'from A');
    await net.settle();
    expect(b.text.toString()).toBe('from A');
    expect(c.text.toString()).toBe('');
  });

  it('with forwarding, a change from A reaches C through B', async () => {
    const net = new FakeNetwork();
    net.block('A', 'C');
    const [a, b, c] = ['A', 'B', 'C'].map((id) => peer(net, id)) as [Peer, Peer, Peer];
    await net.settle();
    const arrivedFrom: string[] = [];
    c.sync.onRemoteUpdate((_u, from) => arrivedFrom.push(from));
    a.text.insert(0, 'from A');
    await net.settle();
    expect(c.text.toString()).toBe('from A');
    expect(arrivedFrom).toEqual(['B']);
    // and back: C to A through B
    c.text.insert(c.text.length, ', from C');
    await net.settle();
    expect(a.text.toString()).toBe('from A, from C');
    expect(b.sync.stats.forwarded).toBe(2);
    expect(allEqual([a, b, c])).toBe(true);
  });

  it('presence (awareness) of A reaches C through B', async () => {
    const net = new FakeNetwork();
    net.block('A', 'C');
    const ts = ['A', 'B', 'C'].map((id) => net.join(id));
    const ps = ts.map((t) => new Presence(t, { name: t.selfId }, { heartbeatMs: 60_000 }));
    await net.settle();
    ps[0]!.setState({ name: 'A', cursor: 3 });
    await net.settle();
    const aOnC = ps[2]!.entries.get('A');
    expect(aOnC?.state).toEqual({ name: 'A', cursor: 3 });
    expect(aOnC?.via).toBe('B');
    ps.forEach((p) => p.destroy());
  });
});

describe('loops do no harm', () => {
  for (const n of [3, 5]) {
    it(`full mesh of ${n}: each change is applied once per peer and docs converge`, async () => {
      const net = new FakeNetwork();
      const ids = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
      const ps = ids.map((id) => peer(net, id));
      await net.settle();
      const before = net.delivered;
      const dupBefore = ps.reduce((s, p) => s + p.sync.stats.duplicates, 0); // empty join replies
      const appliedBefore = ps.map((p) => p.sync.stats.applied);
      const edits = 20;
      for (let i = 0; i < edits; i++) {
        const p = ps[i % n]!;
        p.text.insert(Math.floor(p.text.length / 2), `${p.id}${i};`);
        await net.settle();
      }
      expect(allEqual(ps)).toBe(true);
      for (const p of ps) {
        // every edit made elsewhere was applied exactly once here
        const madeHere = Math.ceil((edits - ids.indexOf(p.id)) / n);
        expect(p.sync.stats.applied - appliedBefore[ps.indexOf(p)]!).toBe(edits - madeHere);
      }
      // Message cost per edit in a full mesh: (n-1) direct + (n-1)(n-2) forwards, then it stops.
      expect(net.delivered - before).toBe(edits * ((n - 1) + (n - 1) * (n - 2)));
      const dup = ps.reduce((s, p) => s + p.sync.stats.duplicates, 0);
      expect(dup - dupBefore).toBe(edits * (n - 1) * (n - 2));
    });
  }

  it('concurrent edits in a mesh with one broken pair converge and the network goes quiet', async () => {
    const net = new FakeNetwork();
    net.block('A', 'C');
    net.block('B', 'D');
    const ps = ['A', 'B', 'C', 'D'].map((id) => peer(net, id));
    await net.settle();
    // No settle between edits: everything races.
    for (let i = 0; i < 50; i++) {
      const p = ps[(i * 7) % 4]!;
      if (i % 5 === 4 && p.text.length > 2) p.text.delete(0, 2);
      else p.text.insert(i % (p.text.length + 1), `${p.id}${i}`);
    }
    await net.settle();
    expect(allEqual(ps)).toBe(true);
    const ref = state(ps[0]!);
    for (const p of ps) expect(Y.encodeStateVector(p.doc)).toEqual(Y.encodeStateVector(ps[0]!.doc));
    expect(ref.length).toBeGreaterThan(0);
    expect(net.inFlight).toBe(0);
  });

  it('a line A-B-C-D: a change from A reaches D over three hops', async () => {
    const net = new FakeNetwork();
    net.block('A', 'C');
    net.block('A', 'D');
    net.block('B', 'D');
    const ps = ['A', 'B', 'C', 'D'].map((id) => peer(net, id));
    await net.settle();
    ps[0]!.text.insert(0, 'far');
    await net.settle();
    expect(ps[3]!.text.toString()).toBe('far');
  });
});
