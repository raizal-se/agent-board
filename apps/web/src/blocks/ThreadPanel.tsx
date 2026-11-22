import { addComment, setThreadResolved, type CommentItem, type ThreadItem } from '@agent-board/model';
import { useEffect, useRef, useState } from 'react';
import { useBoardActions } from '../board/actions';
import { shortTime } from './DecisionNode';

/**
 * The comment thread on one item: read it, add a comment, resolve it. A comment on a resolved
 * thread opens it again. Comments are written by people only.
 */
export function ThreadPanel({
  target,
  name,
  comments,
  thread,
  onClose,
}: {
  target: string;
  name: string;
  comments: CommentItem[];
  thread?: ThreadItem;
  onClose: () => void;
}) {
  const { doc, me } = useBoardActions();
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const resolved = !!thread?.resolved;

  useEffect(() => {
    inputRef.current?.focus();
  }, [target]);
  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }, [comments.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const send = () => {
    if (addComment(doc, { target, by: me, text })) setText('');
  };

  return (
    <aside className="thread" role="dialog" aria-label={`Comments on ${name}`} data-testid="thread" data-target={target} data-resolved={resolved ? 'yes' : 'no'}>
      <div className="thread-head">
        <div className="thread-title">
          <strong>Comments</strong>
          <span className="thread-on" title={name}>
            on {name}
          </span>
        </div>
        <button type="button" className="btn" onClick={onClose} aria-label="Close comments">
          Close
        </button>
      </div>
      {resolved && (
        <div className="thread-resolved">
          Resolved{thread?.by ? ` by ${thread.by}` : ''}
          {thread?.at ? ` · ${shortTime(thread.at)}` : ''}
        </div>
      )}
      <ol className="thread-list" ref={listRef}>
        {comments.length === 0 && <li className="thread-empty">No comments yet.</li>}
        {comments.map((c) => (
          <li key={c.id} className="comment" data-testid="comment">
            <div className="comment-meta">
              <strong>{c.author}</strong> <time dateTime={new Date(c.at).toISOString()}>{shortTime(c.at)}</time>
            </div>
            <div className="comment-text">{c.text}</div>
          </li>
        ))}
      </ol>
      <form
        className="thread-add"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          ref={inputRef}
          rows={3}
          aria-label="New comment"
          placeholder={resolved ? 'A comment opens the thread again' : 'Add a comment (Ctrl+Enter to send)'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="thread-actions">
          {comments.length > 0 && (
            <button type="button" className="btn" onClick={() => setThreadResolved(doc, { target, by: me, resolved: !resolved })}>
              {resolved ? 'Reopen' : 'Resolve'}
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={text.trim() === ''}>
            Comment
          </button>
        </div>
      </form>
    </aside>
  );
}
