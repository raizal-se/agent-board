import type { NodeProps } from '@xyflow/react';
import { memo, useMemo } from 'react';
import type { BlockNode } from '../board/derive';
import { BlockChrome } from './BlockChrome';
import { renderMarkdown } from './markdown';

export function MarkdownBody({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />;
}

export const MarkdownBlock = memo(function MarkdownBlock({ data }: NodeProps<BlockNode>) {
  return (
    <BlockChrome item={data.item} missing={data.missing}>
      <div className="block-body nowheel">
        <MarkdownBody text={data.item.text} />
      </div>
    </BlockChrome>
  );
});
