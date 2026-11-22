import { stripFrontMatter } from '@agent-board/formats';
import DOMPurify from 'dompurify';
import { Marked, type Tokens } from 'marked';

/**
 * Pele (the mermaid renderer) is about a third of the page's code, and only a card with a mermaid
 * fence needs it: it loads on its own, when the first such card shows (see `MarkdownBody`).
 */
type Pele = typeof import('pele');
let pele: Pele | null = null;
let peleLoading: Promise<void> | null = null;

export const mermaidReady = () => pele !== null;

export function loadMermaid(): Promise<void> {
  peleLoading ??= import('pele').then((m) => {
    pele = m;
  });
  return peleLoading;
}

/** Whether markdown has a mermaid fence (so it needs Pele). */
export const hasMermaid = (text: string) => /^ {0,3}(`{3,}|~{3,})[ \t]*mermaid\b/m.test(text);

/**
 * Each fence's rendered diagram, by its source: pan, zoom, a card coming back into view, the full
 * view and a snapshot of the same text never render it again.
 */
const diagrams = new Map<string, string>();
const DIAGRAMS_MAX = 300;
/** How many times Pele has rendered (for tests). */
export const mermaidStats = { renders: 0 };

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Renders one mermaid fence with Pele. A broken fence shows the raw text and the parse error. */
export function renderMermaidFence(source: string): string {
  // Until Pele loads, an empty diagram box; the card renders again once it has loaded.
  if (!pele) return '<div class="mermaid-block mermaid-loading"></div>';
  const cached = diagrams.get(source);
  if (cached !== undefined) return cached;
  const html = renderFence(pele, source);
  if (diagrams.size >= DIAGRAMS_MAX) diagrams.delete(diagrams.keys().next().value!);
  diagrams.set(source, html);
  return html;
}

function renderFence(p: Pele, source: string): string {
  mermaidStats.renders++;
  try {
    const { svg } = p.render(source);
    return `<div class="mermaid-block">${svg}</div>`;
  } catch (err) {
    const where = err instanceof p.PeleError && err.line > 0 ? ` (line ${err.line}, column ${err.column})` : '';
    const message = err instanceof Error ? err.message : String(err);
    return (
      `<div class="mermaid-error" role="alert">` +
      `<div class="mermaid-error-message">Mermaid error${escapeHtml(where)}: ${escapeHtml(message)}</div>` +
      `<pre class="mermaid-error-source">${escapeHtml(source)}</pre></div>`
    );
  }
}

const marked = new Marked({
  async: false,
  gfm: true,
  renderer: {
    code(token: Tokens.Code): string | false {
      if (token.lang?.trim().split(/\s+/)[0] === 'mermaid') return renderMermaidFence(token.text);
      return false; // default renderer
    },
  },
});

/**
 * Markdown file text to safe HTML. The front matter is not shown. The output goes through
 * DOMPurify: raw HTML in an agent's markdown would otherwise run script in the board's page
 * (spike A, security finding 1). Links open in a new tab, never in the board.
 */
export function renderMarkdown(text: string): string {
  const html = marked.parse(stripFrontMatter(text)) as string;
  const clean = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
    ADD_ATTR: ['target'],
  });
  return addLinkTargets(clean);
}

function addLinkTargets(html: string): string {
  return html.replace(/<a\s/g, '<a target="_blank" rel="noopener noreferrer" ');
}
