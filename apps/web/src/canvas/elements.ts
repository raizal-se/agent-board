/**
 * Excalidraw elements as plain values. The bridge builds and reads them without importing
 * Excalidraw, so it stays pure and testable; the canvas casts them at the boundary. The fields are
 * those of `_ExcalidrawElementBase` and the element types in @excalidraw/excalidraw 0.18.1
 * (dist/types/excalidraw/element/types.d.ts).
 */

/** What a board element is. Stored in `customData.ab`; elements without it are free drawing. */
export type Kind =
  | 'frame'
  | 'zone'
  | 'zone-label'
  | 'file'
  | 'decision'
  | 'snapshot'
  | 'snapshot-link'
  | 'sticky'
  | 'sticky-text'
  | 'file-edge'
  | 'file-edge-label'
  | 'link'
  | 'link-label';

export interface BoundRef {
  id: string;
  type: 'arrow' | 'text';
}

export interface Binding {
  elementId: string;
  focus: number;
  gap: number;
}

/** One Excalidraw element. Type-specific fields ride along in the index signature. */
export interface El {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: string;
  strokeWidth: number;
  strokeStyle: string;
  roundness: null | { type: number; value?: number };
  roughness: number;
  opacity: number;
  seed: number;
  version: number;
  versionNonce: number;
  index: string | null;
  isDeleted: boolean;
  groupIds: readonly string[];
  frameId: string | null;
  boundElements: readonly BoundRef[] | null;
  updated: number;
  link: string | null;
  locked: boolean;
  customData?: Record<string, unknown>;
  [key: string]: unknown;
}

export const kindOf = (el: Pick<El, 'customData'> | undefined): Kind | undefined => el?.customData?.ab as Kind | undefined;

/** Our embeddables carry this link; `validateEmbeddable` accepts only it. */
export const EMBED_SCHEME = 'agent-board:';
export const embedLink = (id: string) => `${EMBED_SCHEME}${id}`;

/** Excalidraw's FONT_FAMILY.Helvetica: a system font, nothing to download. */
export const FONT_HELVETICA = 2;
export const LINE_HEIGHT = 1.15;
/** Excalidraw's BOUND_TEXT_PADDING. */
export const TEXT_PAD = 5;
export const ARROW_GAP = 4;

export const INK = '#1f1f1c';
export const MUTED = '#6f6e69';

/** A steady seed from the id, so the same element always draws the same. */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return (h % 2_000_000_000) + 1;
}

export function base(id: string, type: string, kind: Kind | undefined, extra: Partial<El> = {}): El {
  return {
    id,
    type,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: INK,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roundness: null,
    roughness: 0,
    opacity: 100,
    seed: seedOf(id),
    version: 1,
    versionNonce: 0,
    index: null,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    ...(kind ? { customData: { ab: kind } } : {}),
    ...extra,
  };
}

/** Measures one line of text in px. The canvas passes one that uses a real 2D context. */
export type Measure = (line: string, fontSize: number) => number;

/** A rough measure for tests and for when no canvas is there. */
export const roughMeasure: Measure = (line, fontSize) => line.length * fontSize * 0.55;

/** Greedy word wrap to a width, keeping the line breaks of the text. */
export function wrap(text: string, width: number, fontSize: number, measure: Measure): string {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line && measure(next.trimEnd(), fontSize) > width) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else {
        line = next;
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

export function textEl(
  id: string,
  kind: Kind | undefined,
  o: {
    text: string;
    x: number;
    y: number;
    fontSize: number;
    measure: Measure;
    containerId?: string | null;
    /** Wrap to this width (text in a container). */
    wrapWidth?: number;
    color?: string;
    frameId?: string | null;
    locked?: boolean;
    align?: 'left' | 'center';
    verticalAlign?: 'top' | 'middle';
    customData?: Record<string, unknown>;
  },
): El {
  const shown = o.wrapWidth ? wrap(o.text, o.wrapWidth, o.fontSize, o.measure) : o.text;
  const lines = shown.split('\n');
  const width = o.wrapWidth ?? Math.max(1, ...lines.map((l) => o.measure(l, o.fontSize)));
  return base(id, 'text', kind, {
    x: o.x,
    y: o.y,
    width,
    height: lines.length * o.fontSize * LINE_HEIGHT,
    strokeColor: o.color ?? INK,
    frameId: o.frameId ?? null,
    locked: o.locked ?? false,
    fontSize: o.fontSize,
    fontFamily: FONT_HELVETICA,
    text: shown,
    originalText: o.text,
    textAlign: o.align ?? 'left',
    verticalAlign: o.verticalAlign ?? 'top',
    containerId: o.containerId ?? null,
    autoResize: true,
    lineHeight: LINE_HEIGHT,
    ...(o.customData ? { customData: { ...(kind ? { ab: kind } : {}), ...o.customData } } : {}),
  });
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const boxOf = (el: Pick<El, 'x' | 'y' | 'width' | 'height'>): Box => ({ x: el.x, y: el.y, w: el.width, h: el.height });

/** Where the line from the centre of `b` towards `p` leaves `b`. */
function exitPoint(b: Box, p: { x: number; y: number }): { x: number; y: number } {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const tx = dx === 0 ? Infinity : b.w / 2 / Math.abs(dx);
  const ty = dy === 0 ? Infinity : b.h / 2 / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}

/**
 * A straight arrow from box `a` to box `b`, from edge to edge, `gap` off each: the way Excalidraw
 * draws an arrow bound to both through their centres (focus 0).
 */
export function arrowGeometry(a: Box, b: Box, gap = ARROW_GAP): Pick<El, 'x' | 'y' | 'width' | 'height'> & { points: [number, number][] } {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  let s = exitPoint(a, cb);
  let e = exitPoint(b, ca);
  const len = Math.hypot(e.x - s.x, e.y - s.y);
  // Overlapping boxes: centre to centre.
  if (len < 2 * gap + 1 || (s.x - e.x) * (ca.x - cb.x) < 0 || (s.y - e.y) * (ca.y - cb.y) < 0) {
    s = ca;
    e = cb;
  } else {
    const ux = (e.x - s.x) / len;
    const uy = (e.y - s.y) / len;
    s = { x: s.x + ux * gap, y: s.y + uy * gap };
    e = { x: e.x - ux * gap, y: e.y - uy * gap };
  }
  const dx = e.x - s.x;
  const dy = e.y - s.y;
  return { x: s.x, y: s.y, width: Math.abs(dx), height: Math.abs(dy), points: [[0, 0], [dx, dy]] };
}

export function arrowEl(
  id: string,
  kind: Kind,
  o: { from: string; to: string; a: Box; b: Box; dashed?: boolean; locked?: boolean; customData?: Record<string, unknown> },
): El {
  return base(id, 'arrow', kind, {
    ...arrowGeometry(o.a, o.b),
    strokeWidth: o.dashed ? 1.5 : 2,
    strokeStyle: o.dashed ? 'dotted' : 'solid',
    strokeColor: o.dashed ? MUTED : INK,
    roundness: { type: 2 },
    locked: o.locked ?? false,
    lastCommittedPoint: null,
    startBinding: { elementId: o.from, focus: 0, gap: ARROW_GAP },
    endBinding: { elementId: o.to, focus: 0, gap: ARROW_GAP },
    startArrowhead: null,
    endArrowhead: 'arrow',
    elbowed: false,
    customData: { ab: kind, ...o.customData },
  });
}

/** The middle of an arrow, for its label. */
export function arrowMiddle(el: Pick<El, 'x' | 'y'> & { points?: unknown }): { x: number; y: number } {
  const pts = (el.points as [number, number][] | undefined) ?? [[0, 0]];
  const last = pts[pts.length - 1]!;
  return { x: el.x + last[0] / 2, y: el.y + last[1] / 2 };
}
