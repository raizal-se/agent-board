// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

// jsdom has no canvas; Pele measures text with one when it can and falls back when it cannot.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

describe('renderMarkdown', () => {
  it('renders a mermaid fence to SVG with Pele', () => {
    const html = renderMarkdown('# Flow\n\n```mermaid\nflowchart LR\n  A[Card form] --> B[Payment API]\n```\n');
    expect(html).toContain('<h1>Flow</h1>');
    expect(html).toMatch(/<div class="mermaid-block"><svg/);
    expect(html).toContain('Payment API');
  });

  it('shows a broken fence as raw text with the parse error', () => {
    const html = renderMarkdown('```mermaid\nflowchart LR\n  A[Card form --> B\n```\n');
    expect(html).toContain('class="mermaid-error"');
    expect(html).toContain('Mermaid error');
    expect(html).toContain('A[Card form --&gt; B');
    expect(html).not.toContain('<svg');
  });

  it('leaves other code fences alone', () => {
    expect(renderMarkdown('```ts\nconst a = 1;\n```\n')).toContain('<code class="language-ts">');
  });

  it('does not show the front matter', () => {
    const html = renderMarkdown('---\nlinks:\n  - to: a.md\n---\n# Body\n');
    expect(html).toContain('<h1>Body</h1>');
    expect(html).not.toContain('links');
  });

  it('removes script from raw HTML in markdown (spike A finding)', () => {
    const html = renderMarkdown(
      'Hi <img src=x onerror="alert(1)"> <script>alert(2)</script> <a href="javascript:alert(3)">x</a>\n\n<iframe src="https://evil.example"></iframe><svg><script>alert(4)</script></svg>',
    );
    expect(html).not.toMatch(/onerror|<script|javascript:|<iframe/i);
    expect(html).toContain('<img src="x">');
  });

  it('removes script hidden in a mermaid label', () => {
    const html = renderMarkdown('```mermaid\nflowchart LR\n  A["<img src=x onerror=alert(1)>"] --> B\n```\n');
    expect(html).not.toMatch(/onerror/i);
  });

  it('opens links in a new tab', () => {
    expect(renderMarkdown('[docs](https://example.com)')).toContain('target="_blank" rel="noopener noreferrer" href="https://example.com"');
  });
});
