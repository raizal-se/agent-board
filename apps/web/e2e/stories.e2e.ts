import { devices, expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { block, boundText, fitAll, guardPage, ofKind, openBoard, scene, selectPaths } from './canvas';
import { startCli, type RunningCli } from './cli';

/** Milestones and stories in the Milestone area: import, make by hand, cover, block, approve, reset, persist, phone. */

const API = '---\narea: engineering\n---\n# Payment API\n\nPOST /intents\nreturns 201\n';
const FLOW = '# Checkout flow\n\nCard form, then pay.\n';
const FORM = '<!doctype html><html><body><h1>Card form</h1><form><input placeholder="Card number"></form></body></html>';

const ENTRY_1 = `## Card form ready
- story: As a shopper, I want the card form to open fast, so that I can pay quickly.
- size: S
- owner: e2e
- covers: card-form.html, api.md
- blocked-by:
- check: the card form opens with an intent ID set.
`;
const ENTRY_2 = `## Pay
- story: As a shopper, I want to pay by card, so that I get my order.
- size: M
- owner:
- covers: flow.md
- blocked-by: Card form ready
- check: a test card pays.
`;
const ENTRY_3 = `## Refund
- story: As a shopper, I want a refund, so that I get my money back.
- size: S
- owner:
- covers:
- blocked-by:
- check: a refund shows in the list.
`;
const MILESTONE = `# Milestone 1: Pay by card\nGoal: a shopper can pay by card.\n\n${ENTRY_1}\n${ENTRY_2}`;

const BASE = { 'checkout/api.md': API, 'checkout/flow.md': FLOW, 'ui/card-form.html': FORM };

interface StoryExport {
  id: string;
  number: number;
  title: string;
  covers: { path: string | null; area: string | null }[];
  blocked_by: string[];
  can_start: boolean;
  approved: boolean;
  accepts: { name: string }[];
  owner: string | null;
}
interface MilestoneExport {
  id: string;
  number: number;
  name: string;
  summary: string;
  stories: string[];
}

let cli: RunningCli | undefined;
guardPage(() => cli);

function exp(): { stories: StoryExport[]; milestones: MilestoneExport[] } | undefined {
  try {
    return JSON.parse(readFileSync(join(cli!.folder, '.agent-board', 'board.json'), 'utf8'));
  } catch {
    return undefined;
  }
}

const storyCard = (page: Page, id: string) => page.locator(`[data-testid="story"][data-id="${id}"]`);

/** The story elements on the canvas, by number. */
async function storyIds(page: Page): Promise<string[]> {
  return ofKind(await scene(page), 'story')
    .sort((a, b) => Number(a.ab!.number) - Number(b.ab!.number))
    .map((e) => e.id);
}

/** Wait for `n` stories on the canvas, and return their ids by number. */
async function stories(page: Page, n: number): Promise<string[]> {
  await expect.poll(async () => (await storyIds(page)).length, { message: `${n} stories on the canvas`, timeout: 5000 }).toBe(n);
  return storyIds(page);
}

/** Bring elements into view, big enough to read and press (the canvas renders a card only in view). */
async function focus(page: Page, ...ids: string[]): Promise<void> {
  await page.evaluate((ids) => {
    const api = (window as unknown as { __board: { api: { getSceneElements(): { id: string }[]; scrollToContent(t?: unknown, o?: Record<string, unknown>): void } } }).__board.api;
    const els = api.getSceneElements().filter((e) => ids.includes(e.id));
    api.scrollToContent(els, { fitToViewport: true, viewportZoomFactor: 0.8, animate: false });
  }, ids);
}

/** The frame id of a feature board, by name. */
async function frameId(page: Page, name: string): Promise<string> {
  let id: string | undefined;
  await expect.poll(async () => (id = (await scene(page)).find((e) => e.type === 'frame' && e.name === name)?.id)).toBeTruthy();
  return id!;
}

interface Fields {
  title?: string;
  story?: string;
  check?: string;
  owner?: string;
  size?: 'S' | 'M' | 'L' | 'none';
  blockedBy?: string[];
}

/** Fill the story dialog and save. */
async function fillStory(page: Page, f: Fields): Promise<void> {
  const d = page.getByTestId('story-dialog');
  await expect(d).toBeVisible();
  if (f.title !== undefined) await d.locator('input[name="title"]').fill(f.title);
  if (f.story !== undefined) await d.locator('textarea[name="story"]').fill(f.story);
  if (f.check !== undefined) await d.locator('textarea[name="check"]').fill(f.check);
  if (f.owner !== undefined) await d.locator('input[name="owner"]').fill(f.owner);
  if (f.size) await d.getByTestId(`size-${f.size}`).click();
  for (const b of f.blockedBy ?? []) await d.getByTestId('choice').filter({ hasText: b }).locator('input').check();
  await d.getByTestId('dialog-save').click();
  await expect(d).toHaveCount(0);
}

/** Start Milestone 1 in an empty Milestone area with a first story, and fill it. Returns the story id. */
async function startStory(page: Page, frame: string, f: Fields): Promise<string> {
  const start = `${await frameId(page, frame)}~milestone-start`;
  await focus(page, start);
  await page.getByTestId('milestone-start').getByTestId('start-story').click();
  await fillStory(page, f);
  return (await stories(page, 1))[0]!;
}

const GOOD: Fields = {
  title: 'Card form ready',
  story: 'As a shopper, I want the card form to open fast, so that I can pay quickly.',
  check: 'the card form opens with an intent ID set.',
  owner: 'e2e',
  size: 'S',
};

test.describe('desktop', () => {
  test('import a milestone file: the milestone, its stories with previews, the blocks arrow, and new entries', async ({ page }) => {
    cli = await startCli({ ...BASE, 'checkout/milestone-1.md': MILESTONE });
    await openBoard(page, cli, 'checkout/api.md');
    const [s1, s2] = await stories(page, 2);

    // The file block says it is imported.
    await fitAll(page);
    await expect(block(page, 'checkout/milestone-1.md').getByTestId('milestone-imported')).toHaveText('imported · 2 stories');
    await expect(block(page, 'checkout/milestone-1.md').getByTestId('import-new')).toHaveCount(0);

    // The milestone card: number, name, goal and the count.
    const mid = ofKind(await scene(page), 'milestone')[0]!.id;
    await focus(page, mid);
    const m = page.getByTestId('milestone');
    await expect(m).toContainText('Milestone 1');
    await expect(m.getByTestId('milestone-name')).toHaveText('Pay by card');
    await expect(m.getByTestId('milestone-goal')).toHaveText('Goal: a shopper can pay by card.');
    await expect(m.getByTestId('milestone-count')).toHaveText('2 stories · 0 approved · 1 can start');

    // Story 1: both halves, live previews tagged "not agreed yet".
    await focus(page, s1!);
    const one = storyCard(page, s1!);
    await expect(one.getByTestId('story-number')).toHaveText('1');
    await expect(one.getByTestId('story-title')).toHaveText('Card form ready');
    await expect(one.getByTestId('story-sentence')).toContainText('I want the card form to open fast');
    const product = one.getByTestId('story-half-product');
    const eng = one.getByTestId('story-half-engineering');
    await expect(product).toHaveAttribute('data-count', '1');
    await expect(product.getByTestId('story-tag')).toHaveText('not agreed yet');
    await expect(product.getByTestId('story-preview')).toHaveAttribute('data-from', 'file');
    await expect(eng).toHaveAttribute('data-count', '1');
    await expect(eng.getByTestId('story-preview')).toContainText('POST /intents');
    await expect(one.getByTestId('story-size')).toHaveText('size S');
    await expect(one.getByTestId('story-owner')).toHaveText('owner e2e');
    await expect(one.getByTestId('story-start')).toHaveText('can start');
    await expect(one.getByTestId('story-check')).toContainText('the card form opens with an intent ID set.');

    // Story 2: no engineering part, blocked by Story 1, drawn as a "blocks" arrow.
    await focus(page, s2!);
    const two = storyCard(page, s2!);
    await expect(two.getByTestId('story-half-engineering')).toContainText('No engineering part');
    await expect(two.getByTestId('story-start')).toHaveText('blocked by Story 1 · Card form ready');
    await expect(two).toHaveAttribute('data-can-start', 'no');
    await expect(two.getByTestId('story-block')).toHaveText('Set an owner first');
    await expect(two.getByTestId('story-agree')).toBeDisabled();
    const els = await scene(page);
    const arrow = els.find((e) => e.id === `${s1}~blocks~${s2}`);
    expect(arrow?.ab?.ab).toBe('story-edge');
    expect([arrow?.start, arrow?.end]).toEqual([s1, s2]);
    expect(boundText(els, arrow!.id)).toBe('blocks');

    // Agree on the API card: Story 1 previews its snapshot, and links to it.
    await fitAll(page);
    await block(page, 'checkout/api.md').getByTestId('agree').click();
    await expect(block(page, 'checkout/api.md').getByTestId('agreed-badge')).toBeVisible();
    await focus(page, s1!);
    await expect(eng.getByTestId('story-preview')).toHaveAttribute('data-from', 'snapshot');
    await expect(eng.getByTestId('story-tag')).toHaveCount(0);
    await expect(eng.getByTestId('story-source')).toHaveText('from snapshot ↗');
    await eng.getByTestId('story-source').click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const api = (window as unknown as { __board: { api: { getAppState(): { selectedElementIds: Record<string, boolean> }; getSceneElements(): { id: string; customData?: { ab?: string } }[] } } }).__board.api;
          const sel = Object.keys(api.getAppState().selectedElementIds);
          return api.getSceneElements().filter((e) => sel.includes(e.id)).map((e) => e.customData?.ab);
        }),
      )
      .toEqual(['snapshot']);

    // The covered card changes after agreement: the story warns.
    cli.write('checkout/api.md', API + '\nGET /intents/:id\n');
    await focus(page, s1!);
    await expect(one.getByTestId('story-cover-changed')).toHaveText('a covered card changed; keep the snapshot or agree again before it goes to Linear', { timeout: 5000 });
    await expect(eng.getByTestId('story-tag')).toHaveText('changed after agreement');

    // A new entry in the file: "import new entries", once.
    cli.write('checkout/milestone-1.md', `${MILESTONE}\n${ENTRY_3}`);
    await fitAll(page);
    const importNew = block(page, 'checkout/milestone-1.md').getByTestId('import-new');
    await expect(importNew).toHaveText('import new entries (1)', { timeout: 5000 });
    await importNew.click();
    await stories(page, 3);
    await expect(block(page, 'checkout/milestone-1.md').getByTestId('milestone-imported')).toHaveText('imported · 3 stories');
    await expect(importNew).toHaveCount(0);
    await expect.poll(() => exp()?.stories.map((s) => s.title), { timeout: 3000 }).toEqual(['Card form ready', 'Pay', 'Refund']);
  });

  test('make a story by hand, cover two cards from the story and one from a card', async ({ page }) => {
    cli = await startCli(BASE);
    await openBoard(page, cli, 'checkout/api.md');
    const id = await startStory(page, 'checkout', GOOD);
    await focus(page, id);
    const s = storyCard(page, id);
    await expect(s.getByTestId('story-title')).toHaveText('Card form ready');
    await expect(s.getByTestId('story-half-product')).toContainText('No UI for this story');
    await expect(s.getByTestId('story-half-engineering')).toContainText('No engineering part');
    await expect(page.getByTestId('milestone-count')).toHaveText('1 story · 0 approved · 1 can start');

    // "+ card" on the story: pick two cards.
    await s.getByTestId('story-covers').click();
    const pick = page.getByTestId('pick-dialog');
    for (const p of ['checkout/flow.md', 'checkout/api.md']) await pick.getByTestId('choice').filter({ hasText: p }).locator('input').check();
    await pick.getByTestId('dialog-save').click();
    await expect(pick).toHaveCount(0);
    await focus(page, id);
    await expect(s.getByTestId('story-half-product')).toHaveAttribute('data-count', '1');
    await expect(s.getByTestId('story-half-product').getByTestId('story-preview')).toContainText('Card form, then pay.');
    await expect(s.getByTestId('story-half-engineering')).toHaveAttribute('data-count', '1');
    await expect(s.getByTestId('story-half-engineering').getByTestId('story-preview')).toContainText('POST /intents');

    // "Add to story" on a card in another feature board: the product side now shows the first plus "+1".
    await fitAll(page);
    await selectPaths(page, 'ui/card-form.html');
    await page.getByTestId('selection-bar').getByTestId('add-to-story').click();
    const choose = page.getByTestId('choose-dialog');
    await choose.getByTestId('choice').filter({ hasText: 'Story 1 · Card form ready' }).click();
    await expect(choose).toHaveCount(0);
    await focus(page, id);
    await expect(s.getByTestId('story-half-product')).toHaveAttribute('data-count', '2');
    await expect(s.getByTestId('story-half-product').getByTestId('story-more')).toHaveText('+1');
    await expect
      .poll(() => exp()?.stories[0]?.covers.map((c) => `${c.path}:${c.area}`), { timeout: 3000 })
      .toEqual(['checkout/flow.md:product', 'checkout/api.md:engineering', 'ui/card-form.html:product']);
  });

  test('blocked-by draws a "blocks" arrow and the story says "blocked by"', async ({ page }) => {
    cli = await startCli(BASE);
    await openBoard(page, cli, 'checkout/api.md');
    const s1 = await startStory(page, 'checkout', GOOD);
    const mid = ofKind(await scene(page), 'milestone')[0]!.id;
    await focus(page, mid);
    await page.getByTestId('milestone').getByTestId('add-story').click();
    await fillStory(page, { title: 'Pay', story: 'As a shopper, I want to pay.', blockedBy: ['Story 1 · Card form ready'] });
    const [, s2] = await stories(page, 2);

    await expect.poll(async () => (await scene(page)).find((e) => e.id === `${s1}~blocks~${s2}`)?.ab?.ab).toBe('story-edge');
    const els = await scene(page);
    expect(boundText(els, `${s1}~blocks~${s2}`)).toBe('blocks');
    await focus(page, s2!);
    await expect(storyCard(page, s2!).getByTestId('story-start')).toHaveText('blocked by Story 1 · Card form ready');
    await expect(storyCard(page, s2!)).toHaveAttribute('data-can-start', 'no');
    await focus(page, mid);
    await expect(page.getByTestId('milestone-count')).toHaveText('2 stories · 0 approved · 1 can start');
    await expect.poll(() => exp()?.stories.find((s) => s.id === s2)?.blocked_by, { timeout: 3000 }).toEqual([s1]);

    // Unblock: the arrow goes.
    await focus(page, s2!);
    await storyCard(page, s2!).getByTestId('story-edit').click();
    await page.getByTestId('story-dialog').getByTestId('choice').filter({ hasText: 'Story 1' }).locator('input').uncheck();
    await page.getByTestId('story-dialog').getByTestId('dialog-save').click();
    await expect.poll(async () => (await scene(page)).some((e) => e.id === `${s1}~blocks~${s2}`)).toBe(false);
    await expect(storyCard(page, s2!).getByTestId('story-start')).toHaveText('can start');
  });

  test('approve a story; an edit to the title resets the accepts; the milestone can be edited', async ({ page }) => {
    cli = await startCli(BASE);
    await openBoard(page, cli, 'checkout/api.md');
    const id = await startStory(page, 'checkout', { ...GOOD, owner: '' });
    await focus(page, id);
    const s = storyCard(page, id);
    // No accept without an owner.
    await expect(s.getByTestId('story-block')).toHaveText('Set an owner first');
    await expect(s.getByTestId('story-agree')).toBeDisabled();
    // No accept for an L story.
    await s.getByTestId('story-edit').click();
    await fillStory(page, { owner: 'e2e', size: 'L' });
    await expect(s.getByTestId('story-block')).toHaveText('Too big · split it');
    await expect(s.getByTestId('story-agree')).toBeDisabled();
    await s.getByTestId('story-edit').click();
    await fillStory(page, { size: 'M' });
    await expect(s.getByTestId('story-block')).toHaveCount(0);

    await s.getByTestId('story-agree').click();
    await expect(s).toHaveAttribute('data-approved', 'yes');
    await expect(s.getByTestId('story-agree')).toHaveText('✓ Agreed');
    await expect(s.getByTestId('story-accepts')).toHaveText('accepted by e2e');
    await expect.poll(() => exp()?.stories[0]?.approved, { timeout: 3000 }).toBe(true);

    // Edit the owner: the accept stays. Edit the title: the dialog warns, and the accept goes.
    await s.getByTestId('story-edit').click();
    await fillStory(page, { owner: 'Mei Ling' });
    await expect(s).toHaveAttribute('data-approved', 'yes');
    await s.getByTestId('story-edit').click();
    await page.getByTestId('story-dialog').locator('input[name="title"]').fill('Card form opens fast');
    await expect(page.getByTestId('resets-accepts')).toBeVisible();
    await page.getByTestId('story-dialog').getByTestId('dialog-save').click();
    await expect(s.getByTestId('story-title')).toHaveText('Card form opens fast');
    await expect(s).toHaveAttribute('data-approved', 'no');
    await expect(s.getByTestId('story-accepts')).toHaveText('no accepts yet');
    await expect.poll(() => exp()?.stories[0]?.accepts, { timeout: 3000 }).toEqual([]);

    // Reject goes to the story thread, with a reason.
    await s.getByTestId('story-reject').click();
    const reject = page.getByRole('dialog', { name: /Reject Story 1/ });
    await reject.locator('textarea').fill('split the 3DS part out');
    await reject.getByRole('button', { name: 'Reject' }).click();
    await expect(s.getByTestId('story-rejected')).toContainText('rejected by e2e: split the 3DS part out');

    // Edit the milestone card.
    const mid = ofKind(await scene(page), 'milestone')[0]!.id;
    await focus(page, mid);
    await page.getByTestId('milestone').getByTestId('milestone-edit').click();
    const md = page.getByTestId('milestone-dialog');
    await md.locator('input[name="name"]').fill('Pay by card');
    await md.locator('textarea[name="goal"]').fill('a shopper can pay by card.');
    await md.getByTestId('dialog-save').click();
    await expect(page.getByTestId('milestone-name')).toHaveText('Pay by card');
    await expect(page.getByTestId('milestone-goal')).toHaveText('Goal: a shopper can pay by card.');
    await expect.poll(() => exp()?.milestones[0]?.name, { timeout: 3000 }).toBe('Pay by card');
  });

  test('milestones and stories survive a reload and a CLI restart', async ({ page }) => {
    cli = await startCli({ ...BASE, 'checkout/milestone-1.md': MILESTONE });
    await openBoard(page, cli, 'checkout/api.md');
    const [s1] = await stories(page, 2);
    await focus(page, s1!);
    await storyCard(page, s1!).getByTestId('story-agree').click();
    await expect(storyCard(page, s1!)).toHaveAttribute('data-approved', 'yes');
    await storyCard(page, s1!).getByTestId('story-edit').click();
    await fillStory(page, { title: 'Card form opens fast' });
    await storyCard(page, s1!).getByTestId('story-agree').click();
    await expect(storyCard(page, s1!)).toHaveAttribute('data-approved', 'yes');
    await expect.poll(() => exp()?.stories[0]?.title, { timeout: 3000 }).toBe('Card form opens fast');
    await expect.poll(() => exp()?.stories[0]?.approved, { timeout: 3000 }).toBe(true);

    const check = async () => {
      const [a, b] = await stories(page, 2);
      expect(a).toBe(s1);
      await focus(page, a!);
      await expect(storyCard(page, a!).getByTestId('story-title')).toHaveText('Card form opens fast');
      await expect(storyCard(page, a!)).toHaveAttribute('data-approved', 'yes');
      await expect(storyCard(page, a!).getByTestId('story-half-product')).toHaveAttribute('data-count', '1');
      expect((await scene(page)).some((e) => e.id === `${a}~blocks~${b}`)).toBe(true);
      await fitAll(page);
      // Imported once: a restart does not import the file again.
      await expect(block(page, 'checkout/milestone-1.md').getByTestId('milestone-imported')).toHaveText('imported · 2 stories');
      await expect(page.getByTestId('milestone-count')).toHaveText('2 stories · 1 approved · 1 can start');
    };

    await page.reload();
    await openBoard(page, cli, 'checkout/api.md');
    await check();

    const folder = cli.folder;
    await cli.stop();
    cli = await startCli({}, folder);
    await openBoard(page, cli, 'checkout/api.md');
    await check();
    expect(exp()?.stories).toHaveLength(2);
  });
});

// A describe group cannot set the browser type, so take the phone's viewport, touch and agent only.
const { defaultBrowserType: _browser, ...PHONE } = devices['Pixel 7'];

test.describe('phone', () => {
  test.use(PHONE);

  test('a phone can open a story and approve it; the targets are big enough to tap', async ({ page }) => {
    cli = await startCli({ ...BASE, 'checkout/milestone-1.md': MILESTONE });
    await openBoard(page, cli, 'checkout/api.md', { fit: false });
    const [s1] = await stories(page, 2);
    await focus(page, s1!);
    const s = storyCard(page, s1!);
    await expect(s).toBeVisible();

    // Every button on the story is at least 32 CSS px high: no hover-only action.
    const heights = await s.locator('button').evaluateAll((bs) => bs.filter((b) => (b as HTMLElement).offsetParent !== null).map((b) => (b as HTMLElement).offsetHeight));
    expect(heights.length).toBeGreaterThan(3);
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(32);

    // Open the story: tap its Edit, then the dialog's targets are at least 32 px on screen.
    await s.getByTestId('story-edit').tap();
    const d = page.getByTestId('story-dialog');
    await expect(d).toBeVisible();
    for (const t of ['size-S', 'size-M', 'dialog-save']) {
      const box = await d.getByTestId(t).boundingBox();
      expect(box!.height, t).toBeGreaterThanOrEqual(32);
    }
    await d.getByRole('button', { name: 'Cancel' }).tap();
    await expect(d).toHaveCount(0);

    await focus(page, s1!);
    await s.getByTestId('story-agree').tap();
    await expect(s).toHaveAttribute('data-approved', 'yes');
    await expect.poll(() => exp()?.stories[0]?.approved, { timeout: 3000 }).toBe(true);
  });
});
