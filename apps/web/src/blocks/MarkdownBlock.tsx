import { memo, useMemo } from 'react';
import type { BlockData } from '../board/derive';
import { BlockChrome } from './BlockChrome';
import { renderMarkdown } from './markdown';

export function MarkdownBody({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
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
