/**
 * A shared board between CLIs over real WebRTC and a local Nostr relay. The host runs in this
 * process; each guest is a real `agent-board join` process (Trystero joins one room per process).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileItems } from '@agent-board/model';
import { startLocalNostrRelay, type LocalRelay } from '@agent-board/sync/testing/local-nostr-relay';
import { newDeviceKey } from '@agent-board/sync/peer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startBoard, type RunningBoard } from './board';
import { inviteFolder } from './commands';
import { STATE_DIR } from './store';
import { fakeWebDir, tempDir, until, write } from './test-helpers';

const tsx = createRequire(import.meta.url).resolve('tsx');
const bin = fileURLToPath(new URL('../bin/agent-board.mjs', import.meta.url));

let relay: LocalRelay;
let host: RunningBoard;
let hostFolder: string;
let link: string;
const webDir = fakeWebDir();
const procs: ChildProcess[] = [];

function guest(name: string, side: string) {
  const folder = join(tempDir('ab-guest-'), 'board');
  const out: string[] = [];
  const proc = spawn(process.execPath, ['--import', tsx, bin, 'join', link, folder, '--port', '0', '--name', name, '--side', side, '--poll'], {
    env: { ...process.env, AGENT_BOARD_HOME: tempDir('ab-home-'), AGENT_BOARD_RELAYS: relay.url, AGENT_BOARD_WEB_DIR: webDir, INIT_CWD: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  procs.push(proc);
  proc.stdout!.on('data', (d) => out.push(String(d)));
  proc.stderr!.on('data', (d) => out.push(String(d)));
  const exported = () => {
    try {
      return JSON.parse(readFileSync(join(folder, STATE_DIR, 'board.json'), 'utf8'));
    } catch {
      return undefined;
    }
  };
  return { folder, proc, text: () => out.join(''), exported };
}

const requestFrom = (name: string) => () => host.network()?.state().requests.find((r) => r.name === name);

beforeAll(async () => {
  relay = await startLocalNostrRelay();
  hostFolder = tempDir('ab-host-');
  write(hostFolder, 'spec/login.md', '# Login');
  const device = newDeviceKey();
  link = inviteFolder(hostFolder, { appUrl: 'http://127.0.0.1:4748/', device: () => device }).link;
  host = await startBoard({
    folder: hostFolder,
    identity: { name: 'Raizal', side: 'engineering' },
    port: 0,
    webDir,
    poll: true,
    device,
    relayUrls: [relay.url],
  });
  await host.ready;
  await until(() => host.network(), 10_000, 'host network');
}, 30_000);

afterAll(async () => {
  for (const p of procs) p.kill('SIGTERM');
  await host?.stop();
  await relay?.close();
});

describe('a shared board between CLIs', () => {
  it('the host approves a guest CLI with one call; both get the files of the other', async () => {
    const g = guest('Dewi', 'product');
    write(g.folder, 'notes/ideas.md', '# Ideas');
    await until(() => /Waiting for Raizal to let you in/.test(g.text()), 30_000, `guest waiting; log:\n${g.text()}`);
    const req = await until(requestFrom('Dewi'), 10_000, 'request on the host');
    expect(req.side).toBe('product');
    host.network()!.peer.approve(req.pk);
    await until(() => /You're in/.test(g.text()), 20_000, `guest in; log:\n${g.text()}`);
    // The host's file reaches the guest's board.json; the guest's file reaches the host, signed by the guest.
    await until(() => g.exported()?.items?.some((i: { path?: string }) => i.path === 'spec/login.md'), 20_000, 'host file on guest');
    const theirs = await until(() => fileItems(host.doc).find((i) => i.path === 'notes/ideas.md'), 20_000, 'guest file on host');
    expect(theirs.owner).toBe('Dewi');
    expect(theirs.device).toBe(req.pk);
    expect(g.exported().people?.map((p: { name: string }) => p.name).sort()).toEqual(['Dewi', 'Raizal']);
  }, 90_000);

  it('a denied guest CLI gets nothing of the board', async () => {
    const g = guest('Tan', 'engineering');
    const req = await until(requestFrom('Tan'), 30_000, `request from Tan; log:\n${g.text()}`);
    host.network()!.peer.deny(req.pk);
    await until(() => /said no/.test(g.text()), 20_000, `denied; log:\n${g.text()}`);
    await new Promise((r) => setTimeout(r, 1500));
    expect(g.exported()?.items?.some((i: { path?: string }) => i.path === 'spec/login.md') ?? false).toBe(false);
  }, 60_000);
});
