import { parse as parseYaml } from 'yaml';

/** A link declared inside a file (design section 4.3). `to` is a path relative to the shared folder. */
export interface FileLink {
  to: string;
  label: string;
}

const FRONT_MATTER = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/;

/** Markdown text without its front matter block (the board shows the body only). */
export function stripFrontMatter(text: string): string {
  const m = FRONT_MATTER.exec(text);
  return m ? text.slice(m[0].length) : text;
}

function normalizePath(p: string): string {
  return p.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}

function dedupe(links: FileLink[]): FileLink[] {
  const seen = new Set<string>();
  return links.filter((l) => {
    const key = `${l.to}\u0000${l.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Links from markdown front matter: `links: [{ to, label }]`. Never throws. */
export function parseMarkdownLinks(text: string): FileLink[] {
  const m = FRONT_MATTER.exec(text);
  if (!m) return [];
  let data: unknown;
  try {
    data = parseYaml(m[1] ?? '');
  } catch {
    return [];
  }
  if (!data || typeof data !== 'object') return [];
  const raw = (data as Record<string, unknown>).links;
  if (!Array.isArray(raw)) return [];
  const out: FileLink[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { to, label } = entry as Record<string, unknown>;
    if (typeof to !== 'string') continue;
    const path = normalizePath(to);
    if (!path) continue;
    out.push({ to: path, label: typeof label === 'string' ? label.trim() : '' });
  }
  return dedupe(out);
}

const META_TAG = /<meta\b([^>]*)>/gi;
const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+))/g;

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Links from `<meta name="board:link" content="path | label">`. Never throws. */
export function parseHtmlLinks(html: string): FileLink[] {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const out: FileLink[] = [];
  for (const tag of withoutComments.matchAll(META_TAG)) {
    const attrs: Record<string, string> = {};
    for (const a of (tag[1] ?? '').matchAll(ATTR)) {
      attrs[(a[1] ?? '').toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
    }
    if (attrs.name?.trim().toLowerCase() !== 'board:link' || attrs.content === undefined) continue;
    const bar = attrs.content.indexOf('|');
    const to = normalizePath(bar === -1 ? attrs.content : attrs.content.slice(0, bar));
    const label = bar === -1 ? '' : attrs.content.slice(bar + 1).trim();
    if (!to) continue;
    out.push({ to, label });
  }
  return dedupe(out);
}

export type FileType = 'markdown' | 'html';

/** Which block a file becomes, from its extension: `.md`/`.markdown` or `.html`/`.htm`. Null for other files. */
export function fileTypeOf(path: string): FileType | null {
  if (/\.(md|markdown)$/i.test(path)) return 'markdown';
  if (/\.html?$/i.test(path)) return 'html';
  return null;
}

/** Picks the parser from the file extension. Other file types have no links. */
export function parseFileLinks(path: string, text: string): FileLink[] {
  const type = fileTypeOf(path);
  if (type === 'markdown') return parseMarkdownLinks(text);
  if (type === 'html') return parseHtmlLinks(text);
  return [];
}
