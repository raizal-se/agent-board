import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunningCli } from './cli';

/**
 * Helpers for the board on the Excalidraw canvas. The canvas draws on a <canvas>, so the checks read
 * the scene through `window.__board.api` (set by BoardCanvas) and use the blocks' own DOM (embeds).
 */

export interface SceneEl {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  name: string | null;
  text: string | null;
  link: string | null;
  frameId: string | null;
  containerId: string | null;
  strokeStyle: string;
  locked: boolean;
  points: [number, number][] | null;
  start: string | null;
  end: string | null;
  ab: Record<string, unknown> | null;
}

export async function scene(page: Page): Promise<SceneEl[]> {
  return page.evaluate(() => {
    const api = (window as unknown as { __board: { api: { getSceneElements(): Record<string, any>[] } } }).__board.api;
    return api.getSceneElements().map((e) => ({
      id: e.id,
      type: e.type,
      x: e.x,
      y: e.y,
      width: e.width,
      height: e.height,
      angle: e.angle,
      name: e.name ?? null,
      text: e.originalText ?? e.text ?? null,
      link: e.link ?? null,
      frameId: e.frameId ?? null,
      containerId: e.containerId ?? null,
      strokeStyle: e.strokeStyle,
      locked: !!e.locked,
      points: e.points ?? null,
      start: e.startBinding?.elementId ?? null,
      end: e.endBinding?.elementId ?? null,
      ab: e.customData ?? null,
    }));
  });
}

export const ofKind = (els: SceneEl[], kind: string) => els.filter((e) => e.ab?.ab === kind);
export const byPath = (els: SceneEl[], path: string) => els.find((e) => e.ab?.ab === 'file' && e.ab.path === path);
/** The text bound to a container (a note's text, a link's label). */
export const boundText = (els: SceneEl[], containerId: string) => els.find((e) => e.type === 'text' && e.containerId === containerId)?.text ?? null;

/** Where a file block is on the board (scene coordinates), rounded. */
export async function placeOf(page: Page, path: string): Promise<{ x: number; y: number } | null> {
  const el = byPath(await scene(page), path);
  return el ? { x: Math.round(el.x), y: Math.round(el.y) } : null;
}

export interface ScreenBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An element's box on screen. Excalidraw maps a scene point as (point + scroll) * zoom, from the canvas' corner. */
export async function screenBox(page: Page, id: string): Promise<ScreenBox> {
  return page.evaluate((id) => {
    const api = (window as unknown as { __board: { api: { getSceneElements(): Record<string, any>[]; getAppState(): Record<string, any> } } }).__board.api;
    const s = api.getAppState();
    const e = api.getSceneElements().find((x) => x.id === id);
    if (!e) throw new Error(`no element ${id}`);
    const z = s.zoom.value as number;
    return { x: (e.x + s.scrollX) * z + s.offsetLeft, y: (e.y + s.scrollY) * z + s.offsetTop, width: e.width * z, height: e.height * z };
  }, id);
}

/** A point on screen for a scene point. */
export async function toScreen(page: Page, p: { x: number; y: number }): Promise<{ x: number; y: number }> {
  return page.evaluate((p) => {
    const s = (window as unknown as { __board: { api: { getAppState(): Record<string, any> } } }).__board.api.getAppState();
    const z = s.zoom.value as number;
    return { x: (p.x + s.scrollX) * z + s.offsetLeft, y: (p.y + s.scrollY) * z + s.offsetTop };
  }, p);
}

/** A point in an element to press on: its lower middle, clear of a block's title bar buttons. */
export async function pressPoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  const b = await screenBox(page, id);
  return { x: b.x + b.width / 2, y: b.y + b.height * 0.65 };
}

/** Click an element on the canvas; with `add`, add it to the selection (Shift+click, as in Excalidraw). */
export async function clickEl(page: Page, id: string, add = false): Promise<void> {
  const p = await pressPoint(page, id);
  if (add) await page.keyboard.down('Shift');
  await page.mouse.click(p.x, p.y);
  if (add) await page.keyboard.up('Shift');
}

/** The board id of a file block, by path, once its block is on the canvas. */
export async function idOf(page: Page, path: string): Promise<string> {
  let id: string | undefined;
  await expect
    .poll(async () => (id = byPath(await scene(page), path)?.id), { message: `a block for ${path} on the canvas` })
    .toBeTruthy();
  return id!;
}

/** Select file blocks in this order, by clicking them on the canvas. */
export async function selectPaths(page: Page, ...paths: string[]): Promise<void> {
  for (const [i, p] of paths.entries()) await clickEl(page, await idOf(page, p), i > 0);
  await expect(page.getByTestId('selection-bar')).toContainText(paths.length === 1 ? paths[0]! : `${paths.length} selected`);
}

export const block = (page: Page, path: string) => page.locator(`[data-testid="block"][data-path="${path}"]`);

/**
 * Open the board and wait until the doc is on the canvas: `first` has its element in the scene
 * and its block's DOM shows, and every file the CLI exported has its block in the scene.
 */
export async function openBoard(page: Page, cli: RunningCli, first: string): Promise<void> {
  await page.goto(cli.url);
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'online');
  await idOf(page, first);
  await expect(block(page, first)).toBeVisible();
  await expect
    .poll(async () => {
      const files = (exported(cli)?.items ?? []).filter((i) => i.kind === 'file' && !i.gone).map((i) => i.path!);
      const els = await scene(page);
      return files.filter((p) => !byPath(els, p));
    }, { message: 'every exported file has its block on the canvas' })
    .toEqual([]);
}

export interface Exported {
  items: { id: string; kind: string; path: string | null; gone?: boolean; frame: string | null; content: string; author?: string; state: string; zone: string; snapshot: { content: string } | null; changed_after_agreement?: boolean }[];
  comments: { target: string; resolved: boolean; comments: { author: string; text: string }[] }[];
  edges: { source: string; label: string }[];
  decisions: { text: string; covers: string[] }[];
}

/** The JSON export the CLI writes for agents. */
export function exported(cli: RunningCli): Exported | undefined {
  try {
    return JSON.parse(readFileSync(join(cli.folder, '.agent-board', 'board.json'), 'utf8')) as Exported;
  } catch {
    return undefined;
  }
}

/**
 * Every test: no page errors, and no request to anything but the board's own origin (fonts,
 * libraries and embeds all come from the CLI).
 */
export function guardPage(getCli: () => RunningCli | undefined): void {
  let errors: string[] = [];
  let outside: string[] = [];
  test.beforeEach(async ({ page }) => {
    errors = [];
    outside = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => {
      const url = r.url();
      if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return;
      const cli = getCli();
      if (cli && new URL(url).origin !== new URL(cli.url).origin) outside.push(url);
    });
  });
  test.afterEach(async () => {
    await getCli()?.stop();
    expect(errors, 'no errors in the page').toEqual([]);
    expect(outside, 'no requests to anything but the board').toEqual([]);
  });
}

/**
 * Fit the whole board in view. Excalidraw renders an embed only once it has been in view, so a
 * block that arrives below the first view needs this before its DOM can be checked.
 */
export async function fitAll(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = (window as unknown as { __board: { api: { scrollToContent(t?: unknown, o?: Record<string, unknown>): void } } }).__board.api;
    api.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.9 });
  });
}
