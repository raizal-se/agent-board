import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { membersMap } from './board-maps';
import { checkHelloProof, devicePk, helloProof, newDeviceKey, newNonce, type DeviceKey } from './device';
import { makeRoot, rootOf } from './members';
import { BoardPeer, type PeerMe } from './peer';
import { RATE_PER_MINUTE } from './requests';
import { FakeNetwork } from './testing/fake-network';

const peers: BoardPeer[] = [];
afterEach(() => {
  for (const p of peers.splice(0)) p.destroy();
  vi.useRealTimers();
});

let n = 0;
function node(net: FakeNetwork, me: PeerMe, root: string, opts: { doc?: Y.Doc; device?: DeviceKey; onRejected?: () => void; rejoinAfterMs?: number; id?: string } = {}) {
  const doc = opts.doc ?? new Y.Doc();
  const device = opts.device ?? newDeviceKey();
  const base = opts.id ?? me.name;
  const p = new BoardPeer({
    doc,
    device,
    me: { ...me },
    root,
    connect: async () => net.join(`${base}#${++n}`),
    onRejected: opts.onRejected,
    rejoinAfterMs: opts.rejoinAfterMs ?? 60_000,
    presenceHeartbeatMs: 60_000,
  });
  peers.push(p);
  return { p, doc, device };
}

async function host(net: FakeNetwork) {
  const doc = new Y.Doc();
  doc.getMap('meta').set('id', 'board-0001');
  const device = newDeviceKey();
  makeRoot(doc, device, { name: 'Raizal', side: 'engineering', kind: 'cli' }, 1);
  const h = node(net, { name: 'Raizal', side: 'engineering', kind: 'cli' }, devicePk(device), { doc, device });
  await h.p.start();
  return { ...h, root: devicePk(device) };
}

async function guest(net: FakeNetwork, root: string, name = 'Dewi', side: PeerMe['side'] = 'product', extra: Parameters<typeof node>[3] = {}) {
  const g = node(net, { name, side, kind: 'browser' }, root, extra);
  await g.p.start();
  return g;
}

const text = (doc: Y.Doc) => doc.getText('t').toString();

describe('join with one click', () => {
  it('the guest asks, the host approves, both sync and see each other', async () => {
    const net = new FakeNetwork();
    const h = await host(net);
    h.doc.getText('t').insert(0, 'board');
    const g = await guest(net, h.root);
    await net.settle();
    expect(g.p.state().join).toEqual({ step: 'waiting', by: ['Raizal'] });
    expect(text(g.doc)).toBe('');
    const [req] = h.p.state().requests;
    expect(req).toMatchObject({ name: 'Dewi', side: 'product', kind: 'browser', pk: devicePk(g.device) });
    expect(req!.fingerprint).toMatch(/^[0-9a-f]{4} [0-9a-f]{4}$/);

    expect(h.p.approve(req!.pk)).toBe(true);
    await net.settle();
    expect(g.p.state().join).toEqual({ step: 'in' });
    expect(text(g.doc)).toBe('board');
    expect(rootOf(g.doc)).toBe(h.root);
    g.doc.getText('t').insert(5, '!');
    await net.settle();
    expect(text(h.doc)).toBe('board!');
    expect(h.p.state().online.map((o) => [o.name, o.via])).toEqual([['Dewi', null]]);
    expect(g.p.state().online.map((o) => o.name)).toEqual(['Raizal']);
    expect(h.p.state().requests).toEqual([]);
  });

  it('a denied guest gets nothing', async () => {
    const net = new FakeNetwork();
    const h = await host(net);
    h.doc.getText('t').insert(0, 'secret plan');
    const g = await guest(net, h.root);
    await net.settle();
    h.p.deny(devicePk(g.device));
    await net.settle();
    expect(g.p.state().join).toEqual({ step: 'denied', by: 'Raizal' });
    h.doc.getText('t').insert(0, 'more ');
    await net.settle();
    expect(text(g.doc)).toBe('');
    expect(g.p.state().online).toEqual([]);
    expect(membersMap(h.doc).has(devicePk(g.device))).toBe(false);
  });

  it('one request per guest device, and at most 5 new requests a minute', async () => {
    const net = new FakeNetwork();
    const h = await host(net);
    const device = newDeviceKey();
    await guest(net, h.root, 'Dewi', 'product', { device, id: 'dewi-tab-1' });
    await guest(net, h.root, 'Dewi', 'product', { device, id: 'dewi-tab-2' });
    await net.settle();
    expect(h.p.state().requests).toHaveLength(1);
    for (let i = 0; i < RATE_PER_MINUTE + 2; i++) await guest(net, h.root, `Guest ${i}`);
    await net.settle();
    expect(h.p.state().requests).toHaveLength(RATE_PER_MINUTE);
  });

  it('names are cleaned; a name already on the board is flagged', async () => {
    const net = new FakeNetwork();
    const h = await host(net);
    await guest(net, h.root, '  raizal​ ', 'engineering');
    await net.settle();
    expect(h.p.state().requests[0]).toMatchObject({ name: 'raizal', nameTaken: true });
  });

  it('a request goes away after 5 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const net = new FakeNetwork();
    const h = await host(net);
    await guest(net, h.root);
    await net.settle();
    expect(h.p.state().requests).toHaveLength(1);
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
    expect(h.p.state().requests).toHaveLength(0);
  });

  it('other members see who handled it ("Raizal let Dewi in")', async () => {
    const net = new FakeNetwork();
    const h = await host(net);
    const tan = await guest(net, h.root, 'Tan', 'engineering');
    await net.settle();
    h.p.approve(devicePk(tan.device));
    await net.settle();
    const dewi = await guest(net, h.root);
    await net.settle();
    expect(tan.p.state().requests.map((r) => r.name)).toEqual(['Dewi']);
    h.p.approve(devicePk(dewi.device));
    await net.settle();
    expect(tan.p.state().requests).toEqual([]);
    expect(tan.p.state().closed).toMatchObject([{ name: 'Dewi', by: 'Raizal', result: 'approved' }]);
    expect(dewi.p.state().join).toEqual({ step: 'in' });
  });

  it('an approved device rejoins after a reload with no prompt', async () => {
    const net = new FakeNetwork();
    const h = await host(net);
    const g = await guest(net, h.root);
    await net.settle();
    h.p.approve(devicePk(g.device));
    await net.settle();
    g.p.destroy();
    await net.settle();
    h.doc.getText('t').insert(0, 'while away');
    const again = await guest(net, h.root, 'Dewi', 'product', { doc: g.doc, device: g.device });
    await net.settle();
    expect(again.p.state().join).toEqual({ step: 'in' });
    expect(h.p.state().requests).toEqual([]);
    expect(text(again.doc)).toBe('while away');
  });

  it('a person with the link but another board cannot pass it off as this one', async () => {
    const net = new FakeNetwork();
    const real = newDeviceKey();
    // Mallory has the secret (is in the room) and runs a board of her own.
    const fake = new Y.Doc();
    fake.getMap('meta').set('id', 'board-0001');
    const mallory = newDeviceKey();
    makeRoot(fake, mallory, { name: 'Raizal', side: 'engineering', kind: 'cli' }, 1);
    const m = node(net, { name: 'Raizal', side: 'engineering', kind: 'cli' }, devicePk(mallory), { doc: fake, device: mallory });
    await m.p.start();
    let wiped = false;
    const g = await guest(net, devicePk(real), 'Dewi', 'product', { onRejected: () => (wiped = true) });
    await net.settle();
    m.p.approve(devicePk(g.device));
    await net.settle();
    expect(g.p.state().join).toEqual({ step: 'rejected' });
    expect(wiped).toBe(true);
  });

  it('a revoked device gets no more updates', async () => {
    const net = new FakeNetwork();
    const h = await host(net);
    const g = await guest(net, h.root);
    await net.settle();
    h.p.approve(devicePk(g.device));
    await net.settle();
    expect(h.p.revoke(devicePk(g.device))).toBe(true);
    await net.settle();
    h.doc.getText('t').insert(0, 'after');
    await net.settle();
    expect(text(g.doc)).toBe('');
    expect(h.p.state().members.map((m) => m.name)).toEqual(['Raizal']);
    expect(h.p.revoke(h.root)).toBe(false);
  });
});

describe('without the host', () => {
  it('two approved browsers sync with the CLI gone, and the CLI catches up when it is back', async () => {
    const net = new FakeNetwork();
    const h = await host(net);
    const a = await guest(net, h.root);
    const b = await guest(net, h.root, 'Tan', 'engineering');
    await net.settle();
    h.p.approve(devicePk(a.device));
    h.p.approve(devicePk(b.device));
    await net.settle();
    await h.p.stop();
    await net.settle();
    a.doc.getText('t').insert(0, 'offline work');
    await net.settle();
    expect(text(b.doc)).toBe('offline work');
    const back = node(net, { name: 'Raizal', side: 'engineering', kind: 'cli' }, h.root, { doc: h.doc, device: h.device });
    await back.p.start();
    await net.settle();
    expect(text(h.doc)).toBe('offline work');
  });

  it('a peer behind a blocked link is synced through another; the board names the peer it goes through', async () => {
    const net = new FakeNetwork();
    const h = await host(net);
    const tan = await guest(net, h.root, 'Tan', 'engineering', { id: 'tan' });
    await net.settle();
    h.p.approve(devicePk(tan.device));
    await net.settle();
    // Dewi's links to Raizal are blocked: she reaches the board through Tan.
    net.blockWhere((a, b) => a.startsWith('dewi#') && b.startsWith('Raizal#'));
    const dewi = await guest(net, h.root, 'Dewi', 'product', { id: 'dewi' });
    await net.settle();
    expect(tan.p.state().requests.map((r) => r.name)).toEqual(['Dewi']);
    tan.p.approve(devicePk(dewi.device));
    await net.settle();
    expect(dewi.p.state().join).toEqual({ step: 'in' });
    h.doc.getText('t').insert(0, 'from Raizal');
    await net.settle();
    expect(text(dewi.doc)).toBe('from Raizal');
    const seen = h.p.state().online.find((o) => o.name === 'Dewi');
    expect(seen?.via).toBe('Tan');
  });
});

describe('the reconnect check', () => {
  it('a peer seen only through others makes the board rejoin; if that does not help, it says the network blocks it', async () => {
    const net = new FakeNetwork();
    net.blockWhere((a, b) => a.startsWith('dewi#') && b.startsWith('Raizal#'));
    const h = await host(net);
    const tan = await guest(net, h.root, 'Tan', 'engineering', { id: 'tan' });
    await net.settle();
    h.p.approve(devicePk(tan.device));
    await net.settle();
    const dewi = await guest(net, h.root, 'Dewi', 'product', { id: 'dewi' });
    await net.settle();
    tan.p.approve(devicePk(dewi.device));
    await net.settle();
    // Rebuild the host with a short check time.
    h.p.destroy();
    const fast = node(net, { name: 'Raizal', side: 'engineering', kind: 'cli' }, h.root, { doc: h.doc, device: h.device, rejoinAfterMs: 40 });
    const spy = vi.spyOn(fast.p, 'rejoin');
    await fast.p.start();
    await waitFor(() => spy.mock.calls.length >= 1);
    await waitFor(() => fast.p.state().blocked.includes('Dewi'), 2_000);
    expect(fast.p.state().online.find((o) => o.name === 'Dewi')?.via).toBe('Tan');
  });
});

async function waitFor(ok: () => boolean, ms = 1_000) {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('the hello', () => {
  it('a proof made on another link does not pass', () => {
    const d = newDeviceKey();
    const nonce = newNonce();
    const sig = helloProof(d, nonce, 'sha-256 aa|sha-256 bb');
    expect(checkHelloProof(devicePk(d), nonce, 'sha-256 aa|sha-256 bb', sig)).toBe(true);
    expect(checkHelloProof(devicePk(d), nonce, 'sha-256 aa|sha-256 cc', sig)).toBe(false);
    expect(checkHelloProof(devicePk(d), newNonce(), 'sha-256 aa|sha-256 bb', sig)).toBe(false);
  });
});
