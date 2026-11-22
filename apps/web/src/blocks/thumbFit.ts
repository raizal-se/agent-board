import { BLOCK_W } from '@agent-board/model';

/** The thumbnail is never smaller than this share of the page: text stays readable on the board. */
export const MIN_SCALE = 0.6;
export const THUMB_W = BLOCK_W - 2;
/** The page lays out at this width, then scales down into the thumbnail (at least `MIN_SCALE`). */
export const PAGE_W = Math.round(THUMB_W / MIN_SCALE);
/** The page height shown until the page reports its content box. */
export const PAGE_H = 800;
/** The tallest stretch of a page a thumbnail shows; the card caps its own height (see cardFit.ts). */
export const PAGE_MAX_H = 8000;

/** Narrowest stretch of the page a thumbnail zooms to, and the margin kept around the content. */
const MIN_W = 360;
const MARGIN = 16;
const MIN_H = 120;

export interface ThumbFit {
  scale: number;
  /** Page pixels cut off on the left and top. */
  x: number;
  y: number;
  /** Page pixels shown from `y` down: the content's height. */
  h: number;
}

/** The whole page width, scaled down. Used until the page reports its content box. */
export const WHOLE_PAGE: ThumbFit = { scale: THUMB_W / PAGE_W, x: 0, y: 0, h: PAGE_H };

/** The thumbnail's size on the card. */
export const thumbSize = (f: ThumbFit) => ({ w: THUMB_W, h: Math.round(f.h * f.scale) });

/**
 * Zoom the thumbnail to the page's content box ([left, top, right, bottom] in page pixels), so a
 * small mockup fills the thumbnail width instead of sitting in a corner, and show the content's
 * full height. The numbers come from the page, which is untrusted: anything odd gives the whole page.
 */
export function fitToContent(box: unknown): ThumbFit {
  if (!Array.isArray(box) || box.length !== 4 || !box.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return WHOLE_PAGE;
  }
  const [l, t, r, b] = box as [number, number, number, number];
  if (r <= l || b <= t) return WHOLE_PAGE;
  const left = Math.min(Math.max(0, l - MARGIN), PAGE_W - MIN_W);
  const right = Math.min(PAGE_W, Math.max(r + MARGIN, left + MIN_W));
  const scale = THUMB_W / (right - left);
  const top = Math.min(Math.max(0, t - MARGIN), PAGE_MAX_H - MIN_H);
  const h = Math.min(PAGE_MAX_H - top, Math.max(MIN_H / scale, b + MARGIN - top));
  return { scale, x: Math.round(left), y: Math.round(top), h: Math.ceil(h) };
}

/**
 * Appended to the thumbnail's copy of the page (never the full view). It measures what the page
 * paints, text, images, controls and boxes with a background, border or shadow, and posts that
 * box to the board. It reads nothing else and runs inside the sandbox.
 */
export const FIT_SCRIPT = `<script>(function () {
  function measure() {
    var l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    function add(x) {
      if (x.width < 1 || x.height < 1) return;
      l = Math.min(l, x.left); t = Math.min(t, x.top); r = Math.max(r, x.right); b = Math.max(b, x.bottom);
    }
    var root = document.body || document.documentElement;
    var walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    var range = document.createRange();
    for (var n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n.nodeType === 3) {
        if (!n.textContent.trim()) continue;
        range.selectNodeContents(n);
        add(range.getBoundingClientRect());
        continue;
      }
      var cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      var replaced = /^(img|svg|canvas|video|input|button|select|textarea|iframe|picture)$/i.test(n.tagName);
      var painted = (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') ||
        cs.backgroundImage !== 'none' || cs.boxShadow !== 'none' ||
        parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0;
      if (replaced || painted) add(n.getBoundingClientRect());
    }
    if (r > l && b > t) parent.postMessage({ agentBoardFit: [l + scrollX, t + scrollY, r + scrollX, b + scrollY] }, '*');
  }
  addEventListener('load', function () { measure(); setTimeout(measure, 600); setTimeout(measure, 2000); });
})();</script>`;
