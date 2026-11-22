import { deleteSticky, setStickyText } from '@agent-board/model';
import type { NodeProps } from '@xyflow/react';
import { memo, useEffect, useRef, useState } from 'react';
import { useBoardActions } from '../board/actions';
import type { StickyNode as StickyNodeType } from '../board/derive';
import { CommentPin } from './CommentPin';

/**
 * A sticky note. People write it on the board; agents only read it (in the JSON export). The text
 * edits in place; the author line is where you grab it to drag.
 */
export const StickyNode = memo(function StickyNode({ data }: NodeProps<StickyNodeType>) {
  const { doc } = useBoardActions();
  const { sticky, pin } = data;
  const [text, setText] = useState(sticky.text);
  const editing = useRef(false);

  // Text from the doc (another tab, a reload) shows unless this tab is typing in the note.
  useEffect(() => {
    if (!editing.current) setText(sticky.text);
  }, [sticky.text]);

  return (
    <div className="sticky" data-testid="sticky" data-id={sticky.id} data-author={sticky.author}>
      <div className="sticky-head">
        <span className="sticky-author" title="Drag here to move the note">
          {sticky.author}
        </span>
        <CommentPin target={sticky.id} name={`note by ${sticky.author}`} pin={pin} />
        <button type="button" className="sticky-delete nodrag" aria-label="delete note" title="Delete note" onClick={() => deleteSticky(doc, sticky.id)}>
          ×
        </button>
      </div>
      <textarea
        className="sticky-text nodrag nowheel nopan"
        aria-label="note text"
        placeholder="Write a note…"
        value={text}
        onFocus={() => (editing.current = true)}
        onBlur={() => {
          editing.current = false;
          setText(sticky.text);
        }}
        onChange={(e) => {
          setText(e.target.value);
          setStickyText(doc, sticky.id, e.target.value);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      />
    </div>
  );
});
