import { fileName } from '@agent-board/model';
import { memo } from 'react';
import { useBoardActions } from '../board/actions';
import type { SnapshotData } from '../board/derive';
import { CardBody } from './BlockChrome';
import { useCardFit } from './cardFit';
import { shortTime } from './DecisionCard';
import { HtmlThumb } from './HtmlBlock';
import { MarkdownBody } from './MarkdownBlock';

/**
 * The frozen copy of an agreed block, in the Agreed area: what was agreed, by whom and when. Its
 * content never changes (agreeing again replaces it). It can be moved, not edited. When the file
 * changes after the agreement it says so, like the live card, and opens the comparison.
 */
export const SnapshotCard = memo(function SnapshotCard({ data }: { data: SnapshotData }) {
  const { compare } = useBoardActions();
  const { id, item, agreement, changed } = data;
  const { card, body, content, overflow } = useCardFit(id);
  const snap = agreement.snapshot;
  const by = agreement.accepts.map((a) => a.name).join(', ');
  const toCompare = (e: { stopPropagation(): void }) => {
    e.stopPropagation();
    compare(item.id);
  };
  return (
    <div
      ref={card}
      className="block snapshot"
      data-testid="snapshot-card"
      data-id={id}
      data-item={item.id}
      data-path={item.path}
      data-changed={changed ? 'yes' : 'no'}
    >
      <div className="block-title" title={`snapshot of ${item.path}`}>
        <span className="block-kind">{snap.type === 'html' ? 'HTML' : 'MD'}</span>
        <span className="block-name">snapshot of {fileName(item.path)}</span>
        <button type="button" className="block-open" onClick={toCompare} aria-label={`compare ${item.path} with this snapshot`}>
          compare
        </button>
      </div>
      <div className="block-meta snapshot-meta">
        <span className="agreed-badge">agreed</span>
        <span data-testid="snapshot-by">
          by {by} · {shortTime(snap.at)}
        </span>
      </div>
      {changed && (
        <div className="changed-mark" data-testid="changed-mark">
          <span>changed after agreement</span>
          <button type="button" onClick={toCompare} aria-label={`compare ${item.path} with the agreed snapshot`}>
            Compare
          </button>
        </div>
      )}
      <CardBody body={body} content={content} overflow={overflow} name={`the snapshot of ${item.path}`} onOpen={() => compare(item.id)}>
        {snap.type === 'html' ? (
          <HtmlThumb text={snap.text} title={`snapshot of ${item.path}`} />
        ) : (
          <div className="block-text">
            <MarkdownBody text={snap.text} />
          </div>
        )}
      </CardBody>
    </div>
  );
});
