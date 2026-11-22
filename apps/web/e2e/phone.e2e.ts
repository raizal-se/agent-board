import { devices, expect, test, type Page } from '@playwright/test';
import { areaEl, block, firstFrame, guardPage, idOf, openBoard, pressPoint, scene, toScreen, view } from './canvas';
import { startCli, type RunningCli } from './cli';

/** The board on a phone: the first view, a tap on a block, its full view, pinch zoom and two-finger pan. */
test.use({ ...devices['Pixel 7'] });

const FILES: Record<string, string> = {
  'checkout/flow.md': '# Checkout flow\n\nCard form, then the payment API.\n',
  'checkout/api.md': '# Payment API\n\nPOST /pay\n',
  'ui/notes.md': '# UI notes\n',
  'readme.md': '# Payments board\n',
};

let cli: RunningCli | undefined;
guardPage(() => cli);
test.beforeEach(async () => {
  cli = await startCli(FILES);
});

/**
 * Open the board as a phone user does (no fit), and return the first card of the first feature
 * board: the leftmost frame's Product card nearest the top left. Its block must show.
 */
async function openFirst(page: Page): Promise<string> {
  await openBoard(page, cli!, 'checkout/flow.md', { fit: false });
  const els = await scene(page);
  const frame = firstFrame(els)!;
  const card = els
    .filter((e) => e.ab?.ab === 'file' && e.frameId === frame.id)
    .sort((a, b) => a.y - b.y || a.x - b.x)[0]!;
  const path = card.ab!.path as string;
  await expect(block(page, path), 'a card of the first feature board shows in the first view').toBeVisible();
  return path;
}

/** The heading of a fixture file: what its full view shows. */
const heading = (path: string) => FILES[path]!.split('\n')[0]!.replace(/^# /, '');

/** Two fingers, from `from` to `to` (screen points), through Chrome's touch input. */
async function twoFingers(page: Page, from: [{ x: number; y: number }, { x: number; y: number }], to: [{ x: number; y: number }, { x: number; y: number }]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const pts = (t: number) => from.map((p, i) => ({ x: p.x + (to[i]!.x - p.x) * t, y: p.y + (to[i]!.y - p.y) * t, id: i }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(0) });
  for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(i / 10) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test('the first view opens on the first feature board, one card across, readable, just under the bars; Fit all shows the rest', async ({ page }) => {
  const first = await openFirst(page);
  const { width, height } = page.viewportSize()!;
  const v = await view(page);
  // One card (with its area's padding) fills the width: the text is readable.
  expect(v.zoom).toBeGreaterThan(0.6);
  const els = await scene(page);
  const frame = firstFrame(els)!;
  const product = areaEl(els, frame.name!, 'product')!;
  // The Product area starts at the left edge, not cut off, and just under the bars.
  const tl = await toScreen(page, { x: product.x, y: product.y });
  expect(tl.x).toBeGreaterThanOrEqual(0);
  expect(tl.x).toBeLessThan(24);
  expect(tl.y).toBeGreaterThan(60);
  expect(tl.y).toBeLessThan(height / 4);
  // The first card is on screen, whole across.
  const card = (await block(page, first).boundingBox())!;
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.x + card.width).toBeLessThanOrEqual(width);
  expect(card.width).toBeGreaterThan(width * 0.7);

  // Fit all: the whole board, from the top, across the width.
  await page.getByRole('button', { name: 'Fit all' }).tap();
  await expect.poll(async () => (await view(page)).zoom).toBeLessThan(v.zoom / 2);
  const all = await scene(page);
  const left = await toScreen(page, { x: Math.min(...all.map((e) => e.x)), y: Math.min(...all.map((e) => e.y)) });
  const right = await toScreen(page, { x: Math.max(...all.map((e) => e.x + e.width)), y: 0 });
  expect(left.x).toBeGreaterThanOrEqual(0);
  expect(right.x).toBeLessThanOrEqual(width);
});

test('tap a block to select it; its open button shows the full view, and so does the Open in the bar', async ({ page }) => {
  const first = await openFirst(page);
  const p = await pressPoint(page, await idOf(page, first));
  await page.touchscreen.tap(p.x, p.y);
  const bar = page.getByTestId('selection-bar');
  await expect(bar, 'the tap selects the block').toContainText(first);
  // On a phone the bar sits at the bottom, clear of the blocks' own buttons at their top.
  const barBox = (await bar.boundingBox())!;
  expect(barBox.y, 'the selection bar is in the lower half of the screen').toBeGreaterThan(page.viewportSize()!.height / 2);
  const open = block(page, first).getByRole('button', { name: `open ${first}` });
  await expect(open, "the block's open button is on screen").toBeInViewport();
  // Bounded: if something covers the button (a bar), the error names it instead of the test timing out.
  await open.tap({ timeout: 10_000 });
  await expect(page.getByTestId('fullview'), 'the open button shows the full view').toBeVisible();
  await expect(page.getByTestId('fullview')).toContainText(heading(first));

  await page.getByTestId('fullview').getByRole('button', { name: 'Close' }).tap({ timeout: 10_000 });
  await expect(page.getByTestId('fullview'), 'Close shuts the full view').toHaveCount(0);
  await expect(bar, 'the block is still selected').toContainText(first);
  await bar.getByRole('button', { name: 'Open', exact: true }).tap({ timeout: 10_000 });
  await expect(page.getByTestId('fullview'), "the bar's Open shows the full view").toContainText(heading(first));
});

test('pinch zooms in, two fingers pan', async ({ page }) => {
  await openFirst(page);
  const { width, height } = page.viewportSize()!;
  const cy = height * 0.7;
  const before = await view(page);
  await twoFingers(page, [{ x: width / 2 - 30, y: cy }, { x: width / 2 + 30, y: cy }], [{ x: width / 2 - 120, y: cy }, { x: width / 2 + 120, y: cy }]);
  await expect.poll(async () => (await view(page)).zoom).toBeGreaterThan(before.zoom * 1.5);

  const zoomed = await view(page);
  await twoFingers(page, [{ x: width / 2 - 40, y: cy }, { x: width / 2 + 40, y: cy }], [{ x: width / 2 - 40, y: cy - 150 }, { x: width / 2 + 40, y: cy - 150 }]);
  await expect.poll(async () => (await view(page)).scrollY).toBeLessThan(zoomed.scrollY - 50 / zoomed.zoom);
});
