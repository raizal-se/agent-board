import { fileName, type Side } from '@agent-board/model';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { useBoardActions } from '../board/actions';
import type { BlockData } from '../board/derive';
import { useCardFit } from './cardFit';
import { CommentPin } from './CommentPin';
import { shortTime } from './DecisionCard';

const SIDES: { side: Side; label: string }[] = [
  { side: 'product', label: 'Product' },
  { side: 'engineering', label: 'Engineering' },
];

/** Why a block is in its area, for the switch's tooltip. */
function areaWhy(data: BlockData): string {
  if (data.areaSource === 'human' && data.areaBy) return `Moved here by ${data.areaBy.name} · ${shortTime(data.areaBy.at)}`;
  if (data.areaSource === 'file') return 'Set by the file (area)';
  return `${data.item.owner}'s side`;
}

/**
 * The scrolling body of a card. The card grows with its content up to the cap; past it the
 * content scrolls here, with a fade at the bottom and a button to open the full view.
 */
export function CardBody({
  body,
  content,
  overflow,
  name,
  onOpen,
  children,
}: {
  body: RefObject<HTMLDivElement | null>;
  content: RefObject<HTMLDivElement | null>;
  overflow: boolean;
  name: string;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <div className="card-body-wrap" data-overflow={overflow ? 'yes' : 'no'}>
      <div className="card-body" ref={body}>
        <div className="card-content" ref={content}>
          {children}
        </div>
      </div>
      {overflow && (
        <div className="card-fade" data-testid="card-fade">
          <button
            type="button"
            className="card-fade-open"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            aria-label={`open all of ${name}`}
          >
            open
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The card around a file block: name and type, agent mark and open in the header; the
 * Product/Engineering switch, ✓ Agree, ✗ Reject and the comment pin below it; then its marks
 * (agreed, changes requested, changed after agreement) and the content. A file block is always
 * agent work: it carries the agent mark and the owner's colour.
 */
export function BlockChrome({ data, children }: { data: BlockData; children: ReactNode }) {
  const { open, compare, agree, reject, switchArea } = useBoardActions();
  const { item, missing, agreement, changed, area, pin, mark, review } = data;
  const { card, body, content, overflow } = useCardFit(item.id);
  const state = agreement ? 'agreed' : 'draft';
  const agreedNow = !!agreement && !changed;
  const stop = (fn: () => void) => (e: { stopPropagation(): void }) => {
    // A button on a card does not select the card.
    e.stopPropagation();
    fn();
  };
  return (
    <div
      ref={card}
      className={`block block-${item.type} area-${area}${changed ? ' is-changed' : ''}`}
      data-testid="block"
      data-path={item.path}
      data-id={item.id}
      data-area={area}
      data-area-source={data.areaSource}
      data-state={state}
      data-changed={changed ? 'yes' : 'no'}
      data-mark={mark ?? 'none'}
      style={{ '--agent': data.agentColor } as CSSProperties}
    >
      <div className="block-title" title={item.path}>
        <span className="block-kind">{item.type === 'html' ? 'HTML' : 'MD'}</span>
        <span className="block-name">{fileName(item.path)}</span>
        <span className="agent-mark" data-testid="agent-mark" title={`Written by ${item.owner}'s agent`}>
          <span className="agent-dot" aria-hidden="true" />
          {item.owner}'s agent
        </span>
        <button type="button" className="block-open" onClick={stop(() => open(item))} aria-label={`open ${item.path}`}>
          open
        </button>
      </div>
      <div className="block-actions">
        <div className="area-switch" role="group" aria-label={`area of ${item.path}`} title={areaWhy(data)} data-testid="area-switch">
          {SIDES.map(({ side, label }) => (
            <button
              key={side}
              type="button"
              className={`area-option area-option-${side}`}
              aria-pressed={area === side}
              onClick={stop(() => area !== side && switchArea(item.id, side))}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="card-btn card-agree"
          data-testid="agree"
          aria-pressed={agreedNow}
          disabled={agreedNow}
          onClick={stop(() => agree(item.id))}
          aria-label={agreedNow ? `${item.path} is agreed` : `agree on ${item.path}`}
        >
          {agreedNow ? '✓ Agreed' : '✓ Agree'}
        </button>
        <button type="button" className="card-btn card-reject" data-testid="reject" onClick={stop(() => reject(item.id))} aria-label={`reject ${item.path}`}>
          ✗ Reject
        </button>
        <CommentPin target={item.id} name={item.path} pin={pin} />
      </div>
      {(agreement || mark) && (
        <div className="block-meta">
          {agreement && (
            <span className="agreed-badge" data-testid="agreed-badge" title={`Agreed by ${agreement.accepts.map((a) => a.name).join(', ')}`}>
              agreed
            </span>
          )}
          {mark && (
            <span className={`review-mark review-${mark === 'changes requested' ? 'requested' : 'updated'}`} data-testid="review-mark" title={review?.reason}>
              {mark}
              {review && mark === 'changes requested' ? `: ${review.reason}` : ''}
            </span>
          )}
        </div>
      )}
      {changed && (
        <div className="changed-mark" data-testid="changed-mark">
          <span>changed after agreement</span>
          <button type="button" onClick={stop(() => compare(item.id))} aria-label={`compare ${item.path} with the agreed snapshot`}>
            Compare
          </button>
        </div>
      )}
      <CardBody body={body} content={content} overflow={overflow} name={item.path} onOpen={() => open(item)}>
        {children}
      </CardBody>
      {missing.length > 0 && (
        <div className="block-missing" data-testid="missing-links">
          {missing.map((p) => (
            <div key={p}>links to missing file: {p}</div>
          ))}
        </div>
      )}
    </div>
  );
}
