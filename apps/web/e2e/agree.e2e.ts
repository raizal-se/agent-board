import { expect, test, type Page } from '@playwright/test';
import { block, boundText, clickEl, exported, fitAll, guardPage, idOf, ofKind, openBoard, scene, screenBox, selectPaths, type SceneEl } from './canvas';
import { startCli, type RunningCli } from './cli';

/** Slice 2 on the canvas: think on the board (notes, comments, links), agree on what is done. */

const API_V1 = '# Payment API\n\nPOST /intents\nreturns 201\n';
const FILES = {
  'checkout/api.md': API_V1,
  'checkout/flow.md': '# Checkout flow\n\nCard form, then pay.\n',
};

let cli: RunningCli | undefined;
guardPage(() => cli);
test.beforeEach(async () => {
  cli = await startCli(FILES);
});

const exp = () => exported(cli!);

async function open(page: Page) {
  await openBoard(page, cli!, 'checkout/api.md');
  await expect(block(page, 'checkout/flow.md')).toBeVisible();
}

const notes = async (page: Page) => ofKind(await scene(page), 'sticky');

/** Type into a note on the canvas: double-click opens Excalidraw's text editor, Escape ends it. */
async function typeInNote(page: Page, id: string, text: string) {
  const b = await screenBox(page, id);
  await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2);
  const editor = page.locator('textarea.excalidraw-wysiwyg');
  await expect(editor).toBeVisible();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
}

async function agreeOn(page: Page, text: string, ...paths: string[]) {
  await selectPaths(page, ...paths);
  await page.getByTestId('selection-bar').getByRole('button', { name: 'Agree' }).click();
  const dialog = page.getByTestId('text-dialog');
  await dialog.locator('textarea').fill(text);
  await dialog.getByRole('button', { name: 'Agree' }).click();
  await expect(dialog).toHaveCount(0);
}

async function linkPaths(page: Page, label: string, from: string, to: string) {
  await selectPaths(page, from, to);
  await page.getByTestId('selection-bar').getByRole('button', { name: 'Link' }).click();
  const dialog = page.getByTestId('text-dialog');
  await dialog.locator('input').fill(label);
  await dialog.getByRole('button', { name: 'Link' }).click();
  await expect(dialog).toHaveCount(0);
}

/** The drawn link (not from a file) on the canvas. */
const drawnLink = (els: SceneEl[]) => ofKind(els, 'link')[0];

/** Click a drawn link where its label sits. */
async function clickLink(page: Page, id: string) {
  const els = await scene(page);
  const label = els.find((e) => e.type === 'text' && e.containerId === id);
  const b = await screenBox(page, label?.id ?? id);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

test('+ note adds a note in view with its author; type in it, edit it, delete it', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '+ note' }).click();
  await expect.poll(async () => (await notes(page)).length).toBe(1);
  const note = (await notes(page))[0]!;
  expect(note.ab?.author).toBe('e2e');
  // Selected, so the selection bar names it with its author.
  await expect(page.getByTestId('selection-bar')).toContainText('note by e2e');

  await typeInNote(page, note.id, 'idempotency key?');
  await expect.poll(() => exp()?.items.find((i) => i.kind === 'sticky')?.content, { timeout: 3000 }).toBe('idempotency key?');
  expect(exp()!.items.find((i) => i.kind === 'sticky')!.author).toBe('e2e');

  // Edit in place: the text changes, the note stays one note.
  await typeInNote(page, note.id, 'idempotency key: per intent');
  await expect.poll(() => exp()?.items.find((i) => i.kind === 'sticky')?.content, { timeout: 3000 }).toBe('idempotency key: per intent');
  expect(boundText(await scene(page), note.id)).toBe('idempotency key: per intent');
  expect(exp()!.items.filter((i) => i.kind === 'sticky')).toHaveLength(1);

  // Another note, then delete the first with the Delete key.
  await page.getByRole('button', { name: '+ note' }).click();
  await expect.poll(async () => (await notes(page)).length).toBe(2);
  await clickEl(page, note.id);
  await expect(page.getByTestId('selection-bar')).toContainText('note by e2e');
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await notes(page)).map((n) => n.id)).not.toContain(note.id);
  await expect.poll(() => exp()?.items.filter((i) => i.kind === 'sticky').length, { timeout: 3000 }).toBe(1);
});

test('a comment on a block shows its count on the pin; the thread resolves', async ({ page }) => {
  await open(page);
  const pin = block(page, 'checkout/api.md').getByTestId('comment-pin');
  await expect(pin).toHaveAttribute('data-count', '0');
  // The pin sits on the block, on the canvas, and takes the click.
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
  await expect.poll(() => exp()?.comments[0]?.resolved, { timeout: 3000 }).toBe(true);
  await thread.getByRole('button', { name: 'Close comments' }).click();
  await expect(thread).toHaveCount(0);

  // The selection bar opens the same thread, with the count.
  await selectPaths(page, 'checkout/api.md');
  await page.getByTestId('selection-bar').getByRole('button', { name: 'Comments (1)' }).click();
  await expect(thread).toContainText('What about timeouts?');
});

test('draw a link with a label between two blocks, edit the label, delete it', async ({ page }) => {
  await open(page);
  const api = await idOf(page, 'checkout/api.md');
  const flow = await idOf(page, 'checkout/flow.md');
  await linkPaths(page, 'needed by', 'checkout/api.md', 'checkout/flow.md');

  await expect.poll(async () => !!drawnLink(await scene(page))).toBe(true);
  const els = await scene(page);
  const link = drawnLink(els)!;
  expect([link.start, link.end]).toEqual([api, flow]);
  // Solid, not dotted like a link from a file.
  expect(link.strokeStyle).toBe('solid');
  expect(boundText(els, link.id)).toBe('needed by');
  await expect.poll(() => exp()?.edges.find((e) => e.source === 'human')?.label, { timeout: 3000 }).toBe('needed by');

  await clickLink(page, link.id);
  const bar = page.getByTestId('selection-bar');
  await expect(bar).toContainText('Link by e2e');
  await bar.getByRole('button', { name: 'Edit label' }).click();
  const dialog = page.getByTestId('text-dialog');
  await dialog.locator('input').fill('blocks');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => boundText(await scene(page), link.id)).toBe('blocks');
  await expect.poll(() => exp()?.edges.find((e) => e.source === 'human')?.label, { timeout: 3000 }).toBe('blocks');

  await clickLink(page, link.id);
  await bar.getByRole('button', { name: 'Delete link' }).click();
  await expect.poll(async () => !!drawnLink(await scene(page))).toBe(false);
  await expect.poll(() => exp()?.edges.some((e) => e.source === 'human'), { timeout: 3000 }).toBe(false);
});

test('agree on two blocks: a decision, agreed badges, the agreed zone', async ({ page }) => {
  await open(page);
  for (const p of ['checkout/api.md', 'checkout/flow.md']) {
    await expect(block(page, p)).toHaveAttribute('data-zone', 'product');
    await expect(block(page, p).getByTestId('agent-mark')).toContainText("e2e's agent");
  }
  await agreeOn(page, 'Intent first, then capture', 'checkout/api.md', 'checkout/flow.md');
  await fitAll(page);

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
  await expect.poll(() => exp()?.decisions[0]?.covers.length, { timeout: 3000 }).toBe(2);
  // The agreed zone is a full column now that it holds blocks.
  const zone = (await scene(page)).find((e) => e.ab?.ab === 'zone' && e.ab.zone === 'agreed')!;
  expect(zone.width).toBeGreaterThan(300);
});

test('a save after agreement: the mark within 1 s, compare shows the changed line, keep snapshot and agree again', async ({ page }) => {
  await open(page);
  await agreeOn(page, 'Intent first', 'checkout/api.md');
  await fitAll(page);
  const api = block(page, 'checkout/api.md');
  await expect(api.getByTestId('agreed-badge')).toBeVisible();

  const start = Date.now();
  cli!.write('checkout/api.md', API_V1.replace('returns 201', 'returns 202'));
  await expect(api.getByTestId('changed-mark')).toBeVisible({ timeout: 3000 });
  const ms = Date.now() - start;
  console.log(`save to "changed after agreement": ${ms} ms`);
  expect(ms).toBeLessThan(1000);
  // The block shows the new content; the snapshot does not change.
  await expect(api).toContainText('returns 202');
  await expect.poll(() => exp()?.items.find((i) => i.path === 'checkout/api.md')?.changed_after_agreement, { timeout: 3000 }).toBe(true);
  expect(exp()!.items.find((i) => i.path === 'checkout/api.md')!.snapshot!.content).toBe(API_V1);

  // Compare (the block's own button): one changed line, old on the left, new on the right.
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
  await expect.poll(() => exp()?.items.find((i) => i.path === 'checkout/api.md')?.changed_after_agreement, { timeout: 3000 }).toBe(false);
  expect(exp()!.items.find((i) => i.path === 'checkout/api.md')!.snapshot!.content).toBe(API_V1);

  // The next change marks it again; agree again (from the selection bar's Compare) takes a new snapshot.
  const v3 = API_V1.replace('returns 201', 'returns 200');
  cli!.write('checkout/api.md', v3);
  await expect(api.getByTestId('changed-mark')).toBeVisible({ timeout: 3000 });
  await selectPaths(page, 'checkout/api.md');
  await page.getByTestId('selection-bar').getByRole('button', { name: 'Compare' }).click();
  await compare.getByRole('button', { name: 'Agree again' }).click();
  await expect(api.getByTestId('changed-mark')).toHaveCount(0);
  await expect(api.getByTestId('agreed-badge')).toBeVisible();
  await expect.poll(() => exp()?.items.find((i) => i.path === 'checkout/api.md')?.snapshot?.content, { timeout: 3000 }).toBe(v3);
});

test('notes, comments, links, decisions and the changed mark survive a reload and a CLI restart', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '+ note' }).click();
  await expect.poll(async () => (await notes(page)).length).toBe(1);
  const note = (await notes(page))[0]!.id;
  await typeInNote(page, note, 'keep me');
  await block(page, 'checkout/flow.md').getByTestId('comment-pin').click();
  await page.getByTestId('thread').getByRole('textbox', { name: 'New comment' }).fill('still here?');
  await page.getByTestId('thread').getByRole('button', { name: 'Comment', exact: true }).click();
  await page.getByTestId('thread').getByRole('button', { name: 'Close comments' }).click();
  await linkPaths(page, 'calls', 'checkout/flow.md', 'checkout/api.md');
  await agreeOn(page, 'Ship it', 'checkout/api.md');
  await fitAll(page);
  cli!.write('checkout/api.md', API_V1 + '\nGET /intents/:id\n');
  await expect(block(page, 'checkout/api.md').getByTestId('changed-mark')).toBeVisible({ timeout: 3000 });

  const check = async () => {
    await fitAll(page);
    await expect.poll(async () => boundText(await scene(page), note)).toBe('keep me');
    await expect(block(page, 'checkout/flow.md').getByTestId('comment-pin')).toHaveAttribute('data-count', '1');
    await expect.poll(async () => {
      const els = await scene(page);
      const link = drawnLink(els);
      return link ? boundText(els, link.id) : null;
    }).toBe('calls');
    await expect(page.getByTestId('decision')).toContainText('Ship it');
    await expect(block(page, 'checkout/api.md').getByTestId('agreed-badge')).toBeVisible();
    await expect(block(page, 'checkout/api.md').getByTestId('changed-mark')).toBeVisible();
  };

  await expect.poll(() => exp()?.items.find((i) => i.path === 'checkout/api.md')?.changed_after_agreement, { timeout: 3000 }).toBe(true);
  await expect.poll(() => exp()?.items.find((i) => i.kind === 'sticky')?.content, { timeout: 3000 }).toBe('keep me');
  await page.reload();
  await open(page);
  await check();

  const folder = cli!.folder;
  await cli!.stop();
  cli = await startCli({}, folder);
  await page.goto(cli.url);
  await open(page);
  await check();
});
