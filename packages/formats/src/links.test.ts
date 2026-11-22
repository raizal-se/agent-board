import { describe, expect, it } from 'vitest';
import { fileTypeOf, parseFileLinks, parseHtmlLinks, parseMarkdownLinks, stripFrontMatter, parseFileArea } from './links';

describe('parseMarkdownLinks', () => {
  it('reads links from front matter (design 4.3 example)', () => {
    const text = `---\nlinks:\n  - to: checkout/api.md\n    label: calls\n---\n# Flow\n`;
    expect(parseMarkdownLinks(text)).toEqual([{ to: 'checkout/api.md', label: 'calls' }]);
  });

  it('reads several links, label optional', () => {
    const text = `---\ntitle: x\nlinks:\n  - to: a.md\n  - { to: b.html, label: shows }\n---\nbody`;
    expect(parseMarkdownLinks(text)).toEqual([
      { to: 'a.md', label: '' },
      { to: 'b.html', label: 'shows' },
    ]);
  });

  it('handles CRLF line endings', () => {
    const text = `---\r\nlinks:\r\n  - to: a.md\r\n    label: x\r\n---\r\nbody`;
    expect(parseMarkdownLinks(text)).toEqual([{ to: 'a.md', label: 'x' }]);
  });

  it('returns nothing without front matter, or with links not at the top', () => {
    expect(parseMarkdownLinks('# no front matter')).toEqual([]);
    expect(parseMarkdownLinks('intro\n---\nlinks:\n  - to: a.md\n---\n')).toEqual([]);
  });

  it('ignores an empty or missing links list', () => {
    expect(parseMarkdownLinks('---\ntitle: x\n---\n')).toEqual([]);
    expect(parseMarkdownLinks('---\nlinks:\n---\n')).toEqual([]);
    expect(parseMarkdownLinks('---\n---\n')).toEqual([]);
  });

  it('skips bad entries and does not throw on broken YAML', () => {
    const text = `---\nlinks:\n  - to: ok.md\n  - label: no target\n  - 42\n  - to: ''\n---\n`;
    expect(parseMarkdownLinks(text)).toEqual([{ to: 'ok.md', label: '' }]);
    expect(parseMarkdownLinks('---\nlinks: [to: : :\n---\n')).toEqual([]);
    expect(parseMarkdownLinks('---\nlinks: not-a-list\n---\n')).toEqual([]);
  });

  it('normalizes the path and drops duplicates', () => {
    const text = `---\nlinks:\n  - to: ./checkout/api.md\n    label: calls\n  - to: checkout/api.md\n    label: calls\n---\n`;
    expect(parseMarkdownLinks(text)).toEqual([{ to: 'checkout/api.md', label: 'calls' }]);
  });
});

describe('parseHtmlLinks', () => {
  it('reads a board:link meta tag (design 4.3 example)', () => {
    const html = `<head><meta name="board:link" content="checkout/db-schema.md | reads status"></head>`;
    expect(parseHtmlLinks(html)).toEqual([{ to: 'checkout/db-schema.md', label: 'reads status' }]);
  });

  it('reads several tags, any attribute order, quotes and self-closing', () => {
    const html = [
      `<meta content='a.md | one' name='board:link'/>`,
      `<META NAME="board:link" CONTENT="b.md">`,
      `<meta name="description" content="not a link | x">`,
      `<meta name="board:link" content="c.md | has | pipes">`,
    ].join('\n');
    expect(parseHtmlLinks(html)).toEqual([
      { to: 'a.md', label: 'one' },
      { to: 'b.md', label: '' },
      { to: 'c.md', label: 'has | pipes' },
    ]);
  });

  it('decodes basic entities and skips an empty target', () => {
    const html = `<meta name="board:link" content="a.md | reads &amp; writes"><meta name="board:link" content=" | x">`;
    expect(parseHtmlLinks(html)).toEqual([{ to: 'a.md', label: 'reads & writes' }]);
  });

  it('ignores tags inside comments', () => {
    expect(parseHtmlLinks(`<!-- <meta name="board:link" content="a.md"> -->`)).toEqual([]);
  });
});

describe('parseFileLinks', () => {
  it('picks the parser by extension', () => {
    expect(parseFileLinks('x.md', '---\nlinks:\n  - to: a.md\n---\n')).toEqual([{ to: 'a.md', label: '' }]);
    expect(parseFileLinks('x.HTML', '<meta name="board:link" content="a.md">')).toEqual([{ to: 'a.md', label: '' }]);
    expect(parseFileLinks('x.txt', '<meta name="board:link" content="a.md">')).toEqual([]);
  });
});

describe('stripFrontMatter', () => {
  it('drops the front matter and keeps the body', () => {
    expect(stripFrontMatter('---\nlinks: []\n---\n# Body\n')).toBe('# Body\n');
  });
  it('leaves text without front matter alone', () => {
    expect(stripFrontMatter('# Body\n---\nx')).toBe('# Body\n---\nx');
  });
});

describe('fileTypeOf', () => {
  it('maps extensions to block types', () => {
    expect(fileTypeOf('a/b.md')).toBe('markdown');
    expect(fileTypeOf('b.MARKDOWN')).toBe('markdown');
    expect(fileTypeOf('c.html')).toBe('html');
    expect(fileTypeOf('c.htm')).toBe('html');
    expect(fileTypeOf('d.txt')).toBeNull();
    expect(fileTypeOf('md')).toBeNull();
  });
});

describe('parseFileArea', () => {
  it('reads area from markdown front matter', () => {
    expect(parseFileArea('a.md', '---\narea: engineering\n---\n# A\n')).toBe('engineering');
    expect(parseFileArea('a.md', '---\narea: Product \n---\n')).toBe('product');
  });

  it('reads area from an HTML meta tag', () => {
    expect(parseFileArea('a.html', '<head><meta name="board:area" content="engineering"></head>')).toBe('engineering');
    expect(parseFileArea('a.htm', "<meta content='product' name='Board:Area'>")).toBe('product');
    expect(parseFileArea('a.html', '<!-- <meta name="board:area" content="product"> -->')).toBeNull();
  });

  it('is null when the file says nothing or something else', () => {
    expect(parseFileArea('a.md', '# no front matter\n')).toBeNull();
    expect(parseFileArea('a.md', '---\narea: design\n---\n')).toBeNull();
    expect(parseFileArea('a.md', '---\narea: [\n---\n')).toBeNull();
    expect(parseFileArea('a.html', '<p>area: product</p>')).toBeNull();
    expect(parseFileArea('a.txt', '---\narea: product\n---\n')).toBeNull();
  });
});
