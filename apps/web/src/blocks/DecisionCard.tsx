import { memo } from 'react';
import type { DecisionData } from '../board/derive';
import { CommentPin } from './CommentPin';

export function shortTime(at: number): string {
  return new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** A decision: what was agreed, on which blocks, by whom and when. Made by a person on the board. */
export const DecisionCard = memo(function DecisionCard({ data }: { data: DecisionData }) {
  const { decision, covers, pin } = data;
  return (
    <div className="decision" data-testid="decision" data-id={decision.id}>
      <div className="decision-head">
        <span className="decision-label">Decision</span>
        <CommentPin target={decision.id} name="decision" pin={pin} />
      </div>
      <div className="decision-text">{decision.text}</div>
      <div className="decision-covers" title={covers.join('\n')}>
        covers {covers.join(', ')}
      </div>
      <div className="decision-by">
        {decision.accepts.map((a) => `${a.name} (${a.side})`).join(', ')} · {shortTime(decision.createdAt)}
      </div>
    </div>
  );
});
