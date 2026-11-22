import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../../cli/bin/agent-board.mjs', import.meta.url));

export function tempDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

export async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });
}

export interface Proc {
  out(): string;
  stop(): Promise<void>;
}

function run(args: string[], env: Record<string, string>, ready: RegExp): Promise<Proc & { match: RegExpExecArray }> {
  const child: ChildProcess = spawn(process.execPath, [BIN, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  let out = '';
  child.stdout!.on('data', (d) => (out += d));
  child.stderr!.on('data', (d) => (out += d));
  return new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error(`agent-board ${args[0]} did not start:\n${out}`)), 20_000);
    const check = () => {
      const m = ready.exec(out);
      if (m) {
        clearTimeout(t);
        ok({
          match: m,
          out: () => out,
          stop: () =>
            new Promise<void>((done) => {
              if (child.exitCode !== null) return done();
              child.once('exit', () => done());
              child.kill('SIGTERM');
            }),
        });
      }
    };
    child.stdout!.on('data', check);
    child.once('exit', (code) => fail(new Error(`agent-board ${args[0]} exited ${code}:\n${out}`)));
  });
}

/** `agent-board app`: the web app alone, the page an invite link opens. */
export async function startApp(): Promise<Proc & { url: string }> {
  const p = await run(['app', '--port', String(await freePort())], {}, /Web app: (http:\/\/\S+)/);
  return { ...p, url: p.match[1]! };
}

/** The host: a CLI on its folder, shared with `invite`, then `watch`. Its device key lives in `home`. */
export class HostCli {
  readonly folder = join(tempDir('ab-peers-'), 'payments');
  readonly home = tempDir('ab-home-');
  link = '';
  url = '';
  private proc: Proc | undefined;
  private port = 0;

  constructor(
    private readonly relay: string,
    private readonly appUrl: string,
  ) {}

  write(path: string, text: string) {
    const abs = join(this.folder, ...path.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }

  private get env() {
    return { AGENT_BOARD_HOME: this.home, AGENT_BOARD_RELAYS: this.relay };
  }

  invite(): string {
    const out = execFileSync(process.execPath, [BIN, 'invite', this.folder, '--app-url', this.appUrl], { env: { ...process.env, ...this.env }, encoding: 'utf8' });
    this.link = out.split('\n')[0]!.trim();
    return this.link;
  }

  async start() {
    this.port ||= await freePort();
    const p = await run(['watch', this.folder, '--port', String(this.port), '--name', 'Raizal', '--side', 'engineering'], this.env, /Board: (http:\/\/\S+)/);
    this.url = p.match[1]!;
    this.proc = p;
  }

  out() {
    return this.proc?.out() ?? '';
  }

  async stop() {
    await this.proc?.stop();
    this.proc = undefined;
  }
}
