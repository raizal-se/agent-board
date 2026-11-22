import { devices, expect, test, type CDPSession, type Page } from '@playwright/test';
import { guardPage } from './canvas';
import { startCli, type RunningCli } from './cli';

/**
 * How the board does on a slow phone through a tunnel: a Pixel 7 screen, the CPU throttled 4x and
 * a slow link. It logs the numbers (`phone perf {...}`) for each way the page is downloaded: raw
 * (Accept-Encoding: identity, as before the CLI compressed) and compressed (what Chrome asks for).
 * The checks are loose; the numbers are the point.
 */
test.use({ ...devices['Pixel 7'] });

const LONG = Array.from({ length: 50 }, (_, i) => `- Step ${i + 1}: the card form posts to the payment API, which answers within a second.`).join('\n');
const FLOW = '```mermaid\nflowchart LR\n  A[Card form] --> B[Payment API]\n  B --> C{Approved?}\n  C -->|yes| D[Receipt]\n  C -->|no| E[Retry]\n```\n';
const SEQ = '```mermaid\nsequenceDiagram\n  participant U as User\n  participant A as API\n  U->>A: POST /pay\n  A-->>U: 200 OK\n```\n';

/** A board like the demo: three feature boards, long cards, a few diagrams. */
const FILES: Record<string, string> = {};
for (const folder of ['checkout', 'onboarding', 'reports']) {
  FILES[`${folder}/overview.md`] = `---\narea: product\n---\n# ${folder} overview\n\n${FLOW}\n${LONG}\n`;
  FILES[`${folder}/flow.md`] = `---\narea: product\n---\n# ${folder} flow\n\n${SEQ}\nShort text.\n`;
  FILES[`${folder}/notes.md`] = `---\narea: product\n---\n# ${folder} notes\n\n${LONG}\n`;
  FILES[`${folder}/api.md`] = `---\narea: engineering\n---\n# ${folder} API\n\n${FLOW}\n`;
  FILES[`${folder}/db.md`] = `---\narea: engineering\n---\n# ${folder} tables\n\n${LONG}\n`;
  FILES[`${folder}/todo.md`] = `---\narea: engineering\n---\n# ${folder} todo\n\n- one\n- two\n`;
}

/** The link: about a phone on a tunnel. */
const LINK = { latency: 80, downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: (5 * 1024 * 1024) / 8 };
const CPU = 4;

let cli: RunningCli | undefined;
guardPage(() => cli);
test.beforeEach(async () => {
  cli = await startCli(FILES);
});

/** In the page, from the start: when the first card shows, when every card in view has its content, long tasks. */
function watchLoad() {
  const w = window as unknown as {
    __perf: { firstCard?: number; allInView?: number; inView?: number; mermaidInView?: number; longTaskMs: number; longTasks: number };
    __board?: { opened?: boolean; api: { getAppState(): Record<string, any>; getSceneElements(): Record<string, any>[] } };
  };
  w.__perf = { longTaskMs: 0, longTasks: 0 };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        w.__perf.longTaskMs += e.duration;
        w.__perf.longTasks++;
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    /* no long task timing */
  }
  const shown = (el: Element | null) => !!el && !!el.querySelector('.block-text *, iframe') && !el.querySelector('.mermaid-loading');
  const tick = () => {
    const p = w.__perf;
    if (p.firstCard === undefined && [...document.querySelectorAll('[data-testid="block"]')].some(shown)) p.firstCard = performance.now();
    const b = w.__board;
    if (b?.opened && p.allInView === undefined) {
      const s = b.api.getAppState();
      const z = s.zoom.value as number;
      const files = b.api.getSceneElements().filter((e) => {
        if (e.customData?.ab !== 'file') return false;
        const l = (e.x + s.scrollX) * z;
        const t = (e.y + s.scrollY) * z;
        return l < s.width && l + e.width * z > 0 && t < s.height && t + e.height * z > 0;
      });
      const blocks = files.map((e) => document.querySelector(`[data-testid="block"][data-path="${CSS.escape(String(e.customData.path))}"]`));
      if (files.length > 0 && blocks.every(shown)) {
        p.allInView = performance.now();
        p.inView = files.length;
        p.mermaidInView = blocks.filter((x) => x!.querySelector('.mermaid-block svg')).length;
      }
    }
    if (p.allInView === undefined) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function frameTimes(page: Page, act: () => Promise<void>): Promise<{ median: number; p95: number; max: number; n: number }> {
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
  await act();
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __stop: boolean };
    w.__stop = true;
    return w.__frames.slice(1);
  });
  const s = [...frames].sort((a, b) => a - b);
  const at = (q: number) => Math.round(s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? 0);
  return { median: at(0.5), p95: at(0.95), max: Math.round(s[s.length - 1] ?? 0), n: s.length };
}

/** Two fingers dragging the board left and up, in small steps, as a thumb pan does. */
async function pan(cdp: CDPSession, page: Page) {
  const { width, height } = page.viewportSize()!;
  const y = height * 0.55;
  const from = [{ x: width * 0.35, y }, { x: width * 0.65, y }];
  const steps = 40;
  const at = (t: number) => from.map((p, id) => ({ x: p.x - 300 * t, y: p.y - 400 * t, id }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
  for (let i = 1; i <= steps; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(i / steps) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

for (const mode of ['raw', 'compressed'] as const) {
  test(`phone perf, ${mode}: time to the first card and to every card in the first view, and pan frames (CPU ${CPU}x, slow link)`, async ({ page }) => {
    test.setTimeout(180_000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...LINK });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
    if (mode === 'raw') await page.setExtraHTTPHeaders({ 'Accept-Encoding': 'identity' });

    const bytes = new Map<string, { url: string; encoded: number; encoding: string }>();
    cdp.on('Network.responseReceived', (e) => {
      const h = Object.fromEntries(Object.entries(e.response.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
      bytes.set(e.requestId, { url: e.response.url, encoded: 0, encoding: h['content-encoding'] ?? 'none' });
    });
    cdp.on('Network.loadingFinished', (e) => {
      const r = bytes.get(e.requestId);
      if (r) r.encoded = e.encodedDataLength;
    });

    await page.addInitScript(watchLoad);
    await page.goto(cli!.url);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __perf: { allInView?: number } }).__perf.allInView ?? null), { timeout: 150_000, intervals: [250] })
      .not.toBeNull();
    const load = await page.evaluate(() => (window as unknown as { __perf: Record<string, number> }).__perf);
    // Settle: what loads after the first view (mermaid renderer, fonts) is part of the first visit.
    await page.waitForTimeout(1500);
    const panFrames = await frameTimes(page, () => pan(cdp, page));

    const all = [...bytes.values()];
    const kb = (n: number) => Math.round(n / 1024);
    const scripts = all.filter((r) => /\.js(\?|$)/.test(r.url)).map((r) => `${r.url.split('/').pop()} ${kb(r.encoded)}KB ${r.encoding}`);
    const main = all.find((r) => /\/assets\/index-[^/]+\.js$/.test(r.url));
    const numbers = {
      mode,
      cpu: `${CPU}x`,
      link: '10 Mbit/s, 80 ms',
      transferKB: kb(all.reduce((n, r) => n + r.encoded, 0)),
      mainJs: main ? `${kb(main.encoded)}KB ${main.encoding}` : null,
      firstCardMs: Math.round(load.firstCard ?? -1),
      allInViewMs: Math.round(load.allInView ?? -1),
      cardsInView: load.inView,
      mermaidInView: load.mermaidInView,
      longTasks: load.longTasks,
      longTaskMs: Math.round(load.longTaskMs ?? 0),
      panFrameMedianMs: panFrames.median,
      panFrameP95Ms: panFrames.p95,
      panFrameMaxMs: panFrames.max,
      scripts,
    };
    console.log('phone perf', JSON.stringify(numbers));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

    expect(load.inView, 'some cards are in the first view').toBeGreaterThan(0);
    if (mode === 'compressed') expect(main?.encoding, 'the main script comes compressed').toMatch(/^(br|gzip)$/);
    else expect(main?.encoding, 'identity gets the raw file').toBe('none');
  });
}
