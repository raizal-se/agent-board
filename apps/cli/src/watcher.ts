import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileTypeOf } from '@agent-board/formats';
import { watch } from 'chokidar';
import type { BoardWriter } from './board-writer';

export interface WatchOptions {
  /**
   * Poll instead of native events. Native watching (FSEvents) is blocked inside the agent sandbox,
   * where it fails with EMFILE; polling works everywhere.
   */
  poll?: boolean;
  log?: (line: string) => void;
}

export interface FolderWatcher {
  /** Resolves after the first scan, once blocks of deleted files are marked gone. */
  ready: Promise<void>;
  close(): Promise<void>;
}

/** Hidden files and folders (this covers `.agent-board/`, `.git/`) and `node_modules`. */
export function isIgnored(relPath: string): boolean {
  return relPath.split('/').some((part) => part.startsWith('.') || part === 'node_modules');
}

export function fileExists(folder: string): (path: string) => boolean {
  return (path) => existsSync(join(folder, ...path.split('/')));
}

/** Streams every board file in `folder` into the writer. */
export function watchFolder(writer: BoardWriter, folder: string, opts: WatchOptions = {}): FolderWatcher {
  const log = opts.log ?? (() => {});
  const rel = (abs: string) => relative(folder, abs).split(sep).join('/');
  const present = new Set<string>();
  // One queue per path, so two quick saves never apply out of order.
  const queues = new Map<string, Promise<void>>();
  const enqueue = (path: string, job: () => Promise<void> | void) => {
    const next = (queues.get(path) ?? Promise.resolve()).then(job).catch((err: Error) => log(`error ${path}: ${err.message}`));
    queues.set(path, next);
    void next.finally(() => {
      if (queues.get(path) === next) queues.delete(path);
    });
  };

  const w = watch(folder, {
    ignored: (p, stats) => {
      const r = rel(p);
      if (r === '' || r.startsWith('..')) return false;
      if (isIgnored(r)) return true;
      return stats?.isFile() ? !fileTypeOf(r) : false;
    },
    awaitWriteFinish: { stabilityThreshold: 60, pollInterval: 20 },
    ...(opts.poll ? { usePolling: true, interval: 60, binaryInterval: 300 } : {}),
  });

  const onFile = (abs: string) => {
    const path = rel(abs);
    if (!fileTypeOf(path)) return;
    present.add(path);
    enqueue(path, async () => {
      let text: string;
      try {
        text = await readFile(abs, 'utf8');
      } catch {
        return; // gone again before we could read it; the unlink event follows
      }
      const r = writer.upsert(path, text);
      if (r !== 'same') log(`${r} ${path}`);
    });
  };
  w.on('add', onFile);
  w.on('change', onFile);
  w.on('unlink', (abs) => {
    const path = rel(abs);
    present.delete(path);
    enqueue(path, () => {
      writer.unlink(path);
      log(`deleted ${path}`);
    });
  });
  w.on('error', (err) => log(`watch error: ${(err as Error).message}`));

  const ready = new Promise<void>((resolve) => {
    w.once('ready', () => {
      void Promise.all([...queues.values()]).then(() => {
        for (const path of writer.reconcile(present)) log(`gone ${path} (deleted while the board was off)`);
        resolve();
      });
    });
  });

  return {
    ready,
    close: async () => {
      await w.close();
      await Promise.all([...queues.values()]);
    },
  };
}
