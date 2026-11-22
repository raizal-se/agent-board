import { devices, expect, test, type Page } from '@playwright/test';
import { block, guardPage, idOf, openBoard, pressPoint, scene, toScreen } from './canvas';
import { startCli, type RunningCli } from './cli';

/** The board on a phone: the first view, a tap on a block, its full view, pinch zoom and two-finger pan. */
test.use({ ...devices['Pixel 7'] });

const FILES = {
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

async function view(page: Page): Promise<{ scrollX: number; scrollY: number; zoom: number }> {
  return page.evaluate(() => {
    const s = (window as unknown as { __board: { api: { getAppState(): Record<string, any> } } }).__board.api.getAppState();
    return { scrollX: s.scrollX, scrollY: s.scrollY, zoom: s.zoom.value };
  });
}

/** Two fingers, from `from` to `to` (screen points), through Chrome's touch input. */
async function twoFingers(page: Page, from: [{ x: number; y: number }, { x: number; y: number }], to: [{ x: number; y: number }, { x: number; y: number }]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const pts = (t: number) => from.map((p, i) => ({ x: p.x + (to[i]!.x - p.x) * t, y: p.y + (to[i]!.y - p.y) * t, id: i }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(0) });
  for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(i / 10) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test('the first view fits the board to the width, just under the bars, with no empty half above', async ({ page }) => {
  await openBoard(page, cli!, 'checkout/flow.md');
  const width = page.viewportSize()!.width;
  const height = page.viewportSize()!.height;
  await expect.poll(async () => (await view(page)).zoom).toBeLessThan(1);
  const els = await scene(page);
  const tl = await toScreen(page, { x: Math.min(...els.map((e) => e.x)), y: Math.min(...els.map((e) => e.y)) });
  const br = await toScreen(page, { x: Math.max(...els.map((e) => e.x + e.width)), y: Math.max(...els.map((e) => e.y + e.height)) });
  expect(tl.x).toBeGreaterThanOrEqual(0);
  expect(tl.x).toBeLessThan(24);
  expect(br.x).toBeLessThanOrEqual(width);
  expect(br.x).toBeGreaterThan(width - 24);
  expect(tl.y).toBeGreaterThan(60);
  expect(tl.y).toBeLessThan(height / 4);
});

test('tap a block to select it; its open button shows the full view', async ({ page }) => {
  await openBoard(page, cli!, 'checkout/flow.md');
  const p = await pressPoint(page, await idOf(page, 'checkout/flow.md'));
  await page.touchscreen.tap(p.x, p.y);
  await expect(page.getByTestId('selection-bar'), 'the tap selects the block').toContainText('checkout/flow.md');
  const open = block(page, 'checkout/flow.md').getByRole('button', { name: 'open checkout/flow.md' });
  await expect(open, "the block's open button is on screen").toBeInViewport();
  // Bounded: if something covers the button (a bar), the error names it instead of the test timing out.
  await open.tap({ timeout: 10_000 });
  await expect(page.getByTestId('fullview'), 'the open button shows the full view').toBeVisible();
  await expect(page.getByTestId('fullview')).toContainText('Card form, then the payment API.');
});

test('pinch zooms in, two fingers pan', async ({ page }) => {
  await openBoard(page, cli!, 'checkout/flow.md');
  const { width, height } = page.viewportSize()!;
  const cy = height * 0.7;
  const before = await view(page);
  await twoFingers(page, [{ x: width / 2 - 30, y: cy }, { x: width / 2 + 30, y: cy }], [{ x: width / 2 - 120, y: cy }, { x: width / 2 + 120, y: cy }]);
  await expect.poll(async () => (await view(page)).zoom).toBeGreaterThan(before.zoom * 1.5);

  const zoomed = await view(page);
  await twoFingers(page, [{ x: width / 2 - 40, y: cy }, { x: width / 2 + 40, y: cy }], [{ x: width / 2 - 40, y: cy - 150 }, { x: width / 2 + 40, y: cy - 150 }]);
  await expect.poll(async () => (await view(page)).scrollY).toBeLessThan(zoomed.scrollY - 50 / zoomed.zoom);
});
