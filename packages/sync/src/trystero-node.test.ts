/**
 * Real Trystero + real WebRTC (node-datachannel) + a local Nostr relay, one process per peer.
 * Proves the Trystero wiring of the sync layer and forwarding over real data channels.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startLocalNostrRelay, type LocalRelay } from './testing/local-nostr-relay';

const req = createRequire(new URL('../../../apps/cli/package.json', import.meta.url));
const tsxLoader = req.resolve('tsx');
const peerScript = fileURLToPath(new URL('./testing/node-peer.ts', import.meta.url));
const boardPeerScript = fileURLToPath(new URL('./testing/node-board-peer.ts', import.meta.url));

interface Peer {
  name: string;
  proc: ChildProcess;
  events: any[];
  send(cmd: object): void;
  waitFor(pred: (e: any) => boolean, ms?: number): Promise<any>;
}

function startPeer(relay: string, secret: string, name: string, block?: string): Peer {
  return spawnPeer(name, [peerScript, relay, secret, name, ...(block ? [block] : [])]);
}

function spawnPeer(name: string, args: string[]): Peer {
  const proc = spawn(process.execPath, ['--import', tsxLoader, ...args], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const events: any[] = [];
  const waiters = new Set<() => void>();
  createInterface({ input: proc.stdout! }).on('line', (l) => {
    try {
      events.push(JSON.parse(l));
    } catch {
      return; // stray library log
    }
    for (const w of waiters) w();
  });
  return {
    name,
    proc,
    events,
    send: (c) => proc.stdin!.write(JSON.stringify(c) + '\n'),
    waitFor(pred, ms = 20_000) {
      return new Promise((resolve, reject) => {
        const check = () => {
          const hit = events.find(pred);
          if (hit) {
            waiters.delete(check);
            clearTimeout(timer);
            resolve(hit);
          }
        };
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(new Error(`${name}: timed out; last events ${JSON.stringify(events.slice(-5))}`));
        }, ms);
        waiters.add(check);
        check();
      });
    },
  };
}

let relay: LocalRelay;
const peers: Peer[] = [];
beforeAll(async () => {
  relay = await startLocalNostrRelay();
});
afterAll(async () => {
  for (const p of peers) p.proc.kill();
  await relay?.close();
});

describe('Trystero over a local Nostr relay, real WebRTC in Node', () => {
  it('two peers connect and sync a change', async () => {
    const secret = 'two-' + Math.random();
    const a = startPeer(relay.url, secret, 'A');
    const b = startPeer(relay.url, secret, 'B');
    peers.push(a, b);
    await a.waitFor((e) => e.ev === 'presence' && e.direct.includes('B'));
    await b.waitFor((e) => e.ev === 'presence' && e.direct.includes('A'));
    const t = performance.now();
    a.send({ cmd: 'insert', text: 'hello from A' });
    const got = await b.waitFor((e) => e.ev === 'update' && e.text === 'hello from A');
    console.log(`two peers: change arrived in ${Math.round(performance.now() - t)} ms (incl. process stdio)`);
    expect(got.from).toBe('A');
  }, 60_000);

  it('three peers, A-C blocked: a change from A reaches C through B', async () => {
    const secret = 'three-' + Math.random();
    const a = startPeer(relay.url, secret, 'A', 'C');
    const b = startPeer(relay.url, secret, 'B');
    const c = startPeer(relay.url, secret, 'C', 'A');
    peers.push(a, b, c);
    await a.waitFor((e) => e.ev === 'presence' && e.blocked.includes('C') && e.direct.join() === 'B');
    await c.waitFor((e) => e.ev === 'presence' && e.blocked.includes('A') && e.direct.join() === 'B');
    a.send({ cmd: 'insert', text: 'A->C' });
    const got = await c.waitFor((e) => e.ev === 'update' && e.text.includes('A->C'));
    expect(got.from).toBe('B');
    c.send({ cmd: 'insert', text: ' C->A' });
    const back = await a.waitFor((e) => e.ev === 'update' && e.text.includes('C->A'));
    expect(back.from).toBe('B');
    for (const p of [a, b, c]) p.send({ cmd: 'state' });
    const states = await Promise.all([a, b, c].map((p) => p.waitFor((e) => e.ev === 'state')));
    expect(new Set(states.map((s) => s.text)).size).toBe(1);
    console.log('three peers stats', JSON.stringify(states.map((s, i) => ({ peer: 'ABC'[i], ...s.stats }))));
  }, 60_000);
});

describe('BoardPeer over real WebRTC', () => {
  it('a guest asks, the host approves with one click, the hello is bound to the link, and both sync', async () => {
    const secret = 'board-' + Math.random();
    const host = spawnPeer('host', [boardPeerScript, relay.url, secret, 'host', 'Raizal', 'engineering']);
    peers.push(host);
    const { root } = await host.waitFor((e) => e.ev === 'ready');
    const guest = spawnPeer('guest', [boardPeerScript, relay.url, secret, 'guest', 'Dewi', 'product', root]);
    peers.push(guest);
    await host.waitFor((e) => e.ev === 'state' && e.requests.includes('Dewi'), 30_000);
    await guest.waitFor((e) => e.ev === 'state' && e.join === 'waiting');
    host.send({ cmd: 'approve' });
    const inState = await guest.waitFor((e) => e.ev === 'state' && e.join === 'in');
    // Both ends read the same DTLS fingerprints from the link.
    const hostState = await host.waitFor((e) => e.ev === 'state' && e.bindings.length === 1);
    expect(inState.bindings[0]).toMatch(/^sha-256 [0-9a-f:]+\|sha-256 [0-9a-f:]+$/);
    expect(hostState.bindings[0]).toBe(inState.bindings[0]);
    host.send({ cmd: 'insert', text: 'from Raizal' });
    await guest.waitFor((e) => e.ev === 'state' && e.text === 'from Raizal');
    guest.send({ cmd: 'insert', text: ', from Dewi' });
    await host.waitFor((e) => e.ev === 'state' && e.text === 'from Raizal, from Dewi');
    await host.waitFor((e) => e.ev === 'state' && e.online.includes('Dewi'));
  }, 90_000);
});
