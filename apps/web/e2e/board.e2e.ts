import { expect, test, type Page } from '@playwright/test';
import { renameSync } from 'node:fs';
import { join } from 'node:path';
import { areaEl, areaOfPath, block, boundText, byPath, clickEl, exported, fitAll, guardPage, idOf, ofKind, openBoard, placeOf, pressPoint, scene, screenBox, type SceneEl } from './canvas';
import { startCli, type RunningCli } from './cli';

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
<meta name="board:link" content="checkout/flow.md | shows">
<body style="font: 24px sans-serif">
  <h1 id="title">Card form</h1>
  <button id="pay" onclick="document.getElementById('title').textContent = 'clicked'">Pay</button>
  <script>document.body.dataset.ran = 'yes'; document.getElementById('title').textContent += ' (script ran)';</script>
</body>`;

const FILES = {
  'checkout/flow.md': FLOW,
  'checkout/api.md': '# Payment API\n\nPOST /pay\n',
  'checkout/later.md': '# Later\n',
  'ui/card-form.html': PAGE,
  'readme.md': '# Payments board\n',
};

// Each test gets its own folder and its own CLI, so one failure does not hide the others.
let cli: RunningCli | undefined;
guardPage(() => cli);
test.beforeEach(async () => {
  cli = await startCli(FILES);
});

const open = (page: Page) => openBoard(page, cli!, 'checkout/flow.md');

/** The file link from one path to another, as an arrow on the canvas. */
function fileEdge(els: SceneEl[], from: string, to: string): SceneEl | undefined {
  const a = byPath(els, from);
  const b = byPath(els, to);
  return ofKind(els, 'file-edge').find((e) => a && b && e.start === a.id && e.end === b.id);
}

test('each subfolder is a frame, root files go to the folder frame; blocks show no link icon', async ({ page }) => {
  await open(page);
  const els = await scene(page);
  expect(els.filter((e) => e.type === 'frame').map((e) => e.name).sort()).toEqual(['checkout', 'payments', 'ui']);
  const frameOf = (path: string) => els.find((e) => e.id === byPath(els, path)!.frameId)?.name;
  expect(frameOf('checkout/api.md')).toBe('checkout');
  expect(frameOf('ui/card-form.html')).toBe('ui');
  expect(frameOf('readme.md')).toBe('payments');
  await expect(block(page, 'readme.md')).toContainText('Payments board');
  // Excalidraw draws a link icon on any element with a link: blocks drop theirs once embedded.
  await expect.poll(async () => ofKind(await scene(page), 'file').map((e) => e.link)).toEqual(Array(5).fill(null));
});

test('each frame is one board of four areas: Product, Engineering, Agreed and Milestone', async ({ page }) => {
  await open(page);
  const els = await scene(page);
  const r = (z: string) => areaEl(els, 'checkout', z)!;
  for (const z of ['product', 'engineering', 'agreed', 'milestone']) {
    // Big from the start, room for more than two cards across.
    expect(r(z).width).toBeGreaterThan(1200);
    expect(r(z).height).toBeGreaterThan(900);
    const label = els.find((e) => e.id === `${r(z).frameId}~zonelabel:${z}`);
    expect(label?.text).toBe(z.toUpperCase());
  }
  // Product top left, Engineering top right, Agreed bottom left, Milestone bottom right.
  expect(r('engineering').x).toBeGreaterThan(r('product').x + r('product').width);
  expect(r('engineering').y).toBe(r('product').y);
  expect(r('agreed').x).toBe(r('product').x);
  expect(r('agreed').y).toBeGreaterThan(r('product').y + r('product').height);
  expect(r('milestone').x).toBe(r('engineering').x);
  expect(r('milestone').y).toBe(r('agreed').y);
  expect(els.find((e) => e.id === `${r('milestone').frameId}~zonehint:milestone`)?.text).toBe('Milestone planning comes later');
  // The owner works on the product side: every file without an area is in Product.
  for (const p of ['checkout/flow.md', 'checkout/api.md', 'checkout/later.md']) expect(areaOfPath(els, p)).toBe('product');
  await expect(block(page, 'checkout/api.md')).toHaveAttribute('data-area', 'product');
  // Frames do not overlap, with room between them.
  const frames = els.filter((e) => e.type === 'frame');
  for (const a of frames) {
    for (const b of frames) {
      if (a === b) continue;
      const apart = a.x + a.width + 200 <= b.x || b.x + b.width + 200 <= a.x || a.y + a.height + 200 <= b.y || b.y + b.height + 200 <= a.y;
      expect(apart, `${a.name} and ${b.name} apart`).toBe(true);
    }
  }
});

test('a new file lands in its area once; saving it does not move it; a new area value moves it', async ({ page }) => {
  await open(page);
  cli!.write('checkout/jobs.md', '---\narea: engineering\n---\n# Jobs\n\nretry queue\n');
  await expect.poll(async () => areaOfPath(await scene(page), 'checkout/jobs.md'), { timeout: 3000 }).toBe('engineering');
  const placed = await placeOf(page, 'checkout/jobs.md');
  await fitAll(page);
  await expect(block(page, 'checkout/jobs.md')).toHaveAttribute('data-area-source', 'file');
  // An HTML page says its area with a meta tag.
  cli!.write('ui/eng.html', '<!doctype html><meta name="board:area" content="engineering"><h1>Queue</h1>');
  await expect.poll(async () => areaOfPath(await scene(page), 'ui/eng.html'), { timeout: 3000 }).toBe('engineering');

  // Saves, even ones that change the size of the content, leave it where it is.
  for (let i = 0; i < 3; i++) {
    cli!.write('checkout/jobs.md', `---\narea: engineering\n---\n# Jobs\n\nretry queue ${i}\n${'more\n\n'.repeat(i * 5)}`);
    await expect(block(page, 'checkout/jobs.md')).toContainText(`retry queue ${i}`, { timeout: 3000 });
  }
  await page.waitForTimeout(300);
  expect(await placeOf(page, 'checkout/jobs.md')).toEqual(placed);

  // The last statement wins: the file now says product.
  cli!.write('checkout/jobs.md', '---\narea: product\n---\n# Jobs\n\nretry queue\n');
  await expect.poll(async () => areaOfPath(await scene(page), 'checkout/jobs.md'), { timeout: 3000 }).toBe('product');
  await expect.poll(() => exported(cli!)?.items.find((i) => i.path === 'checkout/jobs.md')?.area, { timeout: 3000 }).toBe('product');
  expect(exported(cli!)!.items.find((i) => i.path === 'checkout/jobs.md')!.area_source).toBe('file');
});

test('the switch on a card moves it to the other area, and says who moved it', async ({ page }) => {
  await open(page);
  const api = block(page, 'checkout/api.md');
  const sw = api.getByTestId('area-switch');
  await expect(sw.getByRole('button', { name: 'Product' })).toHaveAttribute('aria-pressed', 'true');
  await sw.getByRole('button', { name: 'Engineering' }).click();
  await expect(api).toHaveAttribute('data-area', 'engineering');
  await expect(api).toHaveAttribute('data-area-source', 'human');
  await expect.poll(async () => areaOfPath(await scene(page), 'checkout/api.md')).toBe('engineering');
  await expect
    .poll(() => {
      const i = exported(cli!)?.items.find((x) => x.path === 'checkout/api.md');
      return i && [i.area, i.area_source, i.area_set_by];
    }, { timeout: 3000 })
    .toEqual(['engineering', 'human', 'e2e']);
  // A save that does not touch the area keeps the person's switch.
  const placed = await placeOf(page, 'checkout/api.md');
  cli!.write('checkout/api.md', '# Payment API\n\nPOST /pay\nPOST /refund\n');
  await expect(api).toContainText('POST /refund', { timeout: 3000 });
  await page.waitForTimeout(300);
  expect(await placeOf(page, 'checkout/api.md')).toEqual(placed);
  await expect(api).toHaveAttribute('data-area', 'engineering');
});

test('a card grows to its content; past the cap it scrolls inside, with a fade and open', async ({ page }) => {
  await open(page);
  const lines = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag} line ${i + 1}`).join('\n\n');
  cli!.write('checkout/medium.md', `# Medium\n\n${lines(30, 'medium')}\n\nmedium-end\n`);
  cli!.write('checkout/long.md', `# Long\n\n${lines(200, 'long')}\n\nlong-end\n`);
  await expect.poll(() => placeOf(page, 'checkout/long.md'), { timeout: 3000 }).not.toBeNull();
  await fitAll(page);
  const height = async (path: string) => byPath(await scene(page), path)?.height ?? 0;

  // All of a medium file shows: the card is taller than the default and nothing scrolls.
  const medium = block(page, 'checkout/medium.md');
  await expect(medium).toContainText('medium-end');
  await expect.poll(() => height('checkout/medium.md'), { timeout: 5000 }).toBeGreaterThan(600);
  await expect(medium.getByTestId('card-fade')).toHaveCount(0);
  await expect
    .poll(() => medium.locator('.card-body').evaluate((b) => b.scrollHeight - b.clientHeight))
    .toBeLessThanOrEqual(4);

  // A long one stops at the cap and scrolls, with a fade and an open button.
  const long = block(page, 'checkout/long.md');
  await expect.poll(() => height('checkout/long.md'), { timeout: 5000 }).toBe(1400);
  await expect(long.getByTestId('card-fade')).toBeVisible();
  await long.getByRole('button', { name: 'open all of checkout/long.md' }).click();
  await expect(page.getByTestId('fullview')).toContainText('long-end');
});

test('a mermaid fence renders as a diagram, a broken one shows the error', async ({ page }) => {
  await open(page);
  await expect(block(page, 'checkout/flow.md').locator('.mermaid-block svg')).toBeVisible();
  await expect(block(page, 'checkout/flow.md')).toContainText('Payment API');
  await expect(block(page, 'checkout/flow.md')).not.toContainText('links:');

  cli!.write('checkout/broken.md', '```mermaid\nflowchart LR\n  A[Card form --> B\n```\n');
  await expect.poll(() => placeOf(page, 'checkout/broken.md'), { timeout: 3000 }).not.toBeNull();
  await fitAll(page);
  await expect(block(page, 'checkout/broken.md').locator('.mermaid-error')).toContainText('Mermaid error');
});

test('a file saved on disk shows in its block within 1 s, with no reload', async ({ page }) => {
  await open(page);
  for (let i = 0; i < 3; i++) {
    const token = `saved-${Date.now()}-${i}`;
    const start = Date.now();
    cli!.write('checkout/api.md', `# Payment API\n\n${token}\n`);
    await expect(block(page, 'checkout/api.md')).toContainText(token, { timeout: 3000 });
    const ms = Date.now() - start;
    console.log(`save to block: ${ms} ms`);
    expect(ms).toBeLessThan(1000);
  }
});

test('a link in a file draws an arrow; removing it deletes the arrow', async ({ page }) => {
  await open(page);
  await expect.poll(async () => !!fileEdge(await scene(page), 'checkout/flow.md', 'checkout/api.md')).toBe(true);
  await expect.poll(async () => !!fileEdge(await scene(page), 'ui/card-form.html', 'checkout/flow.md')).toBe(true);

  cli!.write('readme.md', '---\nlinks:\n  - to: checkout/next.md\n    label: next\n---\n# Payments board\n');
  await expect(block(page, 'readme.md').getByTestId('missing-links')).toContainText('links to missing file: checkout/next.md');
  cli!.write('checkout/next.md', '# Next\n');
  await expect.poll(async () => !!fileEdge(await scene(page), 'readme.md', 'checkout/next.md'), { timeout: 3000 }).toBe(true);
  await expect(block(page, 'readme.md').getByTestId('missing-links')).toHaveCount(0);

  cli!.write('readme.md', '# Payments board\n');
  await expect.poll(async () => !!fileEdge(await scene(page), 'readme.md', 'checkout/next.md'), { timeout: 3000 }).toBe(false);
});

test('a file link runs border to border above the frames, dotted and locked, its label at its middle', async ({ page }) => {
  await open(page);
  const pairs: [string, string, string][] = [
    ['checkout/flow.md', 'checkout/api.md', 'calls'],
    ['ui/card-form.html', 'checkout/flow.md', 'shows'],
  ];
  await expect.poll(async () => ofKind(await scene(page), 'file-edge').length).toBe(2);
  const els = await scene(page);
  const index = new Map(els.map((e, i) => [e.id, i]));
  for (const [from, to, label] of pairs) {
    const arrow = fileEdge(els, from, to)!;
    expect(arrow, `${from} -> ${to}`).toBeTruthy();
    expect(arrow.strokeStyle).toBe('dotted');
    expect(arrow.locked).toBe(true);
    expect(boundText(els, arrow.id)).toBe(label);

    const pts = arrow.points!.map(([x, y]) => ({ x: arrow.x + x, y: arrow.y + y }));
    const start = pts[0]!;
    const end = pts[pts.length - 1]!;
    const onBorder = (p: { x: number; y: number }, r: SceneEl) => {
      // A bound arrow stops ARROW_GAP (4 px) off its block's border, as Excalidraw draws them.
      const tol = 6;
      const inside = p.x >= r.x - tol && p.x <= r.x + r.width + tol && p.y >= r.y - tol && p.y <= r.y + r.height + tol;
      const deep = p.x > r.x + tol && p.x < r.x + r.width - tol && p.y > r.y + tol && p.y < r.y + r.height - tol;
      return inside && !deep;
    };
    expect(onBorder(start, byPath(els, from)!), `${from} -> ${to} starts on the border of ${from}`).toBe(true);
    expect(onBorder(end, byPath(els, to)!), `${from} -> ${to} ends on the border of ${to}`).toBe(true);

    const text = els.find((e) => e.type === 'text' && e.containerId === arrow.id)!;
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    expect(Math.hypot(text.x + text.width / 2 - mid.x, text.y + text.height / 2 - mid.y), `label "${label}" at its arrow's middle`).toBeLessThan(4);

    // Drawn after (above) every frame.
    for (const f of els.filter((e) => e.type === 'frame')) expect(index.get(arrow.id)!).toBeGreaterThan(index.get(f.id)!);
  }
});

test('an HTML thumbnail zooms to the page content', async ({ page }) => {
  await open(page);
  const thumb = block(page, 'ui/card-form.html').locator('.html-thumb');
  await expect(thumb).toHaveAttribute('data-loaded', 'yes');
  // Never below 0.6 of the page; the fixture's content is narrower than the page, so it zooms past that.
  await expect.poll(async () => Number(await thumb.getAttribute('data-scale')), { timeout: 5000 }).toBeGreaterThan(0.6);
});

test('an HTML thumbnail loads sandboxed, takes no clicks, and opens full size', async ({ page }) => {
  await open(page);
  const thumb = block(page, 'ui/card-form.html').locator('.html-thumb');
  await expect(thumb).toHaveAttribute('data-loaded', 'yes');
  const iframe = thumb.locator('iframe');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(iframe).toHaveCSS('pointer-events', 'none');
  await expect(page.frameLocator('.html-thumb iframe').locator('#title')).toContainText('script ran');

  const openBtn = block(page, 'ui/card-form.html').getByRole('button', { name: 'open ui/card-form.html' });
  const full = page.getByTestId('fullview');

  // The block's own open button, on the canvas.
  await openBtn.click();
  await expect(full).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(full).toHaveCount(0);

  // The page is clickable, and sandboxed: it cannot reach the board.
  await openBtn.click();
  const frame = page.frameLocator('.fullview-frame');
  await frame.locator('#pay').click();
  await expect(frame.locator('#title')).toHaveText('clicked');
  const canReachParent = await frame.locator('body').evaluate(() => {
    try {
      return typeof window.parent.document !== 'undefined';
    } catch {
      return false;
    }
  });
  expect(canReachParent).toBe(false);
  // After a click inside the page, the close button closes it.
  await full.getByRole('button', { name: 'Close' }).click();
  await expect(full).toHaveCount(0);

  // After a click inside the page, Esc works again once the pointer leaves the page.
  await openBtn.click();
  await frame.locator('#pay').click();
  const titleBar = (await full.locator('.fullview-title').boundingBox())!;
  await page.mouse.move(titleBar.x + 20, titleBar.y + titleBar.height / 2, { steps: 5 });
  await page.keyboard.press('Escape');
  await expect(full).toHaveCount(0);

  // Selected on the canvas, the selection bar opens it too.
  await clickEl(page, await idOf(page, 'ui/card-form.html'));
  await page.getByTestId('selection-bar').getByRole('button', { name: 'Open' }).click();
  await expect(full).toBeVisible();
});

test('a file block cannot be deleted; its file link cannot be deleted', async ({ page }) => {
  await open(page);
  const id = await idOf(page, 'checkout/api.md');
  const p = await pressPoint(page, id);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('selection-bar')).toContainText('checkout/api.md');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(500);
  const els = await scene(page);
  expect(byPath(els, 'checkout/api.md')).toBeTruthy();
  await expect(block(page, 'checkout/api.md')).toBeVisible();
  expect(fileEdge(els, 'checkout/flow.md', 'checkout/api.md')).toBeTruthy();
});

test('a dragged block keeps its place after a reload', async ({ page }) => {
  await open(page);
  const id = await idOf(page, 'checkout/api.md');
  const before = await placeOf(page, 'checkout/api.md');
  const p = await pressPoint(page, id);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(p.x + i * 12, p.y + i * 9);
  await page.mouse.up();
  await expect.poll(() => placeOf(page, 'checkout/api.md')).not.toEqual(before);
  const after = await placeOf(page, 'checkout/api.md');
  // The block's own view moved with it.
  const box = (await block(page, 'checkout/api.md').boundingBox())!;
  const el = await screenBox(page, id);
  expect(Math.abs(box.x - el.x)).toBeLessThan(4);

  await page.waitForTimeout(400); // the CLI saves the doc shortly after each change
  await page.reload();
  await expect(block(page, 'checkout/api.md')).toBeVisible();
  expect(await placeOf(page, 'checkout/api.md')).toEqual(after);
});

test('a deleted file hides its block in the hidden list; it comes back in place', async ({ page }) => {
  await open(page);
  const b = block(page, 'checkout/later.md');
  await expect(b).toBeVisible();
  const before = await placeOf(page, 'checkout/later.md');
  cli!.remove('checkout/later.md');
  await expect(b).toHaveCount(0, { timeout: 4000 });
  await expect.poll(() => placeOf(page, 'checkout/later.md')).toBeNull();
  await page.getByRole('button', { name: /Hidden blocks \(1\)/ }).click();
  await expect(page.getByTestId('hidden-list')).toContainText('checkout/later.md');

  cli!.write('checkout/later.md', '# Later, again\n');
  await expect(b).toContainText('Later, again');
  expect(await placeOf(page, 'checkout/later.md')).toEqual(before);
});

test('a renamed file keeps its block and position, with the new name', async ({ page }) => {
  await open(page);
  const id = await idOf(page, 'checkout/later.md');
  const before = await placeOf(page, 'checkout/later.md');
  renameSync(join(cli!.folder, 'checkout', 'later.md'), join(cli!.folder, 'checkout', 'soon.md'));
  const renamed = block(page, 'checkout/soon.md');
  await expect(renamed).toBeVisible();
  expect(await renamed.getAttribute('data-id')).toBe(id);
  expect(await idOf(page, 'checkout/soon.md')).toBe(id);
  expect(await placeOf(page, 'checkout/soon.md')).toEqual(before);
  await page.waitForTimeout(1500); // past the rename window: the block must not go gone
  await expect(renamed).toBeVisible();
  await expect(page.getByTestId('hidden-list')).toHaveCount(0);
});

test('the board survives a CLI restart', async ({ page }) => {
  await open(page);
  const id = await idOf(page, 'checkout/api.md');
  const pos = await placeOf(page, 'checkout/api.md');
  const folder = cli!.folder;
  await cli!.stop();
  await expect(page.getByTestId('status')).not.toHaveAttribute('data-status', 'online');
  cli = await startCli({}, folder);
  await page.goto(cli.url);
  await expect(block(page, 'checkout/api.md')).toBeVisible();
  expect(await idOf(page, 'checkout/api.md')).toBe(id);
  expect(await placeOf(page, 'checkout/api.md')).toEqual(pos);
});
