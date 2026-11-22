import { memo, useEffect, useMemo, useState } from 'react';
import type { BlockData } from '../board/derive';
import { BlockChrome } from './BlockChrome';
import { hasMermaid, loadMermaid, mermaidReady, renderMarkdown } from './markdown';

export function MarkdownBody({ text }: { text: string }) {
  // A mermaid fence needs Pele, loaded on first need; the body renders again once it is here.
  const [ready, setReady] = useState(mermaidReady);
  const waiting = !ready && hasMermaid(text);
  useEffect(() => {
    if (waiting) void loadMermaid().then(() => setReady(true));
  }, [waiting]);
  const html = useMemo(() => renderMarkdown(text), [text, ready]);
  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />;
}

export const MarkdownBlock = memo(function MarkdownBlock({ data }: { data: BlockData }) {
  return (
    <BlockChrome data={data}>
      <div className="block-text">
        <MarkdownBody text={data.item.text} />
      </div>
    </BlockChrome>
  );
});
