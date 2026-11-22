import { createContext, memo, useContext } from 'react';
import { DecisionCard } from '../blocks/DecisionCard';
import { HtmlBlock } from '../blocks/HtmlBlock';
import { MarkdownBlock } from '../blocks/MarkdownBlock';
import type { Views } from '../board/derive';

/** What the board shows now. Embedded blocks read their data here by id, so new content needs no new element. */
export const ViewsContext = createContext<Views | null>(null);

/**
 * The content of a block on the canvas. Excalidraw calls `renderEmbeddable` on every render of its
 * own; this stays cheap: it looks the block up and the block views are memoized on their data.
 */
export const BlockEmbed = memo(function BlockEmbed({ id }: { id: string }) {
  const v = useContext(ViewsContext);
  const block = v?.blocks.get(id);
  if (block) return block.item.type === 'html' ? <HtmlBlock data={block} /> : <MarkdownBlock data={block} />;
  const decision = v?.decisions.get(id);
  if (decision) return <DecisionCard data={decision} />;
  return null;
});
