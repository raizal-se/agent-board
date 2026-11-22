import { describe, expect, it } from 'vitest';
import { edgesMap, syncFileEdges } from './edges';
import { createBoardDoc } from './index';
import { itemsMap } from './items';
import { layoutMap, STICKY_W } from './layout';
import {
  addComment,
  addHumanEdge,
  addSticky,
  commentsOn,
  deleteHumanEdge,
  deleteSticky,
  isSticky,
  moveSticky,
  setEdgeLabel,
  setStickyText,
  setThreadResolved,
  threadId,
  type Person,
} from './native';

const dewi: Person = { name: 'Dewi', side: 'product' };

describe('sticky notes', () => {
  it('a sticky has its author, side, text and place; inside a frame or outside any', () => {
    const doc = createBoardDoc();
    const inFrame = addSticky(doc, { by: dewi, frame: 'frame:checkout', x: 40.4, y: 90, text: 'what if the card fails?', now: 5 });
    const loose = addSticky(doc, { by: dewi, frame: null, x: -300, y: 10 });
    const s = itemsMap(doc).get(inFrame);
    expect(s).toMatchObject({ kind: 'sticky', author: 'Dewi', side: 'product', frame: 'frame:checkout', text: 'what if the card fails?', createdAt: 5 });
    expect(layoutMap(doc).get(inFrame)).toMatchObject({ x: 40, y: 90, w: STICKY_W });
    expect(itemsMap(doc).get(loose)).toMatchObject({ frame: null, text: '' });
  });

  it('edits the text, moves between frames, and deletes with its edges and comments', () => {
    const doc = createBoardDoc();
    const s = addSticky(doc, { by: dewi, frame: null, x: 0, y: 0 });
    expect(setStickyText(doc, s, 'idempotency key!', 9)).toBe(true);
    expect(itemsMap(doc).get(s)).toMatchObject({ text: 'idempotency key!', updatedAt: 9 });
    expect(setStickyText(doc, s, 'idempotency key!')).toBe(false);

    moveSticky(doc, s, 'frame:a', 100, 200);
    expect(itemsMap(doc).get(s)).toMatchObject({ frame: 'frame:a' });
    expect(layoutMap(doc).get(s)).toMatchObject({ x: 100, y: 200 });

    const keep = addSticky(doc, { by: dewi, frame: null, x: 0, y: 0 });
    const e = addHumanEdge(doc, { from: s, to: keep, by: dewi })!;
    addComment(doc, { target: s, by: dewi, text: 'hm' });
    setThreadResolved(doc, { target: s, by: dewi, resolved: true });
    expect(deleteSticky(doc, s)).toBe(true);
    expect(itemsMap(doc).has(s)).toBe(false);
    expect(layoutMap(doc).has(s)).toBe(false);
    expect(edgesMap(doc).has(e)).toBe(false);
    expect(commentsOn(doc, s)).toEqual([]);
    expect(itemsMap(doc).has(threadId(s))).toBe(false);
    expect(isSticky(itemsMap(doc).get(keep))).toBe(true);
  });
});

describe('edges by hand', () => {
  it('adds, relabels and deletes a drawn edge; a file edge cannot be deleted or relabelled here', () => {
    const doc = createBoardDoc();
    const id = addHumanEdge(doc, { from: 'a', to: 'b', label: ' blocks ', by: dewi, now: 3 })!;
    expect(edgesMap(doc).get(id)).toEqual({ id, source: 'human', from: 'a', to: 'b', label: 'blocks', author: 'Dewi', createdAt: 3 });
    expect(addHumanEdge(doc, { from: 'a', to: 'a', by: dewi })).toBeNull();
    expect(setEdgeLabel(doc, id, 'needs')).toBe(true);
    expect(edgesMap(doc).get(id)?.label).toBe('needs');

    syncFileEdges(doc, 'a', [{ to: 'b.md', label: 'calls' }]);
    const fileEdge = [...edgesMap(doc).keys()].find((k) => k.startsWith('fe:'))!;
    expect(deleteHumanEdge(doc, fileEdge)).toBe(false);
    expect(setEdgeLabel(doc, fileEdge, 'x')).toBe(false);
    expect(edgesMap(doc).has(fileEdge)).toBe(true);

    expect(deleteHumanEdge(doc, id)).toBe(true);
    expect(edgesMap(doc).has(id)).toBe(false);
  });

  it('keeps the id it is given (an arrow drawn on the canvas keeps its own)', () => {
    const doc = createBoardDoc();
    expect(addHumanEdge(doc, { id: 'arrow-1', from: 'a', to: 'b', by: dewi })).toBe('arrow-1');
    expect(edgesMap(doc).get('arrow-1')).toMatchObject({ id: 'arrow-1', from: 'a', to: 'b' });
  });

  it('a file change never touches a drawn edge', () => {
    const doc = createBoardDoc();
    const id = addHumanEdge(doc, { from: 'a', to: 'b', by: dewi })!;
    syncFileEdges(doc, 'a', []);
    expect(edgesMap(doc).has(id)).toBe(true);
  });
});

describe('comment threads', () => {
  it('keeps comments in order with author and time; resolve, and a new comment opens it again', () => {
    const doc = createBoardDoc();
    addComment(doc, { target: 'f_1', by: dewi, text: 'second', now: 20 });
    addComment(doc, { target: 'f_1', by: { name: 'Arif', side: 'engineering' }, text: 'first', now: 10 });
    expect(addComment(doc, { target: 'f_1', by: dewi, text: '   ' })).toBeNull();
    addComment(doc, { target: 'f_2', by: dewi, text: 'elsewhere' });
    expect(commentsOn(doc, 'f_1').map((c) => [c.author, c.text, c.at])).toEqual([
      ['Arif', 'first', 10],
      ['Dewi', 'second', 20],
    ]);

    setThreadResolved(doc, { target: 'f_1', by: dewi, resolved: true, now: 30 });
    expect(itemsMap(doc).get(threadId('f_1'))).toMatchObject({ resolved: true, by: 'Dewi', at: 30 });
    addComment(doc, { target: 'f_1', by: dewi, text: 'one more' });
    expect(itemsMap(doc).get(threadId('f_1'))).toMatchObject({ resolved: false });
  });
});
