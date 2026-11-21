import { existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileEdgesOf, layoutMap } from '@agent-board/model';
import { afterEach, describe, expect, it } from 'vitest';
import { startBoard, type RunningBoard } from './board';
import { DOC_FILE, loadDoc, STATE_DIR } from './store';
import { connectTab, fakeWebDir, itemAt, tempDir, until, write } from './test-helpers';

const identity = { name: 'dewi', side: 'product' as const };
const cleanup: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

async function board(folder: string): Promise<RunningBoard> {
  // Polling: native FSEvents watching fails with EMFILE inside the agent sandbox.
  const b = await startBoard({ folder, identity, port: 0, webDir: fakeWebDir(), poll: true });
  cleanup.push(() => b.stop());
  await b.ready;
  return b;
}

async function tab(port: number) {
  const t = connectTab(port);
  cleanup.push(() => t.close());
  await until(() => t.transport.status === 'online', 3000, 'tab online');
  return t;
}

describe('agent-board watch (real folder, real WebSocket)', () => {
  it('streams files to a tab, live, with frames from subfolders', async () => {
    const folder = tempDir('ab-folder-');
    write(folder, 'readme.md', '# Root');
    write(folder, 'checkout/flow.md', '# Flow v1');
    write(folder, 'notes.txt', 'not a block');
    write(folder, '.hidden/x.md', 'ignored');
    const b = await board(folder);
    const t = await tab(b.server.port);

    await until(() => itemAt(t.doc, 'checkout/flow.md'), 3000, 'initial sync');
    expect(itemAt(t.doc, 'readme.md')?.frame).toBe(`frame:${folder.split('/').pop()}`);
    expect(itemAt(t.doc, 'checkout/flow.md')?.frame).toBe('frame:checkout');
    expect(itemAt(t.doc, 'notes.txt')).toBeUndefined();
    expect(itemAt(t.doc, '.hidden/x.md')).toBeUndefined();

    const start = Date.now();
    write(folder, 'checkout/flow.md', '# Flow v2');
    await until(() => itemAt(t.doc, 'checkout/flow.md')?.text === '# Flow v2', 3000, 'live update');
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('rename keeps the block id, position and edges', async () => {
    const folder = tempDir('ab-folder-');
    write(folder, 'a.md', '---\nlinks:\n  - to: b.md\n    label: uses\n---\nA');
    write(folder, 'b.md', 'B body');
    const b = await board(folder);
    const t = await tab(b.server.port);
    const before = await until(() => itemAt(t.doc, 'b.md'), 3000, 'b.md');
    const pos = layoutMap(t.doc).get(before.id);

    renameSync(join(folder, 'b.md'), join(folder, 'b-renamed.md'));
    await until(() => itemAt(t.doc, 'b-renamed.md'), 3000, 'rename');
    await new Promise((r) => setTimeout(r, 1300)); // past the rename window
    const after = itemAt(t.doc, 'b-renamed.md')!;
    expect(after.id).toBe(before.id);
    expect(after.gone).toBe(false);
    expect(itemAt(t.doc, 'b.md')).toBeUndefined();
    expect(layoutMap(t.doc).get(after.id)).toEqual(pos);
    expect(fileEdgesOf(t.doc, itemAt(t.doc, 'a.md')!.id)[0]?.to).toBe(before.id);
  });

  it('a deleted file goes gone and comes back in the same place', async () => {
    const folder = tempDir('ab-folder-');
    write(folder, 'a.md', 'A');
    const b = await board(folder);
    const t = await tab(b.server.port);
    const a = await until(() => itemAt(t.doc, 'a.md'), 3000, 'a.md');
    rmSync(join(folder, 'a.md'));
    await until(() => itemAt(t.doc, 'a.md')?.gone, 4000, 'gone');
    write(folder, 'a.md', 'A is back');
    await until(() => itemAt(t.doc, 'a.md')?.gone === false, 3000, 'back');
    expect(itemAt(t.doc, 'a.md')?.id).toBe(a.id);
  });

  it('links: add draws an edge, a missing target waits, removing deletes', async () => {
    const folder = tempDir('ab-folder-');
    write(folder, 'a.md', 'A');
    write(folder, 'ui/page.html', '<meta name="board:link" content="a.md | shows">');
    const b = await board(folder);
    const t = await tab(b.server.port);
    const a = await until(() => itemAt(t.doc, 'a.md'), 3000, 'a.md');
    const page = await until(() => itemAt(t.doc, 'ui/page.html'), 3000, 'page');
    await until(() => fileEdgesOf(t.doc, page.id)[0]?.to === a.id, 3000, 'html edge');

    write(folder, 'a.md', '---\nlinks:\n  - to: later.md\n---\nA');
    await until(() => fileEdgesOf(t.doc, a.id)[0]?.toPath === 'later.md', 3000, 'waiting edge');
    expect(fileEdgesOf(t.doc, a.id)[0]?.to).toBeNull();
    write(folder, 'later.md', 'L');
    await until(() => fileEdgesOf(t.doc, a.id)[0]?.to, 3000, 'resolved edge');

    write(folder, 'a.md', 'no links');
    await until(() => fileEdgesOf(t.doc, a.id).length === 0, 3000, 'edge removed');
  });

  it('saves the doc and survives a restart: ids, layout from the tab, gone while off', async () => {
    const folder = tempDir('ab-folder-');
    write(folder, 'a.md', 'A');
    write(folder, 'b.md', 'B');
    const b1 = await board(folder);
    const t1 = await tab(b1.server.port);
    const a = await until(() => itemAt(t1.doc, 'a.md'), 3000, 'a.md');
    // The tab drags the block: it writes layout, the CLI must keep it.
    layoutMap(t1.doc).set(a.id, { x: 777, y: 555 });
    await until(() => layoutMap(loadDoc(join(folder, STATE_DIR, DOC_FILE))).get(a.id)?.x === 777, 3000, 'saved to disk');
    await t1.close();
    await b1.stop();
    cleanup.length = 0;

    rmSync(join(folder, 'b.md')); // deleted while the board is off
    const b2 = await board(folder);
    const t2 = await tab(b2.server.port);
    await until(() => itemAt(t2.doc, 'a.md'), 3000, 'reload');
    expect(itemAt(t2.doc, 'a.md')?.id).toBe(a.id);
    expect(layoutMap(t2.doc).get(a.id)).toMatchObject({ x: 777, y: 555 });
    expect(itemAt(t2.doc, 'b.md')?.gone).toBe(true);
    expect(existsSync(join(folder, STATE_DIR, DOC_FILE))).toBe(true);
  });
});
