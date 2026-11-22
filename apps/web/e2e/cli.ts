import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../../cli/bin/agent-board.mjs', import.meta.url));

export interface RunningCli {
  url: string;
  folder: string;
  write(path: string, text: string): void;
  remove(path: string): void;
  stop(): Promise<void>;
  log(): string;
}

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });
}

/** Start `agent-board watch` on a new temp folder holding `files`. */
export async function startCli(files: Record<string, string>, folder?: string): Promise<RunningCli> {
  const root = folder ?? join(realpathSync(mkdtempSync(join(tmpdir(), 'ab-e2e-'))), 'payments');
  const write = (path: string, text: string) => {
    const abs = join(root, ...path.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };
  mkdirSync(root, { recursive: true });
  for (const [p, t] of Object.entries(files)) write(p, t);

  const port = await freePort();
  const child: ChildProcess = spawn(process.execPath, [BIN, 'watch', root, '--port', String(port), '--name', 'e2e', '--side', 'product'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout!.on('data', (d) => (out += d));
  child.stderr!.on('data', (d) => (out += d));
  const url = await new Promise<string>((ok, fail) => {
    const t = setTimeout(() => fail(new Error(`CLI did not start:\n${out}`)), 15_000);
    const check = () => {
      const m = /Board: (http:\/\/\S+)/.exec(out);
      if (m) {
        clearTimeout(t);
        ok(m[1]!);
      }
    };
    child.stdout!.on('data', check);
    child.once('exit', (code) => fail(new Error(`CLI exited ${code}:\n${out}`)));
  });

  return {
    url,
    folder: root,
    write,
    remove: (path) => rmSync(join(root, ...path.split('/'))),
    log: () => out,
    stop: () =>
      new Promise<void>((ok) => {
        if (child.exitCode !== null) return ok();
        child.once('exit', () => ok());
        child.kill('SIGTERM');
      }),
  };
}
