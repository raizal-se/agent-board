import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { startLocalNostrRelay, type LocalRelay } from '../../../packages/sync/src/testing/local-nostr-relay';
import { block, canvasUp, fitAll, idOf } from './canvas';
import { HostCli, startApp, type Proc } from './peers';

/**
 * A shared board, peer to peer: one CLI (the host, Raizal), browser-only guests (Dewi, Tan, Sari),
 * a local Nostr relay, real WebRTC. The web app is served alone (`agent-board app`), as from a
 * static host. Run from apps/web: `../../node_modules/.bin/playwright test -c e2e/playwright.config.ts peers`.
 */

// Chromium hides local addresses behind mDNS names; the CLI's WebRTC cannot resolve them.
test.use({ launchOptions: { args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] } });
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const API = '# Payment API\n\nPOST /intents\n';

let relay: LocalRelay;
let app: Proc & { url: string };
let host: HostCli;
let hostPage: Page;
const contexts: BrowserContext[] = [];
const errors: string[] = [];

async function newPage(browser: Browser, name: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, permissions: ['clipboard-read', 'clipboard-write'] });
  contexts.push(ctx);
  // The page finds the local relay here instead of the public ones.
  await ctx.addInitScript((url) => localStorage.setItem('agent-board:relays', url), relay.url);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  return page;
}

const exported = () => {
  try {
    return JSON.parse(readFileSync(join(host.folder, '.agent-board', 'board.json'), 'utf8')) as {
      people?: { name: string; side: string; online?: boolean }[];
      items: { kind: string; path?: string | null; content?: string; area?: string | null }[];
    };
  } catch {
    return undefined;
  }
};

/** The browser peer's own doc, for checks the canvas cannot show. */
const peerItems = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as { __peer: { doc: { getMap(n: string): Map<string, { kind: string; path?: string; text?: string }> } } }).__peer;
    return [...p.doc.getMap('items').values()].map((i) => ({ kind: i.kind, path: i.path, text: i.text }));
  });

async function joinAs(page: Page, name: string, side: 'Product' | 'Engineering') {
  await page.goto(host.link);
  await expect(page.getByTestId('join-name')).toBeVisible();
  await page.getByTestId('join-name').fill(name);
  await page.getByLabel(side).check();
  await page.getByTestId('join-submit').click();
}

const request = (page: Page, name: string) => page.getByTestId('join-request').filter({ hasText: `${name} (` });

async function showsFile(page: Page, path: string) {
  await canvasUp(page);
  await idOf(page, path);
  await fitAll(page);
  await expect(block(page, path)).toBeVisible();
}

async function onlineNames(page: Page): Promise<string[]> {
  await page.getByTestId('people-button').click();
  const names = await page.getByTestId('online-person').evaluateAll((els) => els.map((e) => e.getAttribute('data-name') ?? ''));
  await page.getByTestId('people-panel').getByRole('button', { name: 'Close' }).click();
  return names.sort();
}

test.beforeAll(async ({ browser }) => {
  relay = await startLocalNostrRelay();
  app = await startApp();
  host = new HostCli(relay.url, `${app.url}/`);
  host.write('checkout/api.md', API);
  host.invite();
  await host.start();
  hostPage = await newPage(browser, 'host');
  await hostPage.goto(host.url);
  await showsFile(hostPage, 'checkout/api.md');
});

test.afterAll(async () => {
  for (const c of contexts) await c.close();
  await host?.stop();
  await app?.stop();
  await relay?.close();
  expect(errors, 'no errors in the pages').toEqual([]);
});

let dewi: Page;

test('a browser guest asks, the host approves with one click, both see each other and the files', async ({ browser }) => {
  expect(host.link.startsWith(`${app.url}/#`)).toBe(true);
  dewi = await newPage(browser, 'Dewi');
  await joinAs(dewi, 'Dewi', 'Product');
  await expect(dewi.getByTestId('join-status')).toHaveText('Waiting for Raizal to let you in', { timeout: 30_000 });

  const req = request(hostPage, 'Dewi');
  await expect(req).toContainText('Dewi (product) wants to join', { timeout: 20_000 });
  await req.getByRole('button', { name: 'Approve' }).click();
  await expect(req).toHaveCount(0);

  await expect(dewi.getByTestId('toast')).toHaveText("You're in", { timeout: 20_000 });
  await showsFile(dewi, 'checkout/api.md');
  await expect.poll(() => onlineNames(dewi), { timeout: 20_000 }).toEqual(['Dewi', 'Raizal']);
  await expect.poll(() => onlineNames(hostPage), { timeout: 20_000 }).toEqual(['Dewi', 'Raizal']);
  await expect.poll(() => exported()?.people?.map((p) => p.name).sort()).toEqual(['Dewi', 'Raizal']);

  // A note from the guest reaches the host's CLI (board.json).
  await dewi.getByRole('button', { name: '+ note' }).click();
  await expect.poll(() => exported()?.items.filter((i) => i.kind === 'sticky').length, { timeout: 20_000 }).toBe(1);

  // Cursors with names: the host's pointer reaches the guest.
  await hostPage.mouse.move(400, 400);
  await hostPage.mouse.move(420, 430);
  await expect
    .poll(() => dewi.evaluate(() => (window as unknown as { __peer: { peer: { state(): { online: { name: string; cursor: unknown }[] } } } }).__peer.peer.state().online.find((o) => o.name === 'Raizal')?.cursor ?? null), { timeout: 15_000 })
    .not.toBeNull();
});

test('Connect your agent shows a ready prompt with the invite, and Copy works', async () => {
  for (const page of [hostPage, dewi]) {
    await page.getByTestId('connect-agent-button').click();
    const dialog = page.getByTestId('connect-agent');
    await expect(dialog).toBeVisible();
    const prompt = await dialog.getByTestId('agent-prompt').inputValue();
    expect(prompt).toContain(`join '${host.link}'`);
    await expect(dialog.getByTestId('prompt-warning')).toContainText('Anyone with this prompt can ask to join');
    await dialog.getByRole('button', { name: 'Copy prompt' }).click();
    await expect(dialog.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(prompt);
    await dialog.getByRole('button', { name: 'Close' }).click();
  }
});

test('a denied guest gets nothing', async ({ browser }) => {
  const tan = await newPage(browser, 'Tan');
  await joinAs(tan, 'Tan', 'Engineering');
  const req = request(hostPage, 'Tan');
  await expect(req).toBeVisible({ timeout: 30_000 });
  await req.getByRole('button', { name: 'Deny' }).click();
  await expect(tan.getByTestId('join-status')).toHaveText('Raizal did not let you in.', { timeout: 20_000 });
  await tan.waitForTimeout(1500);
  expect((await peerItems(tan)).filter((i) => i.kind === 'file')).toEqual([]);
  await expect(tan.getByTestId('block')).toHaveCount(0);
  await tan.context().close();
});

test('the guest rejoins after a reload with no prompt', async () => {
  await dewi.reload();
  await expect(dewi.getByTestId('join-name')).toHaveCount(0);
  await showsFile(dewi, 'checkout/api.md');
  await expect.poll(() => onlineNames(dewi), { timeout: 30_000 }).toEqual(['Dewi', 'Raizal']);
});

test('agree needs both sides', async () => {
  await fitAll(hostPage);
  await block(hostPage, 'checkout/api.md').getByTestId('agree').click();
  await expect(block(hostPage, 'checkout/api.md').getByTestId('waiting')).toHaveText('1 of 2 · waiting for product');
  await fitAll(dewi);
  await expect(block(dewi, 'checkout/api.md').getByTestId('waiting')).toHaveText('1 of 2 · waiting for product', { timeout: 15_000 });
  await expect(block(dewi, 'checkout/api.md').getByTestId('agreed-badge')).toHaveCount(0);
  await block(dewi, 'checkout/api.md').getByTestId('agree').click();
  for (const page of [dewi, hostPage]) {
    await expect(block(page, 'checkout/api.md').getByTestId('agreed-badge')).toBeVisible({ timeout: 15_000 });
    await expect(block(page, 'checkout/api.md').getByTestId('waiting')).toHaveCount(0);
  }
});

test("a guest cannot change the host's file card", async () => {
  await fitAll(dewi);
  // The page does not offer it…
  await expect(block(dewi, 'checkout/api.md').getByTestId('area-switch').getByRole('button').first()).toBeDisabled();
  // …and a change made anyway is undone on every peer.
  await dewi.evaluate(() => {
    const items = (window as unknown as { __peer: { doc: { getMap(n: string): Map<string, Record<string, unknown>> & { set(k: string, v: unknown): void } } } }).__peer.doc.getMap('items');
    for (const [id, v] of items) if (v.kind === 'file') items.set(id, { ...v, text: '# hacked' });
  });
  await expect.poll(async () => (await peerItems(dewi)).find((i) => i.path === 'checkout/api.md')?.text, { timeout: 10_000 }).toBe(API);
  await hostPage.waitForTimeout(1500);
  expect(exported()?.items.find((i) => i.path === "checkout/api.md")?.content).toBe(API);
  expect(readFileSync(join(host.folder, 'checkout', 'api.md'), 'utf8')).toBe(API);
});

test('with the CLI stopped, two approved browsers sync; the CLI comes back and catches up', async ({ browser }) => {
  // Any member can let a person in: Dewi approves Sari.
  const sari = await newPage(browser, 'Sari');
  await joinAs(sari, 'Sari', 'Engineering');
  const req = request(dewi, 'Sari');
  await expect(req).toBeVisible({ timeout: 30_000 });
  // Point 14: the other member's page says who is handling it.
  await expect(request(hostPage, 'Sari')).toBeVisible({ timeout: 15_000 });
  await req.getByRole('button', { name: 'Approve' }).click();
  await showsFile(sari, 'checkout/api.md');

  await host.stop();
  await expect.poll(() => onlineNames(dewi), { timeout: 40_000 }).toEqual(['Dewi', 'Sari']);

  const before = (await peerItems(sari)).filter((i) => i.kind === 'sticky').length;
  await dewi.getByRole('button', { name: '+ note' }).click();
  await expect.poll(async () => (await peerItems(sari)).filter((i) => i.kind === 'sticky').length, { timeout: 20_000 }).toBe(before + 1);

  // With Sari gone too, Dewi works on her own copy.
  await sari.context().close();
  await expect(dewi.getByTestId('offline-banner')).toHaveText("Raizal and Sari are offline, you're still working on your own copy", { timeout: 40_000 });
  await dewi.getByRole('button', { name: '+ note' }).click();

  await host.start();
  await expect.poll(() => exported()?.items.filter((i) => i.kind === 'sticky').length, { timeout: 40_000 }).toBe(before + 2);
  await expect(dewi.getByTestId('offline-banner')).toHaveCount(0, { timeout: 30_000 });
});
