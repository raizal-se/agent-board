import type { FileItem } from '@agent-board/model';
import { useState } from 'react';

/** Blocks of deleted files (design 4.1). Anyone can open one from here. */
export function HiddenList({ items, onOpen }: { items: FileItem[]; onOpen: (item: FileItem) => void }) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  return (
    <div className="hidden-list" data-testid="hidden-list">
      <button type="button" className="hidden-toggle" onClick={() => setExpanded(!expanded)}>
        Hidden blocks ({items.length}) {expanded ? '▾' : '▸'}
      </button>
      {expanded && (
        <ul>
          {items.map((i) => (
            <li key={i.id}>
              <span className="gone-tag">gone</span> <span title={i.path}>{i.path}</span>{' '}
              <button type="button" onClick={() => onOpen(i)}>open</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
