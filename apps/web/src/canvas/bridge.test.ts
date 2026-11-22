import {
  agreementsMap,
  boardMap,
  canvasMap,
  createBoardDoc,
  edgesMap,
  framesMap,
  isHumanEdge,
  itemsMap,
  layoutMap,
  addSticky,
  BLOCK_W,
  FRAME_PAD,
  ZONE_STRIP,
  zoneX,
  type FileItem,
  type Layout,
} from '@agent-board/model';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { base, kindOf, roughMeasure, type El } from './elements';
import type { GestureState } from './scene';
import { BoardSync, type SceneApi } from './sync';
import { CANVAS_ORIGIN } from './writeBack';

function file(id: string, path: string, frame: string, extra: Partial<FileItem> = {}): FileItem {
  return { id, kind: 'file', path, frame, type: 'markdown', text: `# ${path}`, hash: 'h1', owner: 'ana', gone: false, updatedAt: 0, ...extra };
}

/** A board with frame a (at 0,0) and b (at 2000,0); blocks x, y in a and z in b; a file link x -> y. */
function board(): Y.Doc {
  const doc = createBoardDoc();
  doc.transact(() => {
    boardMap<string>(doc, 'meta').set('owner', 'ana');
    framesMap(doc).set('frame:a', { id: 'frame:a', name: 'a' });
    framesMap(doc).set('frame:b', { id: 'frame:b', name: 'b' });
    const l = layoutMap(doc);
    l.set('frame:a', { x: 0, y: 0 });
    l.set('frame:b', { x: 2000, y: 0 });
    const items = itemsMap(doc);
    items.set('x', file('x', 'a/x.md', 'frame:a'));
    items.set('y', file('y', 'a/y.md', 'frame:a'));
    items.set('z', file('z', 'b/z.md', 'frame:b', { type: 'html' }));
    l.set('x', { x: 32, y: 76 });
    l.set('y', { x: 404, y: 76 });
    l.set('z', { x: 32, y: 76 });
    edgesMap(doc).set('fe:x->a/y.md#', { id: 'fe:x->a/y.md#', source: 'file', from: 'x', toPath: 'a/y.md', to: 'y', label: 'uses' });
  });
  return doc;
}

/** Excalidraw's imperative API, as far as the bridge uses it. */
class FakeCanvas implements SceneApi {
  scene: El[] = [];
  app: GestureState = { selectedElementIds: {} };
  getSceneElementsIncludingDeleted = () => this.scene;
  getAppState = () => this.app;
  updateScene = (els: El[]) => {
    this.scene = els;
  };
  get(id: string): El {
    const el = this.scene.find((e) => e.id === id);
    if (!el) throw new Error(`no element ${id}`);
    return el;
  }
  /** The user changes an element, as Excalidraw does: a new object with a higher version. */
  edit(id: string, patch: Partial<El>): El {
    const old = this.get(id);
    const next = { ...old, ...patch, version: old.version + 1, versionNonce: old.versionNonce + 1 };
    this.scene = this.scene.map((e) => (e.id === id ? next : e));
    return next;
  }
  add(el: El): void {
    this.scene = [...this.scene, el];
  }
}

let doc: Y.Doc;
let canvas: FakeCanvas;
let sync: BoardSync;

beforeEach(() => {
  vi.useFakeTimers();
  doc = board();
  canvas = new FakeCanvas();
  sync = new BoardSync(doc, canvas, { measure: roughMeasure });
  sync.start();
});
afterEach(() => {
  sync.stop();
  vi.useRealTimers();
});

const layoutOf = (id: string): Layout | undefined => layoutMap(doc).get(id);

describe('doc to elements', () => {
  it('draws frames, zones, file blocks and a file link bound to both blocks', () => {
    const a = canvas.get('frame:a');
    expect(a).toMatchObject({ type: 'frame', x: 0, y: 0, name: 'a', roughness: 0 });
    expect(canvas.get('frame:a~zone:product')).toMatchObject({ type: 'rectangle', locked: true, frameId: 'frame:a' });

    const x = canvas.get('x');
    expect(x).toMatchObject({ type: 'embeddable', x: 32, y: 76, link: 'agent-board:x', frameId: 'frame:a' });
    expect(x.customData).toMatchObject({ ab: 'file', id: 'x', path: 'a/x.md', owner: 'ana', state: 'draft' });
    expect(canvas.get('z')).toMatchObject({ x: 2032, y: 76, frameId: 'frame:b' });

    const arrow = canvas.get('fe:x->a/y.md#');
    expect(arrow).toMatchObject({ type: 'arrow', locked: true, strokeStyle: 'dotted', startBinding: { elementId: 'x' }, endBinding: { elementId: 'y' } });
    expect(x.boundElements).toEqual([{ id: 'fe:x->a/y.md#', type: 'arrow' }]);
    expect(canvas.get('fe:x->a/y.md#~label')).toMatchObject({ type: 'text', originalText: 'uses', containerId: 'fe:x->a/y.md#' });
  });

  it('draws the zones in use as full columns and the empty ones after them as thin strips with turned names', () => {
    // Frame a has blocks in product and engineering; frame b only in product.
    for (const z of ['product', 'engineering']) expect(canvas.get(`frame:a~zone:${z}`).width).toBe(BLOCK_W + 24);
    for (const z of ['agreed', 'milestone']) {
      expect(canvas.get(`frame:a~zone:${z}`).width).toBe(ZONE_STRIP - 8);
      expect(canvas.get(`frame:a~zonelabel:${z}`).angle).toBeCloseTo((3 * Math.PI) / 2);
    }
    expect(canvas.get('frame:a~zonelabel:engineering').angle).toBe(0);
    expect(canvas.get('frame:b~zone:engineering').width).toBe(ZONE_STRIP - 8);
    // The strips sit inside the frame, which is no wider than it needs to be.
    const a = canvas.get('frame:a');
    const m = canvas.get('frame:a~zone:milestone');
    expect(m.x + m.width).toBeLessThanOrEqual(a.x + a.width);
    expect(a.width).toBe(zoneX('engineering') + BLOCK_W + FRAME_PAD + 2 * ZONE_STRIP);
  });

  it('puts each frame just above its children', () => {
    const ids = canvas.scene.map((e) => e.id);
    expect(ids.indexOf('frame:a')).toBeGreaterThan(ids.indexOf('x'));
    expect(ids.indexOf('frame:a')).toBeLessThan(ids.indexOf('z'));
  });

  it('updates only the elements that changed', () => {
    const before = new Map(canvas.scene.map((e) => [e.id, e]));
    layoutMap(doc).set('y', { x: 404, y: 600 });
    vi.runAllTimers();
    const changed = canvas.scene.filter((e) => before.get(e.id) !== e).map((e) => e.id).sort();
    // y, the frame that grew to hold it, its zones (taller), the arrow and its label.
    expect(changed).toContain('y');
    expect(changed).toContain('fe:x->a/y.md#');
    expect(changed).not.toContain('x');
    expect(changed).not.toContain('z');
    expect(canvas.get('y').version).toBe(before.get('y')!.version + 1);
  });

  it('marks an agreed block and one changed after agreement', () => {
    agreementsMap(doc).set('x', { item: 'x', decision: 'd1', snapshot: { text: 'old', hash: 'h0', type: 'markdown', at: 1 }, accepts: [] });
    vi.runAllTimers();
    expect(canvas.get('x').customData).toMatchObject({ state: 'agreed', changed: true });
  });
});

describe('a scene replaced under the bridge', () => {
  it('draws the doc again when the canvas loses its elements (Excalidraw loading initialData after the first push)', () => {
    const drawn = canvas.scene.filter((e) => !e.isDeleted).map((e) => e.id).sort();
    expect(drawn.length).toBeGreaterThan(0);
    // Excalidraw's initializeScene: the whole scene replaced by an empty one, then its onChange.
    canvas.scene = [];
    sync.changed();
    vi.runAllTimers();
    expect(canvas.scene.filter((e) => !e.isDeleted).map((e) => e.id).sort()).toEqual(drawn);
    // Nothing of the restore went back to the doc as a change.
    expect(layoutOf('x')).toEqual({ x: 32, y: 76 });
  });

  it('a user delete is not a lost scene: the element stays, marked deleted', () => {
    canvas.edit('fe:x->a/y.md#~label', { isDeleted: true });
    expect(sync.lost()).toBe(false);
    canvas.scene = canvas.scene.filter((e) => e.id !== 'x');
    expect(sync.lost()).toBe(true);
  });
});

describe('elements to doc', () => {
  it('writes a moved block relative to its frame, and a moved frame', () => {
    canvas.edit('x', { x: 100, y: 300 });
    canvas.edit('frame:b', { x: 2500, y: 40 });
    sync.flush();
    expect(layoutOf('x')).toEqual({ x: 100, y: 300 });
    expect(layoutOf('frame:b')).toEqual({ x: 2500, y: 40 });
  });

  it('writes a resized block with its size', () => {
    canvas.edit('x', { width: 500, height: 420 });
    sync.flush();
    expect(layoutOf('x')).toEqual({ x: 32, y: 76, w: 500, h: 420 });
  });

  it('a drawn arrow between two blocks becomes a link, with its label', () => {
    const arrow = base('arr1', 'arrow', undefined, {
      x: 380,
      y: 200,
      width: 20,
      height: 0,
      points: [[0, 0], [20, 0]],
      startBinding: { elementId: 'x', focus: 0, gap: 4 },
      endBinding: { elementId: 'z', focus: 0, gap: 4 },
      boundElements: [{ id: 'lbl1', type: 'text' }],
    });
    canvas.add(arrow);
    canvas.add(base('lbl1', 'text', undefined, { text: 'needs', originalText: 'needs', containerId: 'arr1' }));
    sync.flush();
    const e = edgesMap(doc).get('arr1');
    expect(isHumanEdge(e) && e).toMatchObject({ from: 'x', to: 'z', label: 'needs', author: 'ana' });
    expect(canvasMap(doc).has('arr1')).toBe(false);
    vi.runAllTimers();
    expect(kindOf(canvas.get('arr1'))).toBe('link');
    expect(kindOf(canvas.get('lbl1'))).toBe('link-label');

    canvas.edit('lbl1', { text: 'calls', originalText: 'calls' });
    sync.flush();
    expect(edgesMap(doc).get('arr1')?.label).toBe('calls');

    canvas.edit('arr1', { isDeleted: true });
    sync.flush();
    expect(edgesMap(doc).has('arr1')).toBe(false);
  });

  it('keeps a note: its text, its frame and its removal', () => {
    const id = addSticky(doc, { by: { name: 'ana', side: 'product' }, frame: 'frame:a', x: 800, y: 100, text: 'hi' });
    vi.runAllTimers();
    expect(canvas.get(id)).toMatchObject({ type: 'rectangle', x: 800, y: 100, frameId: 'frame:a' });
    expect(canvas.get(id).customData).toMatchObject({ ab: 'sticky', author: 'ana' });

    canvas.edit(`${id}~text`, { originalText: 'hello there', text: 'hello there' });
    sync.flush();
    expect(itemsMap(doc).get(id)).toMatchObject({ text: 'hello there', author: 'ana' });

    // Dragged out of every frame.
    canvas.edit(id, { x: -500, y: 50, frameId: null });
    sync.flush();
    expect(itemsMap(doc).get(id)).toMatchObject({ frame: null });
    expect(layoutOf(id)).toMatchObject({ x: -500, y: 50 });

    canvas.edit(id, { isDeleted: true });
    sync.flush();
    expect(itemsMap(doc).has(id)).toBe(false);
  });

  it('keeps free drawing in the doc, and removes it when it is deleted elsewhere', () => {
    canvas.add(base('free1', 'ellipse', undefined, { x: 10, y: 10, width: 50, height: 50 }));
    sync.flush();
    expect(canvasMap(doc).get('free1')).toMatchObject({ type: 'ellipse', width: 50 });
    vi.runAllTimers();
    canvasMap(doc).delete('free1');
    vi.runAllTimers();
    expect(canvas.get('free1').isDeleted).toBe(true);
  });

  it('shows free drawing from another device', () => {
    canvasMap(doc).set('free2', { ...base('free2', 'rectangle', undefined, { x: 5, y: 5, width: 10, height: 10 }) });
    vi.runAllTimers();
    expect(canvas.get('free2')).toMatchObject({ type: 'rectangle', x: 5 });
  });
});

describe('no echo', () => {
  it('the doc state pushed to the canvas writes nothing back', () => {
    let updates = 0;
    doc.on('update', () => updates++);
    expect(sync.flush()).toBe(0);
    layoutMap(doc).set('x', { x: 64, y: 76 });
    updates = 0;
    vi.runAllTimers();
    expect(sync.flush()).toBe(0);
    expect(updates).toBe(0);
  });

  it('a user move goes to the doc once and settles', () => {
    let updates = 0;
    doc.on('update', () => updates++);
    canvas.edit('x', { x: 120 });
    sync.changed();
    vi.runAllTimers();
    expect(layoutOf('x')).toMatchObject({ x: 120 });
    const after = updates;
    const pushes = sync.pushes;
    vi.runAllTimers();
    sync.flush();
    vi.runAllTimers();
    expect(updates).toBe(after);
    expect(sync.pushes).toBe(pushes);
  });

  it('writes from the canvas carry the canvas origin', () => {
    const origins: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));
    canvas.edit('x', { x: 120 });
    sync.flush();
    expect(origins).toEqual([CANVAS_ORIGIN]);
  });
});

describe('locked file items', () => {
  it('a deleted file block or file link comes back, and the doc keeps them', () => {
    canvas.edit('x', { isDeleted: true });
    canvas.edit('fe:x->a/y.md#', { isDeleted: true });
    sync.flush();
    expect(itemsMap(doc).has('x')).toBe(true);
    expect(edgesMap(doc).has('fe:x->a/y.md#')).toBe(true);
    sync.run();
    expect(canvas.get('x').isDeleted).toBe(false);
    expect(canvas.get('fe:x->a/y.md#').isDeleted).toBe(false);
  });

  it('a copy of a block (Ctrl+D, paste) moves nothing, is not kept, and leaves the canvas', () => {
    const x = canvas.get('x');
    canvas.add({ ...x, id: 'copy-of-x', x: x.x + 500, y: x.y + 500, version: 1, versionNonce: 1 });
    const label = canvas.get('fe:x->a/y.md#~label');
    canvas.add({ ...label, id: 'copy-of-label', containerId: 'copy-of-x', version: 1, versionNonce: 1 });
    sync.flush();
    expect(layoutOf('x')).toEqual({ x: 32, y: 76 });
    expect(itemsMap(doc).has('copy-of-x')).toBe(false);
    expect([...canvasMap(doc).keys()]).toEqual([]);
    sync.run();
    expect(canvas.scene.some((e) => e.id.startsWith('copy-of-') && !e.isDeleted)).toBe(false);
    expect(canvas.get('x')).toMatchObject({ x: 32, y: 76 });
  });

  it('a changed block link is put back', () => {
    canvas.edit('x', { link: 'https://example.com' });
    sync.run();
    expect(canvas.get('x').link).toBe('agent-board:x');
  });

  it('a block keeps its embed link until Excalidraw has checked it, then drops it (no link icon)', () => {
    // First push: the link is there for Excalidraw to check.
    expect(canvas.get('x').link).toBe('agent-board:x');
    // onChange (after Excalidraw checked the embeds): the next merge drops the link, and keeps it dropped.
    sync.changed();
    vi.advanceTimersByTime(20);
    expect(canvas.get('x').link).toBeNull();
    expect(canvas.get('z').link).toBeNull();
    canvas.edit('x', { link: 'https://example.com' });
    sync.run();
    expect(canvas.get('x').link).toBeNull();

    // A block that arrives later gets its link first, like the first ones.
    itemsMap(doc).set('w', file('w', 'a/w.md', 'frame:a'));
    vi.runAllTimers();
    expect(canvas.get('w').link).toBe('agent-board:w');
    expect(canvas.get('x').link).toBeNull();
  });

  it('a file link and its label are locked', () => {
    expect(canvas.get('fe:x->a/y.md#').locked).toBe(true);
    expect(canvas.get('fe:x->a/y.md#~label').locked).toBe(true);
  });
});

describe('a drag during a file update', () => {
  it('leaves the dragged block where the user has it, and moves the rest', () => {
    sync.pointer(true);
    canvas.app = { selectedElementIds: { x: true }, selectedElementsAreBeingDragged: true };
    const dragged = canvas.edit('x', { x: 700, y: 500 });

    // The file is saved and another device moves y.
    doc.transact(() => {
      itemsMap(doc).set('x', file('x', 'a/x.md', 'frame:a', { text: '# new', hash: 'h2' }));
      layoutMap(doc).set('y', { x: 404, y: 400 });
    });
    vi.runAllTimers();
    expect(canvas.get('x')).toBe(dragged);
    expect(canvas.get('y')).toMatchObject({ x: 404, y: 400 });
    // Nothing went to the doc while the pointer is down.
    expect(layoutOf('x')).toEqual({ x: 32, y: 76 });

    canvas.app = { selectedElementIds: { x: true } };
    sync.pointer(false);
    vi.runAllTimers();
    expect(layoutOf('x')).toEqual({ x: 700, y: 500 });
    expect(canvas.get('x')).toMatchObject({ x: 700, y: 500 });
  });

  it('keeps the children of a dragged frame', () => {
    sync.pointer(true);
    canvas.app = { selectedElementIds: { 'frame:a': true }, selectedElementsAreBeingDragged: true };
    canvas.edit('frame:a', { x: 300 });
    const x = canvas.edit('x', { x: 332 });
    layoutMap(doc).set('x', { x: 40, y: 76 });
    vi.runAllTimers();
    expect(canvas.get('x')).toBe(x);
  });

  it('keeps text being typed', () => {
    const id = addSticky(doc, { by: { name: 'ana', side: 'product' }, frame: null, x: 0, y: -400, text: 'a' });
    vi.runAllTimers();
    canvas.app = { selectedElementIds: {}, editingTextElement: { id: `${id}~text`, containerId: id } };
    const typing = canvas.edit(`${id}~text`, { originalText: 'abc', text: 'abc' });
    layoutMap(doc).set(id, { x: 50, y: -400, w: 200, h: 160 });
    vi.runAllTimers();
    expect(canvas.get(`${id}~text`)).toBe(typing);
    expect(itemsMap(doc).get(id)).toMatchObject({ text: 'a' });
  });
});
