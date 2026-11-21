import { edgesMap, fileEdgesOf, framesMap, itemsMap, layoutMap, createBoardDoc } from '@agent-board/model';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { BoardWriter } from './board-writer';

function setup(onDisk: Set<string> = new Set()) {
  const doc = createBoardDoc();
  const writer = new BoardWriter(doc, { owner: 'dewi', rootName: 'payments', exists: (p) => onDisk.has(p) });
  const item = (path: string) => [...itemsMap(doc).values()].find((i) => i.path === path);
  return { doc, writer, item, onDisk };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('BoardWriter', () => {
  it('a subfolder file lands in its frame, a root file in the folder frame', () => {
    const { doc, writer, item } = setup();
    expect(writer.upsert('checkout/flow.md', '# Flow')).toBe('new');
    expect(writer.upsert('readme.md', '# Hi')).toBe('new');
    expect(writer.upsert('notes.txt', 'x')).toBe('skipped');
    expect(item('checkout/flow.md')).toMatchObject({ frame: 'frame:checkout', type: 'markdown', owner: 'dewi', gone: false });
    expect(item('readme.md')?.frame).toBe('frame:payments');
    expect([...framesMap(doc).keys()].sort()).toEqual(['frame:checkout', 'frame:payments']);
    expect(item('checkout/flow.md')!.id).toMatch(/^f_/);
    expect(layoutMap(doc).get(item('checkout/flow.md')!.id)).toBeDefined();
  });

  it('a save updates the text; the same text writes nothing', () => {
    const { doc, writer, item } = setup();
    writer.upsert('a.md', 'one');
    expect(writer.upsert('a.md', 'two')).toBe('changed');
    expect(item('a.md')?.text).toBe('two');
    let updates = 0;
    doc.on('update', () => updates++);
    expect(writer.upsert('a.md', 'two')).toBe('same');
    expect(updates).toBe(0);
  });

  it('a deleted file hides after the window, keeps layout and edges, and comes back in place', () => {
    const { doc, writer, item } = setup();
    writer.upsert('a.md', '---\nlinks:\n  - to: b.md\n---\nA');
    writer.upsert('b.md', 'B');
    const id = item('a.md')!.id;
    const pos = layoutMap(doc).get(id);
    writer.unlink('a.md');
    expect(item('a.md')?.gone).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(item('a.md')?.gone).toBe(true);
    expect(fileEdgesOf(doc, id)).toHaveLength(1);
    expect(writer.upsert('a.md', 'A again')).toBe('back');
    expect(item('a.md')).toMatchObject({ id, gone: false, text: 'A again' });
    expect(layoutMap(doc).get(id)).toEqual(pos);
  });

  it('unlink then add with the same content within the window is a rename', () => {
    const { doc, writer, item } = setup();
    writer.upsert('b.md', '---\nlinks:\n  - to: a.md\n    label: uses\n---\n');
    writer.upsert('a.md', 'same text');
    const id = item('a.md')!.id;
    const pos = layoutMap(doc).get(id);
    writer.unlink('a.md');
    vi.advanceTimersByTime(500);
    expect(writer.upsert('a2.md', 'same text')).toBe('renamed');
    vi.advanceTimersByTime(2000);
    expect(item('a.md')).toBeUndefined();
    expect(item('a2.md')).toMatchObject({ id, gone: false, path: 'a2.md' });
    expect(layoutMap(doc).get(id)).toEqual(pos);
    // The edge from b.md still points at the renamed block.
    expect(fileEdgesOf(doc, item('b.md')!.id)[0]?.to).toBe(id);
  });

  it('add before unlink (old file already missing on disk) is also a rename', () => {
    const onDisk = new Set(['a.md']);
    const { writer, item } = setup(onDisk);
    writer.upsert('a.md', 'x');
    const id = item('a.md')!.id;
    onDisk.delete('a.md');
    onDisk.add('b.md');
    expect(writer.upsert('b.md', 'x')).toBe('renamed');
    writer.unlink('a.md'); // late event for the old path: ignored
    vi.advanceTimersByTime(2000);
    expect(item('b.md')).toMatchObject({ id, gone: false });
  });

  it('a copy (old file still on disk) is a new block', () => {
    const onDisk = new Set(['a.md', 'b.md']);
    const { writer, item } = setup(onDisk);
    writer.upsert('a.md', 'x');
    expect(writer.upsert('b.md', 'x')).toBe('new');
    expect(item('a.md')!.id).not.toBe(item('b.md')!.id);
  });

  it('an add with the same content after the window is a new block', () => {
    const { writer, item } = setup();
    writer.upsert('a.md', 'x');
    writer.unlink('a.md');
    vi.advanceTimersByTime(1500);
    expect(writer.upsert('c.md', 'x')).toBe('new');
    expect(item('a.md')?.gone).toBe(true);
  });

  it('a rename into another folder moves the block to that frame', () => {
    const { writer, item } = setup();
    writer.upsert('a.md', 'x');
    const id = item('a.md')!.id;
    writer.unlink('a.md');
    expect(writer.upsert('checkout/a.md', 'x')).toBe('renamed');
    expect(item('checkout/a.md')).toMatchObject({ id, frame: 'frame:checkout' });
  });

  it('links: added draws, removed deletes, missing target waits then resolves', () => {
    const { doc, writer, item } = setup();
    writer.upsert('a.md', '---\nlinks:\n  - to: later.md\n    label: next\n---\n');
    const a = item('a.md')!.id;
    expect(fileEdgesOf(doc, a)).toMatchObject([{ toPath: 'later.md', to: null, label: 'next' }]);
    writer.upsert('later.md', '# Later');
    expect(fileEdgesOf(doc, a)[0]?.to).toBe(item('later.md')!.id);
    writer.upsert('a.md', 'no links now');
    expect(fileEdgesOf(doc, a)).toEqual([]);
  });

  it('html meta links become edges', () => {
    const { doc, writer, item } = setup();
    writer.upsert('db.md', '# DB');
    writer.upsert('ui/page.html', '<meta name="board:link" content="db.md | reads">');
    expect(fileEdgesOf(doc, item('ui/page.html')!.id)).toMatchObject([{ to: item('db.md')!.id, label: 'reads' }]);
  });

  it('reconcile marks blocks of files missing at startup as gone', () => {
    const { writer, item } = setup();
    writer.upsert('a.md', 'x');
    writer.upsert('b.md', 'y');
    expect(writer.reconcile(new Set(['b.md']))).toEqual(['a.md']);
    expect(item('a.md')?.gone).toBe(true);
    expect(item('b.md')?.gone).toBe(false);
  });

  it('a new writer on a loaded doc keeps the same ids (restart)', () => {
    const { doc, writer, item } = setup();
    writer.upsert('a.md', 'x');
    const id = item('a.md')!.id;
    const copy = createBoardDoc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    const w2 = new BoardWriter(copy, { owner: 'dewi', rootName: 'payments', exists: () => true });
    expect(w2.upsert('a.md', 'x2')).toBe('changed');
    expect(w2.idOf('a.md')).toBe(id);
    expect(edgesMap(copy).size).toBe(0);
  });

  it('blocks of another owner are never taken over', () => {
    const { doc, writer } = setup();
    writer.upsert('a.md', 'x');
    const other = new BoardWriter(doc, { owner: 'tan', rootName: 'payments', exists: () => true });
    expect(other.upsert('a.md', 'x')).toBe('new');
    expect(itemsMap(doc).size).toBe(2);
  });

  it('a file moved onto the path of a deleted file keeps its own block, place and edges', () => {
    const { doc, writer, item } = setup();
    writer.upsert('x.md', '---\nlinks:\n  - to: b.md\n---\n');
    writer.upsert('b.md', '---\nlinks:\n  - to: x.md\n---\nold b');
    const oldB = item('b.md')!.id;
    writer.unlink('b.md');
    vi.advanceTimersByTime(1000);
    expect(item('b.md')?.gone).toBe(true);

    writer.upsert('a.md', '---\nlinks:\n  - to: x.md\n    label: moved\n---\nA');
    const a = item('a.md')!.id;
    const pos = layoutMap(doc).get(a);
    writer.unlink('a.md');
    expect(writer.upsert('b.md', '---\nlinks:\n  - to: x.md\n    label: moved\n---\nA')).toBe('renamed');
    vi.advanceTimersByTime(2000);

    expect(item('b.md')).toMatchObject({ id: a, gone: false });
    expect(layoutMap(doc).get(a)).toEqual(pos);
    expect(fileEdgesOf(doc, a).map((e) => e.label)).toEqual(['moved']);
    // The old deleted block is gone for good, with the edges its file declared.
    expect(itemsMap(doc).has(oldB)).toBe(false);
    expect(fileEdgesOf(doc, oldB)).toHaveLength(0);
    // x.md's link to b.md now points at the block that holds b.md.
    expect(fileEdgesOf(doc, item('x.md')!.id)[0]?.to).toBe(a);
  });

  it('a rename cut short by a restart is still a rename on the next start', () => {
    const onDisk = new Set(['a.md']);
    const { doc, writer, item } = setup(onDisk);
    writer.upsert('a.md', 'same');
    const id = item('a.md')!.id;
    onDisk.delete('a.md');
    writer.unlink('a.md');
    writer.dispose(); // the CLI stops inside the rename window
    expect(item('a.md')?.gone).toBe(false);

    onDisk.add('a2.md');
    const w2 = new BoardWriter(doc, { owner: 'dewi', rootName: 'payments', exists: (p) => onDisk.has(p) });
    expect(w2.upsert('a2.md', 'same')).toBe('renamed');
    expect(w2.reconcile(onDisk)).toEqual([]);
    expect(item('a2.md')).toMatchObject({ id, gone: false });
  });
});
