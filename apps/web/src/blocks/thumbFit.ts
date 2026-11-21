import { BLOCK_W } from '@agent-board/model';

/** The page renders at this size, then scales down into the thumbnail. */
export const PAGE_W = 1280;
export const PAGE_H = 800;
export const THUMB_W = BLOCK_W - 2;
export const THUMB_H = Math.round(PAGE_H * (THUMB_W / PAGE_W));

/** Narrowest stretch of the page a thumbnail zooms to, and the margin kept around the content. */
const MIN_W = 360;
const MARGIN = 16;

export interface ThumbFit {
  scale: number;
  /** Page pixels cut off on the left and top. */
  x: number;
  y: number;
}

/** The whole page width, scaled down. Used until the page reports its content box. */
export const WHOLE_PAGE: ThumbFit = { scale: THUMB_W / PAGE_W, x: 0, y: 0 };

/**
 * Zoom the thumbnail to the page's content box ([left, top, right, bottom] in page pixels), so a
 * small mockup fills the thumbnail width instead of sitting in a corner of a 1280 px page.
 * The numbers come from the page, which is untrusted: anything odd gives the whole page.
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
  const top = Math.min(Math.max(0, t - MARGIN), PAGE_H - THUMB_H / scale);
  return { scale, x: Math.round(left), y: Math.round(Math.max(0, top)) };
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
