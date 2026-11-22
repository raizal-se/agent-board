import { expect, test, type Page } from '@playwright/test';
import { renameSync } from 'node:fs';
import { join } from 'node:path';
import { block, boundText, byPath, clickEl, fitAll, guardPage, idOf, ofKind, openBoard, placeOf, pressPoint, scene, screenBox, type SceneEl } from './canvas';
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

test('empty zones are thin strips; the zones in use are full columns', async ({ page }) => {
  await open(page);
  const els = await scene(page);
  const zone = (frame: string, z: string) => els.find((e) => e.ab?.ab === 'zone' && e.ab.zone === z && els.find((f) => f.id === e.frameId)?.name === frame)!;
  // Every block starts in the product zone.
  expect(zone('checkout', 'product').width).toBeGreaterThan(300);
  for (const z of ['engineering', 'agreed', 'milestone']) expect(zone('checkout', z).width).toBeLessThan(40);
  const label = els.find((e) => e.ab?.ab === 'zone-label' && e.ab.zone === 'milestone' && e.frameId === zone('checkout', 'milestone').frameId)!;
  expect(label.angle).toBeCloseTo((3 * Math.PI) / 2);
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
      const tol = 3;
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
  // The fixture's content is about half the 1280 px page wide, so it zooms well past 338/1280.
  await expect.poll(async () => Number(await thumb.getAttribute('data-scale')), { timeout: 5000 }).toBeGreaterThan(0.4);
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
