import { expect, test, type Page } from '@playwright/test';
import { startCli, type RunningCli } from './cli';

/**
 * The Excalidraw spike: the demo board on the new canvas. The canvas draws on a <canvas>, so these
 * checks read the scene through `window.__board.api` and look at the blocks' own DOM (embeds).
 */

const FLOW = `---
links:
  - to: checkout/api.md
    label: calls
---
# Checkout flow

\`\`\`mermaid
flowchart LR
  A[Card form] --> B[Payment API]
\`\`\`
`;

const PAGE = `<!doctype html>
<body style="font: 24px sans-serif"><h1 id="title">Card form</h1><button>Pay</button></body>`;

const FILES = {
  'checkout/flow.md': FLOW,
  'checkout/api.md': '# Payment API\n\nPOST /pay\n',
  'ui/card-form.html': PAGE,
  'readme.md': '# Payments board\n',
};

interface SceneEl {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string | null;
  frameId: string | null;
  start: string | null;
  end: string | null;
  ab: Record<string, unknown> | null;
}

let cli: RunningCli;
let errors: string[];
let outside: string[];

test.beforeEach(async ({ page }) => {
  errors = [];
  outside = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    const url = r.url();
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return;
    if (cli && new URL(url).origin !== new URL(cli.url).origin) outside.push(url);
  });
});

test.afterEach(async () => {
  await cli?.stop();
  expect(errors, 'no errors in the page').toEqual([]);
  expect(outside, 'no requests to anything but the board').toEqual([]);
});

const block = (page: Page, path: string) => page.locator(`[data-testid="block"][data-path="${path}"]`);

async function scene(page: Page): Promise<SceneEl[]> {
  return page.evaluate(() => {
    const api = (window as unknown as { __board: { api: { getSceneElements(): Record<string, any>[] } } }).__board.api;
    return api.getSceneElements().map((e) => ({
      id: e.id,
      type: e.type,
      x: e.x,
      y: e.y,
      width: e.width,
      height: e.height,
      name: e.name ?? null,
      frameId: e.frameId ?? null,
      start: e.startBinding?.elementId ?? null,
      end: e.endBinding?.elementId ?? null,
      ab: e.customData ?? null,
    }));
  });
}

const byPath = (els: SceneEl[], path: string) => els.find((e) => e.ab?.ab === 'file' && e.ab.path === path)!;

async function open(page: Page, first = 'checkout/flow.md') {
  await page.goto(cli.url);
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'online');
  await expect(block(page, first)).toBeVisible();
  // The block's DOM can show before the scene settles: wait for its element in the scene too.
  await expect.poll(async () => !!byPath(await scene(page), first)).toBe(true);
}

test('frames from folders, live markdown and mermaid, an HTML thumbnail, a file link as a bound arrow', async ({ page }) => {
  cli = await startCli(FILES);
  await open(page);

  const els = await scene(page);
  const frames = els.filter((e) => e.type === 'frame').map((e) => e.name).sort();
  expect(frames).toEqual(['checkout', 'payments', 'ui']);

  // Blocks are embeddables inside their folder's frame.
  const flow = byPath(els, 'checkout/flow.md');
  const api = byPath(els, 'checkout/api.md');
  expect(flow.type).toBe('embeddable');
  expect(flow.frameId).toBe(els.find((e) => e.type === 'frame' && e.name === 'checkout')!.id);

  // Markdown and mermaid render live in the block.
  await expect(block(page, 'checkout/flow.md').locator('.mermaid-block svg')).toBeVisible();
  await expect(block(page, 'checkout/flow.md')).not.toContainText('links:');
  await expect(block(page, 'readme.md')).toContainText('Payments board');
  const token = `saved-${Date.now()}`;
  const t0 = Date.now();
  cli.write('checkout/api.md', `# Payment API\n\n${token}\n`);
  await expect(block(page, 'checkout/api.md')).toContainText(token, { timeout: 3000 });
  test.info().annotations.push({ type: 'save-to-screen ms', description: String(Date.now() - t0) });

  // The HTML block is a sandboxed thumbnail.
  const frame = block(page, 'ui/card-form.html').locator('iframe');
  await expect(frame).toHaveAttribute('sandbox', /allow-scripts/);
  await expect(page.frameLocator(`[data-path="ui/card-form.html"] iframe`).locator('#title')).toHaveText('Card form');

  // The link in flow.md is an arrow bound to both blocks.
  const arrow = els.find((e) => e.type === 'arrow' && e.ab?.ab === 'file-edge')!;
  expect(arrow).toBeTruthy();
  expect([arrow.start, arrow.end]).toEqual([flow.id, api.id]);
});

test('a dragged block keeps its place after a reload; a file save during the drag does not move it', async ({ page }) => {
  cli = await startCli(FILES);
  await open(page);

  const target = block(page, 'checkout/flow.md');
  const box0 = (await target.boundingBox())!;
  const before = byPath(await scene(page), 'checkout/flow.md');
  const sx = box0.x + 40;
  const sy = box0.y + 20;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 30, sy + 20, { steps: 5 });
  await page.mouse.move(sx + 60, sy + 40, { steps: 5 });
  const held = (await target.boundingBox())!;
  expect(held.x).toBeCloseTo(box0.x + 60, -1);

  // The agent saves the file mid-drag: the content updates, the block stays under the hand.
  const token = `mid-drag-${Date.now()}`;
  cli.write('checkout/flow.md', `${FLOW}\n${token}\n`);
  await expect(target).toContainText(token, { timeout: 3000 });
  const during = (await target.boundingBox())!;
  expect(during.x).toBeCloseTo(held.x, 0);
  expect(during.y).toBeCloseTo(held.y, 0);

  await page.mouse.move(sx + 120, sy + 60, { steps: 5 });
  await page.mouse.up();
  const dropped = (await target.boundingBox())!;
  expect(dropped.x).toBeCloseTo(box0.x + 120, -1);
  expect(dropped.y).toBeCloseTo(box0.y + 60, -1);

  // Written to the doc (and so to disk by the CLI): the place survives a reload.
  await expect.poll(async () => byPath(await scene(page), 'checkout/flow.md').x).not.toBe(before.x);
  const moved = byPath(await scene(page), 'checkout/flow.md');
  await page.waitForTimeout(600);
  await page.reload();
  await expect(target).toBeVisible();
  await expect(target).toContainText(token);
  const after = byPath(await scene(page), 'checkout/flow.md');
  expect(Math.round(after.x)).toBe(Math.round(moved.x));
  expect(Math.round(after.y)).toBe(Math.round(moved.y));
});

test('20 blocks: load, live saves and a drag stay quick', async ({ page }) => {
  const many: Record<string, string> = { ...FILES };
  for (let i = 0; i < 18; i++) many[`notes/n${String(i).padStart(2, '0')}.md`] = i % 3 === 0 ? FLOW.replace('checkout/api.md', 'notes/n01.md') : `# Note ${i}\n\n${'Some text. '.repeat(40)}\n`;
  cli = await startCli(many);
  const t0 = Date.now();
  await open(page, 'notes/n17.md');
  await expect(page.locator('[data-testid="block"]')).toHaveCount(Object.keys(many).length);
  const load = Date.now() - t0;

  const saves: number[] = [];
  for (let i = 0; i < 5; i++) {
    const token = `tick-${Date.now()}-${i}`;
    const s = Date.now();
    cli.write('notes/n05.md', `# Note 5\n\n${token}\n`);
    await expect(block(page, 'notes/n05.md')).toContainText(token, { timeout: 3000 });
    saves.push(Date.now() - s);
  }

  // Frame times while dragging a block across the board.
  const target = block(page, 'notes/n02.md');
  const box = (await target.boundingBox())!;
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __stop: boolean };
    w.__frames = [];
    w.__stop = false;
    let last = performance.now();
    const tick = (t: number) => {
      w.__frames.push(t - last);
      last = t;
      if (!w.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(box.x + 30, box.y + 15);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) await page.mouse.move(box.x + 30 + i * 6, box.y + 15 + i * 2);
  await page.mouse.up();
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __stop: boolean };
    w.__stop = true;
    return w.__frames.slice(1);
  });
  const sorted = [...frames].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  const numbers = { blocks: Object.keys(many).length, loadMs: load, saveMedianMs: median(saves), saveMaxMs: Math.max(...saves), dragFrameMedianMs: Math.round(median(frames)), dragFrameP95Ms: Math.round(p95) };
  console.log('spike numbers', JSON.stringify(numbers));
  test.info().annotations.push({ type: 'numbers', description: JSON.stringify(numbers) });
  expect(median(saves)).toBeLessThan(1000);
  expect(p95).toBeLessThan(100);
});
