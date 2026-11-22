import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startCli, type RunningCli } from './cli';

/** Slice 2: think on the board (notes, comments, links), agree on what is done. */

const API_V1 = '# Payment API\n\nPOST /intents\nreturns 201\n';
const FILES = {
  'checkout/api.md': API_V1,
  'checkout/flow.md': '# Checkout flow\n\nCard form, then pay.\n',
};

let cli: RunningCli;
let errors: string[];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  cli = await startCli(FILES);
});

test.afterEach(async () => {
  await cli?.stop();
  expect(errors, 'no errors in the page').toEqual([]);
});

const block = (page: Page, path: string) => page.locator(`[data-testid="block"][data-path="${path}"]`);

interface Exported {
  items: { id: string; kind: string; path: string | null; frame: string | null; content: string; state: string; zone: string; snapshot: { content: string } | null; changed_after_agreement?: boolean }[];
  comments: { target: string; resolved: boolean; comments: { author: string; text: string }[] }[];
  edges: { source: string; label: string }[];
  decisions: { text: string; covers: string[] }[];
}

/** The JSON export the CLI writes for agents. */
function exported(): Exported | undefined {
  try {
    return JSON.parse(readFileSync(join(cli.folder, '.agent-board', 'board.json'), 'utf8')) as Exported;
  } catch {
    return undefined;
  }
}

async function open(page: Page) {
  await page.goto(cli.url);
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'online');
  await expect(block(page, 'checkout/api.md')).toBeVisible();
  await expect(block(page, 'checkout/flow.md')).toBeVisible();
}

/** Select blocks the desktop way: click, then Ctrl/Cmd+click. */
async function select(page: Page, ...paths: string[]) {
  for (const [i, p] of paths.entries()) {
    await block(page, p).locator('.block-name').click(i === 0 ? {} : { modifiers: ['ControlOrMeta'] });
  }
  await expect(page.getByTestId('selection-bar')).toContainText(`${paths.length} selected`);
}

async function agreeOn(page: Page, text: string, ...paths: string[]) {
  await select(page, ...paths);
  await page.getByTestId('selection-bar').getByRole('button', { name: 'Agree' }).click();
  const dialog = page.getByTestId('text-dialog');
  await dialog.locator('textarea').fill(text);
  await dialog.getByRole('button', { name: 'Agree' }).click();
  await expect(dialog).toHaveCount(0);
}

async function center(l: Locator) {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test('add a note with a double-click and with + note, edit it in place, delete it', async ({ page }) => {
  await open(page);
  // A double-click on the empty milestone zone of the checkout frame puts a note in that frame.
  const p = await center(page.locator('[data-frame="checkout"] [data-zone="milestone"]'));
  await page.mouse.dblclick(p.x, p.y);
  const note = page.getByTestId('sticky');
  await expect(note).toHaveCount(1);
  await expect(note).toHaveAttribute('data-author', 'e2e');
  await note.locator('textarea').fill('idempotency key?');
  await expect.poll(() => exported()?.items.find((i) => i.kind === 'sticky')?.content, { timeout: 3000 }).toBe('idempotency key?');
  expect(exported()!.items.find((i) => i.kind === 'sticky')!.frame).toBe('frame:checkout');

  // Edit in place: the text changes, the note stays one note.
  await note.locator('textarea').fill('idempotency key: per intent');
  await expect.poll(() => exported()?.items.find((i) => i.kind === 'sticky')?.content, { timeout: 3000 }).toBe('idempotency key: per intent');

  // + note adds one in view.
  await page.getByRole('button', { name: '+ note' }).click();
  await expect(note).toHaveCount(2);

  await note.first().getByRole('button', { name: 'delete note' }).click();
  await expect(note).toHaveCount(1);
});

test('a comment on a block shows its count on the pin; the thread resolves', async ({ page }) => {
  await open(page);
  const pin = block(page, 'checkout/api.md').getByTestId('comment-pin');
  await expect(pin).toHaveAttribute('data-count', '0');
  await pin.click();
  const thread = page.getByTestId('thread');
  await expect(thread).toContainText('on checkout/api.md');
  await thread.getByRole('textbox', { name: 'New comment' }).fill('What about timeouts?');
  await thread.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(thread.getByTestId('comment')).toHaveCount(1);
  await expect(thread.getByTestId('comment')).toContainText('e2e');
  await expect(thread.getByTestId('comment')).toContainText('What about timeouts?');
  await expect(pin).toHaveAttribute('data-count', '1');
  await expect(pin).toHaveText('1');

  await thread.getByRole('button', { name: 'Resolve' }).click();
  await expect(thread).toHaveAttribute('data-resolved', 'yes');
  await expect(thread).toContainText('Resolved by e2e');
  await expect.poll(() => exported()?.comments[0]?.resolved, { timeout: 3000 }).toBe(true);
  await thread.getByRole('button', { name: 'Close comments' }).click();
  await expect(thread).toHaveCount(0);
});

test('draw a link with a label between two blocks, edit the label, delete it', async ({ page }) => {
  await open(page);
  await select(page, 'checkout/api.md', 'checkout/flow.md');
  await page.getByTestId('selection-bar').getByRole('button', { name: 'Link' }).click();
  const dialog = page.getByTestId('text-dialog');
  await dialog.locator('input').fill('needed by');
  await dialog.getByRole('button', { name: 'Link' }).click();

  const edge = page.locator('[aria-label="drawn link from checkout/api.md to checkout/flow.md"]');
  await expect(edge).toBeAttached();
  const label = page.locator('[data-testid="edge-label"][data-kind="human"]');
  await expect(label).toHaveText('needed by');
  // Solid, not dotted like a link from a file.
  expect(await edge.locator('.react-flow__edge-path').evaluate((p) => getComputedStyle(p).strokeDasharray)).toBe('none');

  await label.click();
  const bar = page.getByTestId('selection-bar');
  await bar.getByRole('button', { name: 'Edit label' }).click();
  await dialog.locator('input').fill('blocks');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(label).toHaveText('blocks');
  await expect.poll(() => exported()?.edges.find((e) => e.source === 'human')?.label, { timeout: 3000 }).toBe('blocks');

  await label.click();
  await bar.getByRole('button', { name: 'Delete link' }).click();
  await expect(edge).toHaveCount(0);
});

test('agree on two blocks: a decision, agreed badges, the agreed zone', async ({ page }) => {
  await open(page);
  for (const p of ['checkout/api.md', 'checkout/flow.md']) {
    await expect(block(page, p)).toHaveAttribute('data-zone', 'product');
    await expect(block(page, p).getByTestId('agent-mark')).toContainText("e2e's agent");
  }
  // The touch-screen way to select several: the toggle, then taps.
  await page.getByRole('button', { name: 'Select several' }).click();
  await block(page, 'checkout/api.md').locator('.block-name').click();
  await block(page, 'checkout/flow.md').locator('.block-name').click();
  await expect(page.getByTestId('selection-bar')).toContainText('2 selected');
  await page.getByRole('button', { name: 'Select several' }).click();
  await page.getByTestId('selection-bar').getByRole('button', { name: 'Agree' }).click();
  await page.getByTestId('text-dialog').locator('textarea').fill('Intent first, then capture');
  await page.getByTestId('text-dialog').getByRole('button', { name: 'Agree' }).click();

  for (const p of ['checkout/api.md', 'checkout/flow.md']) {
    await expect(block(page, p).getByTestId('agreed-badge')).toBeVisible();
    await expect(block(page, p)).toHaveAttribute('data-zone', 'agreed');
  }
  const decision = page.getByTestId('decision');
  await expect(decision).toContainText('Intent first, then capture');
  await expect(decision).toContainText('checkout/api.md');
  await expect(decision).toContainText('e2e');
  // A decision is made by a person: no agent mark.
  await expect(decision.getByTestId('agent-mark')).toHaveCount(0);
  await expect.poll(() => exported()?.decisions[0]?.covers.length, { timeout: 3000 }).toBe(2);
});

test('a save after agreement: the mark within 1 s, compare shows the changed line, keep snapshot and agree again', async ({ page }) => {
  await open(page);
  await agreeOn(page, 'Intent first', 'checkout/api.md');
  const api = block(page, 'checkout/api.md');
  await expect(api.getByTestId('agreed-badge')).toBeVisible();

  const start = Date.now();
  cli.write('checkout/api.md', API_V1.replace('returns 201', 'returns 202'));
  await expect(api.getByTestId('changed-mark')).toBeVisible({ timeout: 3000 });
  const ms = Date.now() - start;
  console.log(`save to "changed after agreement": ${ms} ms`);
  expect(ms).toBeLessThan(1000);
  // The block shows the new content; the snapshot does not change.
  await expect(api).toContainText('returns 202');
  await expect.poll(() => exported()?.items.find((i) => i.path === 'checkout/api.md')?.changed_after_agreement, { timeout: 3000 }).toBe(true);
  expect(exported()!.items.find((i) => i.path === 'checkout/api.md')!.snapshot!.content).toBe(API_V1);

  // Compare: one changed line, old on the left, new on the right.
  await api.getByRole('button', { name: /compare/i }).click();
  const compare = page.getByTestId('compare');
  const changed = compare.locator('[data-testid="diff-row"][data-kind="changed"]');
  await expect(changed).toHaveCount(1);
  await expect(changed.locator('.diff-left')).toContainText('returns 201');
  await expect(changed.locator('.diff-right')).toContainText('returns 202');
  await expect(compare.locator('[data-testid="diff-row"][data-kind="removed"], [data-testid="diff-row"][data-kind="added"]')).toHaveCount(0);

  // Keep snapshot: the mark goes, the snapshot stays.
  await compare.getByRole('button', { name: 'Keep snapshot' }).click();
  await expect(api.getByTestId('changed-mark')).toHaveCount(0);
  await expect.poll(() => exported()?.items.find((i) => i.path === 'checkout/api.md')?.changed_after_agreement, { timeout: 3000 }).toBe(false);
  expect(exported()!.items.find((i) => i.path === 'checkout/api.md')!.snapshot!.content).toBe(API_V1);

  // The next change marks it again; agree again takes a new snapshot and clears the mark.
  const v3 = API_V1.replace('returns 201', 'returns 200');
  cli.write('checkout/api.md', v3);
  await expect(api.getByTestId('changed-mark')).toBeVisible({ timeout: 3000 });
  await api.getByRole('button', { name: /compare/i }).click();
  await compare.getByRole('button', { name: 'Agree again' }).click();
  await expect(api.getByTestId('changed-mark')).toHaveCount(0);
  await expect(api.getByTestId('agreed-badge')).toBeVisible();
  await expect.poll(() => exported()?.items.find((i) => i.path === 'checkout/api.md')?.snapshot?.content, { timeout: 3000 }).toBe(v3);
});

test('notes, comments, links, decisions and the changed mark survive a reload and a CLI restart', async ({ page }) => {
  await open(page);
  const p = await center(page.locator('[data-frame="checkout"] [data-zone="milestone"]'));
  await page.mouse.dblclick(p.x, p.y);
  await page.getByTestId('sticky').locator('textarea').fill('keep me');
  await block(page, 'checkout/flow.md').getByTestId('comment-pin').click();
  await page.getByTestId('thread').getByRole('textbox', { name: 'New comment' }).fill('still here?');
  await page.getByTestId('thread').getByRole('button', { name: 'Comment', exact: true }).click();
  await page.getByTestId('thread').getByRole('button', { name: 'Close comments' }).click();
  await select(page, 'checkout/flow.md', 'checkout/api.md');
  await page.getByTestId('selection-bar').getByRole('button', { name: 'Link' }).click();
  await page.getByTestId('text-dialog').locator('input').fill('calls');
  await page.getByTestId('text-dialog').getByRole('button', { name: 'Link' }).click();
  await agreeOn(page, 'Ship it', 'checkout/api.md');
  cli.write('checkout/api.md', API_V1 + '\nGET /intents/:id\n');
  await expect(block(page, 'checkout/api.md').getByTestId('changed-mark')).toBeVisible({ timeout: 3000 });

  const check = async () => {
    await expect(page.getByTestId('sticky').locator('textarea')).toHaveValue('keep me');
    await expect(block(page, 'checkout/flow.md').getByTestId('comment-pin')).toHaveAttribute('data-count', '1');
    await expect(page.locator('[data-testid="edge-label"][data-kind="human"]')).toHaveText('calls');
    await expect(page.getByTestId('decision')).toContainText('Ship it');
    await expect(block(page, 'checkout/api.md').getByTestId('agreed-badge')).toBeVisible();
    await expect(block(page, 'checkout/api.md').getByTestId('changed-mark')).toBeVisible();
  };

  await expect.poll(() => exported()?.items.find((i) => i.path === 'checkout/api.md')?.changed_after_agreement, { timeout: 3000 }).toBe(true);
  await page.reload();
  await open(page);
  await check();

  const folder = cli.folder;
  await cli.stop();
  cli = await startCli({}, folder);
  await page.goto(cli.url);
  await open(page);
  await check();
});
