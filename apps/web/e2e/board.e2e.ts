import { expect, test, type Page } from '@playwright/test';
import { renameSync } from 'node:fs';
import { join } from 'node:path';
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
<body style="font: 48px sans-serif">
  <h1 id="title">Card form</h1>
  <button id="pay" onclick="document.getElementById('title').textContent = 'clicked'">Pay</button>
  <script>document.body.dataset.ran = 'yes'; document.getElementById('title').textContent += ' (script ran)';</script>
</body>`;

let cli: RunningCli;
const errors: string[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  cli = await startCli({
    'checkout/flow.md': FLOW,
    'checkout/api.md': '# Payment API\n\nPOST /pay\n',
    'ui/card-form.html': PAGE,
    'readme.md': '# Payments board\n',
  });
});

test.afterAll(async () => {
  await cli?.stop();
});

test.beforeEach(({ page }) => {
  page.on('pageerror', (e) => errors.push(e.message));
});

test.afterEach(() => {
  expect(errors, 'no errors in the page').toEqual([]);
});

const block = (page: Page, path: string) => page.locator(`[data-testid="block"][data-path="${path}"]`);

async function open(page: Page) {
  await page.goto(cli.url);
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'online');
  await expect(block(page, 'checkout/flow.md')).toBeVisible();
}

test('each subfolder is a frame, root files go to the folder frame', async ({ page }) => {
  await open(page);
  for (const name of ['checkout', 'ui', 'payments']) await expect(page.locator(`[data-frame="${name}"]`)).toBeVisible();
  await expect(block(page, 'readme.md')).toContainText('Payments board');
});

test('a mermaid fence renders as a diagram, a broken one shows the error', async ({ page }) => {
  await open(page);
  await expect(block(page, 'checkout/flow.md').locator('.mermaid-block svg')).toBeVisible();
  await expect(block(page, 'checkout/flow.md')).toContainText('Payment API');
  await expect(block(page, 'checkout/flow.md')).not.toContainText('links:');

  cli.write('checkout/broken.md', '```mermaid\nflowchart LR\n  A[Card form --> B\n```\n');
  await expect(block(page, 'checkout/broken.md').locator('.mermaid-error')).toContainText('Mermaid error');
});

test('a file saved on disk shows in its block within 1 s, with no reload', async ({ page }) => {
  await open(page);
  for (let i = 0; i < 3; i++) {
    const token = `saved-${Date.now()}-${i}`;
    const start = Date.now();
    cli.write('checkout/api.md', `# Payment API\n\n${token}\n`);
    await expect(block(page, 'checkout/api.md')).toContainText(token, { timeout: 3000 });
    const ms = Date.now() - start;
    console.log(`save to block: ${ms} ms`);
    expect(ms).toBeLessThan(1000);
  }
});

test('a link in a file draws an edge; removing it deletes the edge', async ({ page }) => {
  await open(page);
  await expect(page.locator('[aria-label="link from checkout/flow.md to checkout/api.md"]')).toBeAttached();
  await expect(page.locator('[aria-label="link from ui/card-form.html to checkout/flow.md"]')).toBeAttached();

  cli.write('readme.md', '---\nlinks:\n  - to: checkout/later.md\n    label: next\n---\n# Payments board\n');
  await expect(block(page, 'readme.md').getByTestId('missing-links')).toContainText('links to missing file: checkout/later.md');
  cli.write('checkout/later.md', '# Later\n');
  await expect(page.locator('[aria-label="link from readme.md to checkout/later.md"]')).toBeAttached();
  await expect(block(page, 'readme.md').getByTestId('missing-links')).toHaveCount(0);

  cli.write('readme.md', '# Payments board\n');
  await expect(page.locator('[aria-label="link from readme.md to checkout/later.md"]')).toHaveCount(0);
});

test('an HTML thumbnail loads sandboxed, takes no clicks, and opens full size', async ({ page }) => {
  await open(page);
  const thumb = block(page, 'ui/card-form.html').locator('.html-thumb');
  await expect(thumb).toHaveAttribute('data-loaded', 'yes');
  const iframe = thumb.locator('iframe');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(iframe).toHaveCSS('pointer-events', 'none');
  await expect(page.frameLocator('.html-thumb iframe').locator('#title')).toContainText('script ran');

  await block(page, 'ui/card-form.html').getByRole('button', { name: 'open ui/card-form.html' }).click();
  const full = page.getByTestId('fullview');
  await expect(full).toBeVisible();
  const frame = page.frameLocator('.fullview-frame');
  await frame.locator('#pay').click();
  await expect(frame.locator('#title')).toHaveText('clicked');
  // The page has an opaque origin: it cannot read the board.
  const canReachParent = await frame.locator('body').evaluate(() => {
    try {
      return typeof window.parent.document !== 'undefined';
    } catch {
      return false;
    }
  });
  expect(canReachParent).toBe(false);
  await page.keyboard.press('Escape');
  await expect(full).toHaveCount(0);
});

async function nodeOffset(page: Page, id: string) {
  return page.locator(`.react-flow__node[data-id="${id}"]`).evaluate((el) => {
    const m = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec((el as HTMLElement).style.transform);
    return m ? { x: Math.round(Number(m[1])), y: Math.round(Number(m[2])) } : null;
  });
}

test('a dragged block keeps its place after a reload', async ({ page }) => {
  await open(page);
  const b = block(page, 'checkout/api.md');
  const id = (await b.getAttribute('data-id'))!;
  const before = await nodeOffset(page, id);
  const title = b.locator('.block-name');
  const box = (await title.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width / 2 + i * 12, box.y + box.height / 2 + i * 9);
  await page.mouse.up();
  const after = await nodeOffset(page, id);
  expect(after).not.toEqual(before);

  await page.waitForTimeout(400); // the CLI saves the doc shortly after each change
  await page.reload();
  await expect(block(page, 'checkout/api.md')).toBeVisible();
  expect(await nodeOffset(page, id)).toEqual(after);
});

test('a deleted file hides its block in the hidden list; it comes back in place', async ({ page }) => {
  await open(page);
  const b = block(page, 'checkout/later.md');
  await expect(b).toBeVisible();
  const id = (await b.getAttribute('data-id'))!;
  const before = await nodeOffset(page, id);
  cli.remove('checkout/later.md');
  await expect(b).toHaveCount(0, { timeout: 4000 });
  await page.getByRole('button', { name: /Hidden blocks \(1\)/ }).click();
  await expect(page.getByTestId('hidden-list')).toContainText('checkout/later.md');

  cli.write('checkout/later.md', '# Later, again\n');
  await expect(b).toContainText('Later, again');
  expect(await nodeOffset(page, id)).toEqual(before);
});

test('a renamed file keeps its block and position, with the new name', async ({ page }) => {
  await open(page);
  const b = block(page, 'checkout/later.md');
  const id = (await b.getAttribute('data-id'))!;
  const before = await nodeOffset(page, id);
  renameSync(join(cli.folder, 'checkout', 'later.md'), join(cli.folder, 'checkout', 'soon.md'));
  const renamed = block(page, 'checkout/soon.md');
  await expect(renamed).toBeVisible();
  expect(await renamed.getAttribute('data-id')).toBe(id);
  expect(await nodeOffset(page, id)).toEqual(before);
  await page.waitForTimeout(1500); // past the rename window: the block must not go gone
  await expect(renamed).toBeVisible();
  await expect(page.getByTestId('hidden-list')).toHaveCount(0);
});

test('the board survives a CLI restart', async ({ page }) => {
  await open(page);
  const id = (await block(page, 'checkout/api.md').getAttribute('data-id'))!;
  const pos = await nodeOffset(page, id);
  const folder = cli.folder;
  await cli.stop();
  await expect(page.getByTestId('status')).not.toHaveAttribute('data-status', 'online');
  cli = await startCli({}, folder);
  await page.goto(cli.url);
  await expect(block(page, 'checkout/api.md')).toBeVisible();
  expect(await block(page, 'checkout/api.md').getAttribute('data-id')).toBe(id);
  expect(await nodeOffset(page, id)).toEqual(pos);
});
