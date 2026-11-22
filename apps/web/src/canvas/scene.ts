import { FRAME_HEADER, ZONES, zoneX, type CanvasShape, type Layout } from '@agent-board/model';
import { sizeIn, type BoardState, type FrameView, type Views } from '../board/derive';
import {
  arrowEl,
  arrowGeometry,
  arrowMiddle,
  base,
  boxOf,
  embedLink,
  kindOf,
  MUTED,
  TEXT_PAD,
  textEl,
  type Box,
  type BoundRef,
  type El,
  type Kind,
  type Measure,
} from './elements';

/**
 * The bridge from the doc to the canvas. The doc is the source of truth: `docElements` builds what
 * the canvas should show, and `mergeScene` lays that over what the canvas has now without fighting
 * the user (an element being dragged, resized or typed in stays as the user has it).
 */

/** Zone tints: soft, so blocks read on top of them. */
export const ZONE_TINT: Record<string, string> = {
  product: 'rgba(37, 99, 235, 0.09)',
  engineering: 'rgba(234, 88, 12, 0.09)',
  agreed: 'rgba(22, 163, 74, 0.10)',
  milestone: 'rgba(109, 40, 217, 0.09)',
};
export const STICKY_BG = '#fff3a8';
const STICKY_STROKE = '#e3cd5b';
const BLOCK_STROKE = '#d6d3cc';
const FRAME_STROKE = '#bbb8b0';
const STICKY_FONT = 16;
const LABEL_FONT = 14;
const ZONE_FONT = 13;

/** Doc-owned kinds that are bound text in a container. */
const BOUND_TEXT_KINDS = new Set<Kind>(['sticky-text', 'file-edge-label', 'link-label']);

/** The id of the live text bound to `containerId`, if the canvas has one. */
function boundTextId(local: ReadonlyMap<string, El>, containerId: string): string | undefined {
  for (const el of local.values()) if (el.type === 'text' && el.containerId === containerId && !el.isDeleted) return el.id;
  return undefined;
}

/**
 * What the canvas should show for the doc, in z-order: per frame its zones, labels, blocks, notes
 * and then the frame itself (Excalidraw keeps a frame just above its children); then notes outside
 * frames; then arrows and their labels. Arrows go from box to box here; `mergeScene` keeps the
 * geometry the canvas has when neither end moved.
 */
/**
 * The doc as canvas elements. `embedded`: blocks Excalidraw has already accepted as embeds. They
 * drop their link: Excalidraw checks an embed's link once per element id and keeps the answer, and
 * it draws a link icon on every element that has a link.
 */
export function docElements(
  state: BoardState,
  v: Views,
  local: ReadonlyMap<string, El>,
  measure: Measure,
  embedded: ReadonlySet<string> = new Set(),
): El[] {
  const frameById = new Map<string, FrameView>(v.frames.map((f) => [f.frame.id, f]));
  const boxes = new Map<string, Box>();
  const bound = new Map<string, BoundRef[]>();
  const bind = (id: string, ref: BoundRef) => bound.set(id, [...(bound.get(id) ?? []), ref]);
  const at = (l: Layout | undefined, frame: string | null): { x: number; y: number } => {
    const f = frame ? frameById.get(frame) : undefined;
    return { x: (f?.x ?? 0) + (l?.x ?? 0), y: (f?.y ?? 0) + (l?.y ?? 0) };
  };

  // Ids first, so a block can list the arrows bound to it.
  const labelIds = new Map<string, string>();
  for (const e of v.edges) {
    bind(e.from, { id: e.id, type: 'arrow' });
    bind(e.to, { id: e.id, type: 'arrow' });
    const labelId = (e.kind === 'human' && boundTextId(local, e.id)) || `${e.id}~label`;
    if (e.label) {
      labelIds.set(e.id, labelId);
      bind(e.id, { id: labelId, type: 'text' });
    }
  }
  const stickyTextIds = new Map<string, string>();
  for (const { sticky } of v.stickies.values()) {
    if (!sticky.text) continue;
    const tid = boundTextId(local, sticky.id) ?? `${sticky.id}~text`;
    stickyTextIds.set(sticky.id, tid);
    bind(sticky.id, { id: tid, type: 'text' });
  }
  const refs = (id: string) => bound.get(id) ?? null;

  const stickyEls = (frame: string | null): El[] => {
    const out: El[] = [];
    for (const { sticky } of v.stickies.values()) {
      if (sticky.frame !== frame) continue;
      const l = state.layout.get(sticky.id);
      const p = at(l, frame);
      const size = sizeIn(l, 'sticky');
      boxes.set(sticky.id, { ...p, ...size });
      out.push(
        base(sticky.id, 'rectangle', 'sticky', {
          ...p,
          width: size.w,
          height: size.h,
          backgroundColor: STICKY_BG,
          strokeColor: STICKY_STROKE,
          roundness: { type: 3 },
          frameId: frame,
          boundElements: refs(sticky.id),
          customData: { ab: 'sticky', id: sticky.id, author: sticky.author },
        }),
      );
      const tid = stickyTextIds.get(sticky.id);
      if (tid) {
        out.push(
          textEl(tid, 'sticky-text', {
            text: sticky.text,
            x: p.x + TEXT_PAD,
            y: p.y + TEXT_PAD,
            fontSize: STICKY_FONT,
            measure,
            containerId: sticky.id,
            wrapWidth: size.w - 2 * TEXT_PAD,
            frameId: frame,
            customData: { id: sticky.id },
          }),
        );
      }
    }
    return out;
  };

  const out: El[] = [];
  for (const fv of v.frames) {
    const fid = fv.frame.id;
    const rects = fv.zones;
    for (const z of ZONES) {
      const r = rects[z];
      out.push(
        base(`${fid}~zone:${z}`, 'rectangle', 'zone', {
          x: fv.x + r.x,
          y: fv.y + r.y,
          width: r.w,
          height: r.h,
          backgroundColor: ZONE_TINT[z]!,
          strokeColor: 'transparent',
          strokeWidth: 0,
          roundness: { type: 3 },
          locked: true,
          frameId: fid,
          customData: { ab: 'zone', zone: z, frame: fid },
        }),
      );
      const label = textEl(`${fid}~zonelabel:${z}`, 'zone-label', {
        text: z,
        x: fv.x + zoneX(z),
        y: fv.y + FRAME_HEADER + 6,
        fontSize: ZONE_FONT,
        measure,
        color: MUTED,
        locked: true,
        frameId: fid,
        customData: { zone: z, frame: fid },
      });
      // An empty zone's strip: the name reads bottom to top, at the top of the strip.
      // Excalidraw turns an element about its centre, so place the centre and turn.
      if (r.strip) {
        const cx = fv.x + r.x + r.w / 2;
        const cy = fv.y + r.y + 8 + label.width / 2;
        out.push({ ...label, x: cx - label.width / 2, y: cy - label.height / 2, angle: (3 * Math.PI) / 2 } as El);
      } else out.push(label);
    }
    for (const [id, b] of v.blocks) {
      if (b.item.frame !== fid) continue;
      const l = state.layout.get(id);
      const p = at(l, fid);
      const size = sizeIn(l, 'file');
      boxes.set(id, { ...p, ...size });
      out.push(
        base(id, 'embeddable', 'file', {
          ...p,
          width: size.w,
          height: size.h,
          strokeColor: BLOCK_STROKE,
          backgroundColor: '#ffffff',
          link: embedded.has(id) ? null : embedLink(id),
          frameId: fid,
          boundElements: refs(id),
          customData: {
            ab: 'file',
            id,
            path: b.item.path,
            owner: b.item.owner,
            state: b.agreement ? 'agreed' : 'draft',
            zone: b.zone,
            changed: b.changed,
          },
        }),
      );
    }
    for (const [id, d] of v.decisions) {
      if (d.decision.frame !== fid) continue;
      const l = state.layout.get(id);
      const p = at(l, fid);
      const size = sizeIn(l, 'decision');
      boxes.set(id, { ...p, ...size });
      out.push(
        base(id, 'embeddable', 'decision', {
          ...p,
          width: size.w,
          height: size.h,
          strokeColor: BLOCK_STROKE,
          backgroundColor: '#ffffff',
          link: embedded.has(id) ? null : embedLink(id),
          frameId: fid,
          boundElements: refs(id),
          customData: { ab: 'decision', id, author: d.decision.author },
        }),
      );
    }
    out.push(...stickyEls(fid));
    out.push(
      base(fid, 'frame', 'frame', {
        x: fv.x,
        y: fv.y,
        width: fv.w,
        height: fv.h,
        strokeColor: FRAME_STROKE,
        name: fv.frame.name,
        customData: { ab: 'frame', id: fid, name: fv.frame.name, count: fv.count },
      }),
    );
  }
  out.push(...stickyEls(null));

  const labels: El[] = [];
  for (const e of v.edges) {
    const a = boxes.get(e.from);
    const b = boxes.get(e.to);
    if (!a || !b) continue;
    const file = e.kind === 'file';
    const arrow = arrowEl(e.id, file ? 'file-edge' : 'link', {
      from: e.from,
      to: e.to,
      a,
      b,
      dashed: file,
      locked: file,
      customData: { id: e.id },
    });
    arrow.boundElements = refs(e.id);
    out.push(arrow);
    const labelId = labelIds.get(e.id);
    if (labelId) {
      const mid = arrowMiddle(arrow);
      const t = textEl(labelId, file ? 'file-edge-label' : 'link-label', {
        text: e.label,
        x: 0,
        y: 0,
        fontSize: LABEL_FONT,
        measure,
        containerId: e.id,
        color: file ? MUTED : undefined,
        locked: file,
        align: 'center',
        verticalAlign: 'middle',
        customData: { id: e.id },
      });
      t.x = mid.x - t.width / 2;
      t.y = mid.y - t.height / 2;
      labels.push(t);
    }
  }
  out.push(...labels);
  return out;
}

/** The parts of Excalidraw's AppState that say what the user is doing right now. */
export interface GestureState {
  /** True from Excalidraw's constructor until initializeScene has put `initialData` on the canvas. */
  isLoading?: boolean;
  selectedElementIds: Readonly<Record<string, true | boolean>>;
  selectedElementsAreBeingDragged?: boolean;
  isResizing?: boolean;
  isRotating?: boolean;
  resizingElement?: { id: string } | null;
  newElement?: { id: string } | null;
  multiElement?: { id: string } | null;
  editingTextElement?: { id: string; containerId?: string | null } | null;
  editingLinearElement?: { elementId: string } | null;
}

/** True while the user is in the middle of something: the scene is not settled, so nothing goes to the doc. */
export function inGesture(app: GestureState, pointerDown: boolean): boolean {
  return (
    pointerDown ||
    !!app.selectedElementsAreBeingDragged ||
    !!app.isResizing ||
    !!app.isRotating ||
    !!app.resizingElement ||
    !!app.newElement ||
    !!app.multiElement ||
    !!app.editingTextElement ||
    !!app.editingLinearElement
  );
}

/**
 * Elements the user holds right now: the canvas keeps them exactly as they are. While the pointer
 * is down or a drag, resize or rotate runs, that is every selected element; plus the element being
 * made, resized or typed in; plus the children of a held frame and the text bound to a held element.
 */
export function heldIds(app: GestureState, local: readonly El[], pointerDown: boolean): Set<string> {
  const held = new Set<string>();
  if (pointerDown || app.selectedElementsAreBeingDragged || app.isResizing || app.isRotating) {
    for (const [id, on] of Object.entries(app.selectedElementIds)) if (on) held.add(id);
  }
  for (const e of [app.resizingElement, app.newElement, app.multiElement]) if (e) held.add(e.id);
  if (app.editingTextElement) {
    held.add(app.editingTextElement.id);
    if (app.editingTextElement.containerId) held.add(app.editingTextElement.containerId);
  }
  if (app.editingLinearElement) held.add(app.editingLinearElement.elementId);
  if (held.size === 0) return held;
  for (const el of local) if (el.frameId && held.has(el.frameId)) held.add(el.id);
  for (const el of local) if (typeof el.containerId === 'string' && held.has(el.containerId)) held.add(el.id);
  return held;
}

const sortedIds = (refs: readonly BoundRef[] | null | undefined) =>
  (refs ?? [])
    .map((r) => `${r.type}:${r.id}`)
    .sort()
    .join(',');
const bindingId = (b: unknown) => (b && typeof b === 'object' ? ((b as { elementId?: string }).elementId ?? null) : null);

/**
 * Whether the canvas element already shows what the doc wants. Text geometry is left out: the
 * canvas measures text with the real font and places bound text itself.
 */
export function sameElement(local: El, want: El): boolean {
  const text = want.type === 'text';
  const keys: string[] = [
    'type',
    'isDeleted',
    'frameId',
    'locked',
    'link',
    'strokeColor',
    'backgroundColor',
    'fillStyle',
    'strokeWidth',
    'strokeStyle',
    'opacity',
    'roughness',
    'angle',
    'name',
    'originalText',
    'containerId',
    'fontSize',
    'fontFamily',
    'textAlign',
    'verticalAlign',
  ];
  if (!text) keys.push('x', 'y', 'width', 'height');
  else if (!want.containerId) keys.push('x', 'y');
  for (const k of keys) if ((local[k] ?? null) !== (want[k] ?? null)) return false;
  if (sortedIds(local.boundElements) !== sortedIds(want.boundElements)) return false;
  if (bindingId(local.startBinding) !== bindingId(want.startBinding) || bindingId(local.endBinding) !== bindingId(want.endBinding)) return false;
  if (want.type === 'arrow' && JSON.stringify(local.points) !== JSON.stringify(want.points)) return false;
  return JSON.stringify(local.customData ?? null) === JSON.stringify(want.customData ?? null);
}

const nonce = () => Math.floor(Math.random() * 2 ** 31);

/** `want`, as the next version of `local`. */
function bump(local: El, want: El): El {
  return { ...want, version: local.version + 1, versionNonce: nonce(), index: local.index, updated: Date.now() };
}

export interface MergeInput {
  /** From `docElements`. */
  desired: readonly El[];
  /** Free drawing stored in the doc, by element id. */
  stored: ReadonlyMap<string, CanvasShape>;
  /** The canvas now, deleted elements included. */
  local: readonly El[];
  held: ReadonlySet<string>;
  /** Free-drawing ids this canvas has seen in the doc: one of them missing from the doc was deleted elsewhere. */
  known: ReadonlySet<string>;
}

/**
 * The scene to show: the doc laid over the canvas. Held elements stay as they are. Any other
 * element the doc owns takes the doc's state, keeping the local object when nothing differs (so the
 * canvas does not redraw it). Free drawing goes by version. Unchanged returns `changed: false`, and
 * then nothing needs to go to the canvas.
 */
export function mergeScene({ desired, stored, local, held, known }: MergeInput): { elements: El[]; changed: boolean } {
  const localById = new Map(local.map((e) => [e.id, e]));
  const desiredIds = new Set(desired.map((e) => e.id));
  const merged = new Map<string, El>();

  const settle = (want: El): El => {
    const l = localById.get(want.id);
    if (!l) return want;
    if (held.has(want.id)) return l;
    // Keep arrows the user bound to this element by hand.
    const extra = (l.boundElements ?? []).filter((r) => !desiredIds.has(r.id) && localById.has(r.id) && !kindOf(localById.get(r.id)));
    if (extra.length) want = { ...want, boundElements: [...(want.boundElements ?? []), ...extra] };
    return sameElement(l, want) ? l : bump(l, want);
  };

  // Shapes first, then arrows (they follow the shapes they join), then bound text.
  for (const want of desired) if (want.type !== 'arrow' && !BOUND_TEXT_KINDS.has(kindOf(want)!)) merged.set(want.id, settle(want));
  for (const want of desired) {
    if (want.type !== 'arrow') continue;
    const l = localById.get(want.id);
    const from = bindingId(want.startBinding)!;
    const to = bindingId(want.endBinding)!;
    const a = merged.get(from);
    const b = merged.get(to);
    if (!a || !b) continue;
    const la = localById.get(from);
    const lb = localById.get(to);
    const moved =
      !l ||
      l.isDeleted ||
      bindingId(l.startBinding) !== from ||
      bindingId(l.endBinding) !== to ||
      !la ||
      !lb ||
      JSON.stringify(boxOf(la)) !== JSON.stringify(boxOf(a)) ||
      JSON.stringify(boxOf(lb)) !== JSON.stringify(boxOf(b));
    const geometry = moved
      ? arrowGeometry(boxOf(a), boxOf(b))
      : { x: l.x, y: l.y, width: l.width, height: l.height, points: l.points as [number, number][] };
    merged.set(want.id, settle({ ...want, ...geometry }));
  }
  for (const want of desired) {
    if (!BOUND_TEXT_KINDS.has(kindOf(want)!)) continue;
    const container = merged.get(want.containerId as string);
    if (!container) continue;
    let t = want;
    if (container.type === 'arrow') {
      const mid = arrowMiddle(container);
      t = { ...want, x: mid.x - want.width / 2, y: mid.y - want.height / 2 };
    }
    merged.set(want.id, settle(t));
  }

  // Free drawing: whatever is newer wins; held is the user's.
  const free = new Map<string, El>();
  const freeIds: string[] = [];
  for (const l of local) {
    if (desiredIds.has(l.id) || kindOf(l)) continue;
    freeIds.push(l.id);
  }
  for (const id of stored.keys()) if (!desiredIds.has(id) && !localById.has(id)) freeIds.push(id);
  for (const id of freeIds) {
    const l = localById.get(id);
    const s = stored.get(id) as El | undefined;
    if (l && held.has(id)) free.set(id, l);
    else if (!l) free.set(id, s!);
    else if (!s) free.set(id, known.has(id) && !l.isDeleted ? bump(l, { ...l, isDeleted: true }) : l);
    else if (s.version > l.version) free.set(id, { ...s, index: l.index });
    else free.set(id, l);
  }

  // In order: the doc's shapes, free drawing, then arrows and their labels.
  const elements: El[] = [];
  const isTop = (e: El) => e.type === 'arrow' || BOUND_TEXT_KINDS.has(kindOf(e)!);
  for (const want of desired) if (!isTop(want) && merged.has(want.id)) elements.push(merged.get(want.id)!);
  for (const id of freeIds) elements.push(free.get(id)!);
  for (const want of desired) if (isTop(want) && merged.has(want.id)) elements.push(merged.get(want.id)!);

  const changed = elements.length !== local.length || elements.some((e, i) => e !== local[i]);
  return { elements, changed };
}
