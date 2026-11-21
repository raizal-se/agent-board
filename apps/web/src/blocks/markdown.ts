import { stripFrontMatter } from '@agent-board/formats';
import DOMPurify from 'dompurify';
import { Marked, type Tokens } from 'marked';
import { PeleError, render as renderMermaid } from 'pele';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Renders one mermaid fence with Pele. A broken fence shows the raw text and the parse error. */
export function renderMermaidFence(source: string): string {
  try {
    const { svg } = renderMermaid(source);
    return `<div class="mermaid-block">${svg}</div>`;
  } catch (err) {
    const where = err instanceof PeleError && err.line > 0 ? ` (line ${err.line}, column ${err.column})` : '';
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
