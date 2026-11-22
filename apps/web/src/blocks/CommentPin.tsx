import { useBoardActions } from '../board/actions';
import type { Pin } from '../board/derive';

/** The comment pin on an item: shows the count, opens the thread. A tap target of 32 px. */
export function CommentPin({ target, name, pin }: { target: string; name: string; pin: Pin }) {
  const { openThread } = useBoardActions();
  const state = pin.count === 0 ? 'empty' : pin.resolved ? 'resolved' : 'open';
  return (
    <button
      type="button"
      className={`comment-pin nodrag pin-${state}`}
      data-testid="comment-pin"
      data-count={pin.count}
      aria-label={`comments on ${name}: ${pin.count}${pin.resolved ? ', resolved' : ''}`}
      title={pin.count === 0 ? 'Comment' : `${pin.count} comment${pin.count === 1 ? '' : 's'}${pin.resolved ? ', resolved' : ''}`}
      onClick={(e) => {
        // Opening the thread does not select the item.
        e.stopPropagation();
        openThread(target);
      }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6a1.5 1.5 0 0 1-1.5 1.5H7l-3 3v-3h-.5A1.5 1.5 0 0 1 2 9.5z" fill="currentColor" />
      </svg>
      <span className="comment-count">{pin.count === 0 ? '+' : pin.count}</span>
    </button>
  );
}
