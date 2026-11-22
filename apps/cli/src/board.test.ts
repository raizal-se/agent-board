import { existsSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  addComment,
  addSticky,
  agree,
  agreementsMap,
  boardMap,
  changedAfterAgreement,
  fileEdgesOf,
  fileItemOf,
  frameRect,
  framesMap,
  itemsMap,
  layoutMap,
  type Rect,
  type BoardExport,
} from '@agent-board/model';
import { afterEach, describe, expect, it } from 'vitest';
import { startBoard, type RunningBoard } from './board';
import { DOC_FILE, EXPORT_FILE, loadDoc, saveDoc, STATE_DIR } from './store';
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

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** Pairs of frames that overlap, by name. */
function overlapping(doc: Parameters<typeof frameRect>[0]): string[] {
  const frames = [...framesMap(doc).values()].map((f) => ({ name: f.name, r: frameRect(doc, f.id) }));
  const out: string[] = [];
  for (let i = 0; i < frames.length; i++)
    for (let j = i + 1; j < frames.length; j++) if (overlap(frames[i]!.r, frames[j]!.r)) out.push(`${frames[i]!.name}/${frames[j]!.name}`);
  return out;
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

  it('a board saved with overlapping frames loads with no overlap, and the new places are saved', async () => {
    const folder = tempDir('ab-folder-');
    write(folder, 'checkout/flow.md', 'A');
    write(folder, 'ui/form.html', '<p>B</p>');
    write(folder, 'docs/a.md', 'C');
    const b1 = await board(folder);
    await until(() => framesMap(b1.doc).size === 3, 3000, 'three frames');
    await b1.stop();
    cleanup.length = 0;

    // Rewrite the saved board as an older, narrower layout left it: frames 300 apart, so they overlap.
    const file = join(folder, STATE_DIR, DOC_FILE);
    const old = loadDoc(file);
    const ids = [...framesMap(old).values()].sort((a, b) => a.name.localeCompare(b.name)).map((f) => f.id);
    ids.forEach((id, i) => layoutMap(old).set(id, { x: i * 300, y: 0 }));
    saveDoc(old, file);
    expect(overlapping(old)).not.toEqual([]);

    const b2 = await board(folder);
    const t2 = await tab(b2.server.port);
    await until(() => framesMap(t2.doc).size === 3, 3000, 'frames in the tab');
    expect(overlapping(b2.doc)).toEqual([]);
    expect(overlapping(t2.doc)).toEqual([]);
    await until(() => overlapping(loadDoc(file)).length === 0, 3000, 'saved to disk');
  });

  it('a frame that grows pushes the next frame clear of it', async () => {
    const folder = tempDir('ab-folder-');
    write(folder, 'a/x.md', 'A');
    write(folder, 'b/y.md', 'B');
    const b = await board(folder);
    const t = await tab(b.server.port);
    const x = await until(() => itemAt(t.doc, 'a/x.md'), 3000, 'a/x.md');
    expect(overlapping(b.doc)).toEqual([]);
    // The tab drags a block far right in frame a: a grows over b.
    layoutMap(t.doc).set(x.id, { x: 2400, y: 100 });
    await until(() => layoutMap(b.doc).get(x.id)?.x === 2400, 3000, 'drag reached the CLI');
    await until(() => overlapping(b.doc).length === 0, 3000, 'b moved clear');
    await until(() => overlapping(t.doc).length === 0, 3000, 'the tab sees it');
  });

  it('a save on an agreed block marks it changed and keeps the snapshot', async () => {
    const folder = tempDir('ab-folder-');
    write(folder, 'checkout/api.md', 'POST /intents\n');
    const b = await board(folder);
    const t = await tab(b.server.port);
    const api = await until(() => itemAt(t.doc, 'checkout/api.md'), 3000, 'api.md');
    expect(boardMap<string>(t.doc, 'meta').get('owner')).toBe('dewi');

    agree(t.doc, { text: 'Intent first', covers: [api.id], by: identity });
    await until(() => agreementsMap(b.doc).get(api.id), 3000, 'agreement at the CLI');

    write(folder, 'checkout/api.md', 'POST /intents\nGET /intents/:id\n');
    await until(() => fileItemOf(t.doc, api.id)?.text.includes('GET'), 3000, 'save in the tab');
    const a = agreementsMap(t.doc).get(api.id)!;
    expect(a.snapshot.text).toBe('POST /intents\n');
    expect(changedAfterAgreement(fileItemOf(t.doc, api.id)!, a)).toBe(true);
  });

  it('writes the JSON export after a change: stickies, comments, decisions, no position', async () => {
    const folder = tempDir('ab-folder-');
    write(folder, 'checkout/api.md', 'v1');
    const b = await board(folder);
    const t = await tab(b.server.port);
    const api = await until(() => itemAt(t.doc, 'checkout/api.md'), 3000, 'api.md');
    const file = join(folder, STATE_DIR, EXPORT_FILE);
    const read = (): BoardExport | undefined => {
      try {
        return JSON.parse(readFileSync(file, 'utf8')) as BoardExport;
      } catch {
        return undefined;
      }
    };
    await until(() => read()?.items.some((i) => i.id === api.id), 3000, 'export with the file');

    const sticky = addSticky(t.doc, { by: identity, frame: api.frame, x: 10, y: 10, text: 'idempotency key?' });
    addComment(t.doc, { target: api.id, by: identity, text: 'timeout?' });
    agree(t.doc, { text: 'Intent first', covers: [api.id], by: identity });
    const out = await until(() => {
      const o = read();
      return o && o.items.some((i) => i.id === sticky) && o.decisions.length === 1 && o.comments.length === 1 ? o : undefined;
    }, 3000, 'export with the board changes');
    expect(out.items.find((i) => i.id === api.id)).toMatchObject({ state: 'agreed', content: 'v1', snapshot: { content: 'v1' }, changed_after_agreement: false });
    expect(JSON.stringify(out)).not.toMatch(/"(x|y)":/);
    // No temp file left behind, and the watcher does not make a block of the export.
    expect(readdirSync(join(folder, STATE_DIR)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(itemAt(t.doc, `${STATE_DIR}/${EXPORT_FILE}`)).toBeUndefined();
  });

  it('stickies, comments and agreements survive a restart', async () => {
    const folder = tempDir('ab-folder-');
    write(folder, 'a.md', 'A');
    const b1 = await board(folder);
    const t1 = await tab(b1.server.port);
    const a = await until(() => itemAt(t1.doc, 'a.md'), 3000, 'a.md');
    const sticky = addSticky(t1.doc, { by: identity, frame: null, x: -400, y: 0, text: 'loose note' });
    addComment(t1.doc, { target: sticky, by: identity, text: 'on the note' });
    agree(t1.doc, { text: 'ok', covers: [a.id], by: identity });
    await until(() => agreementsMap(loadDoc(join(folder, STATE_DIR, DOC_FILE))).get(a.id), 3000, 'saved to disk');
    await t1.close();
    await b1.stop();
    cleanup.length = 0;

    const b2 = await board(folder);
    const t2 = await tab(b2.server.port);
    await until(() => itemsMap(t2.doc).get(sticky), 3000, 'sticky after restart');
    expect(itemsMap(t2.doc).get(sticky)).toMatchObject({ text: 'loose note', author: 'dewi' });
    expect([...itemsMap(t2.doc).values()].filter((i) => i.kind === 'comment')).toHaveLength(1);
    expect(agreementsMap(t2.doc).get(a.id)?.snapshot.text).toBe('A');
  });
});
