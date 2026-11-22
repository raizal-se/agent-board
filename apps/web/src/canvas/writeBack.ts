import {
  addHumanEdge,
  canvasMap,
  deleteHumanEdge,
  deleteSticky,
  edgesMap,
  FRAME_HEADER,
  framesMap,
  isHumanEdge,
  isSticky,
  itemsMap,
  layoutMap,
  moveSticky,
  setEdgeLabel,
  setStickyText,
  type CanvasShape,
  type Layout,
  type Person,
} from '@agent-board/model';
import type * as Y from 'yjs';
import { sizeIn } from '../board/derive';
import { kindOf, type El } from './elements';

/** The origin of every doc change the canvas makes. */
export const CANVAS_ORIGIN = Symbol('canvas');

const bindingId = (b: unknown) => (b && typeof b === 'object' ? ((b as { elementId?: string }).elementId ?? null) : null);

/** Layout with a new place and size; the size is left out while it is the default. */
function placed(old: Layout | undefined, x: number, y: number, w: number, h: number, dflt: { w: number; h: number }): Layout {
  const next: Layout = { ...old, x: Math.round(x), y: Math.round(y) };
  delete next.w;
  delete next.h;
  const rw = Math.round(w);
  const rh = Math.round(h);
  if (rw !== dflt.w || rh !== dflt.h || old?.w !== undefined || old?.h !== undefined) {
    next.w = rw;
    next.h = rh;
  }
  return next;
}

const sameLayout = (a: Layout | undefined, b: Layout) => !!a && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.tilt === b.tilt;

/** An element as plain JSON for the doc. */
function plain(el: El): CanvasShape {
  return JSON.parse(JSON.stringify(el)) as CanvasShape;
}

/**
 * Writes what the user changed on the canvas into the doc. Only elements whose version differs
 * from `seen` are looked at, and each write compares first, so the doc's own updates coming back
 * through the canvas write nothing (no echo). Things the canvas may not change (file blocks being
 * deleted, links from files) are left alone: the next merge puts them back.
 * Returns how many elements changed the doc.
 */
export function writeScene(doc: Y.Doc, elements: readonly El[], seen: Map<string, number>, me: Person): number {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const todo = elements.filter((e) => seen.get(e.id) !== e.version);
  if (todo.length === 0) return 0;
  const items = itemsMap(doc);
  const layout = layoutMap(doc);
  const edges = edgesMap(doc);
  const frames = framesMap(doc);
  const canvas = canvasMap(doc);
  let writes = 0;
  const onBoard = (id: string | null): id is string => {
    if (!id) return false;
    const i = items.get(id);
    return !!i && (i.kind === 'sticky' || i.kind === 'decision' || (i.kind === 'file' && !i.gone));
  };
  const setLayout = (id: string, next: Layout) => {
    if (sameLayout(layout.get(id), next)) return;
    layout.set(id, next);
    writes++;
  };
  const labelOf = (arrowId: string): string => {
    for (const e of elements) if (e.type === 'text' && e.containerId === arrowId && !e.isDeleted) return String(e.originalText ?? e.text ?? '');
    return '';
  };

  const text = (el: El) => (el.isDeleted ? '' : String(el.originalText ?? el.text ?? '').trim());

  doc.transact(() => {
    for (const el of todo) {
      const kind = kindOf(el);
      const container = typeof el.containerId === 'string' ? el.containerId : null;
      switch (kind) {
        case 'frame': {
          if (el.isDeleted || !frames.has(el.id)) break;
          const old = layout.get(el.id);
          setLayout(el.id, { ...old, x: Math.round(el.x), y: Math.round(el.y) });
          break;
        }
        case 'file':
        case 'decision': {
          const item = items.get(el.id);
          if (el.isDeleted || !item || !('frame' in item) || !item.frame) break;
          const frameEl = byId.get(item.frame);
          if (!frameEl) break;
          const x = Math.max(0, el.x - frameEl.x);
          const y = Math.max(FRAME_HEADER, el.y - frameEl.y);
          setLayout(el.id, placed(layout.get(el.id), x, y, el.width, el.height, sizeIn(undefined, kind)));
          break;
        }
        case 'sticky': {
          const s = items.get(el.id);
          if (!isSticky(s)) break;
          if (el.isDeleted) {
            if (deleteSticky(doc, el.id)) writes++;
            break;
          }
          const frameEl = el.frameId ? byId.get(el.frameId) : undefined;
          const frame = frameEl && kindOf(frameEl) === 'frame' && frames.has(frameEl.id) ? frameEl.id : null;
          const x = el.x - (frame ? frameEl!.x : 0);
          const y = el.y - (frame ? frameEl!.y : 0);
          const next = placed(layout.get(el.id), x, y, el.width, el.height, sizeIn(undefined, 'sticky'));
          if (s.frame !== frame) {
            moveSticky(doc, el.id, frame, next.x, next.y);
            writes++;
          }
          setLayout(el.id, next);
          break;
        }
        case 'link': {
          const e = edges.get(el.id);
          if (!isHumanEdge(e)) break;
          if (el.isDeleted) {
            if (deleteHumanEdge(doc, el.id)) writes++;
            break;
          }
          const from = bindingId(el.startBinding);
          const to = bindingId(el.endBinding);
          if (onBoard(from) && onBoard(to) && from !== to && (from !== e.from || to !== e.to)) {
            edges.set(el.id, { ...e, from, to });
            writes++;
          }
          break;
        }
        case 'file-edge':
        case 'file-edge-label':
        case 'zone':
        case 'zone-label':
          break;
        default: {
          // Text the user typed into a note or onto a drawn link.
          if (el.type === 'text' && container && (kind === undefined || kind === 'sticky-text' || kind === 'link-label')) {
            if (isSticky(items.get(container))) {
              if (setStickyText(doc, container, text(el))) writes++;
              if (canvas.has(el.id)) canvas.delete(el.id);
              break;
            }
            const e = edges.get(container);
            if (isHumanEdge(e)) {
              if (e.label !== text(el) && setEdgeLabel(doc, container, text(el))) writes++;
              if (canvas.has(el.id)) canvas.delete(el.id);
              break;
            }
          }
          if (kind !== undefined) break;
          // An arrow drawn from one thing on the board to another is a link.
          const from = bindingId(el.startBinding);
          const to = bindingId(el.endBinding);
          if (el.type === 'arrow' && !el.isDeleted && onBoard(from) && onBoard(to) && from !== to && !edges.has(el.id)) {
            addHumanEdge(doc, { id: el.id, from, to, label: labelOf(el.id), by: me });
            if (canvas.has(el.id)) canvas.delete(el.id);
            for (const t of elements) if (t.type === 'text' && t.containerId === el.id && canvas.has(t.id)) canvas.delete(t.id);
            writes++;
            break;
          }
          // Anything else is free drawing.
          if (el.isDeleted) {
            if (canvas.has(el.id)) {
              canvas.delete(el.id);
              writes++;
            }
          } else if ((canvas.get(el.id) as El | undefined)?.version !== el.version) {
            canvas.set(el.id, plain(el));
            writes++;
          }
        }
      }
    }
  }, CANVAS_ORIGIN);

  for (const el of todo) seen.set(el.id, el.version);
  return writes;
}
