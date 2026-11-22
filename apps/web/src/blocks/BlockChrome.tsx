import { fileName } from '@agent-board/model';
import { Handle, Position } from '@xyflow/react';
import type { CSSProperties, ReactNode } from 'react';
import { useBoardActions } from '../board/actions';
import type { BlockData } from '../board/derive';
import { CommentPin } from './CommentPin';

/**
 * Title bar, agent mark, agreement state, comment pin and the "links to missing file" note, shared
 * by both file block types. A file block is always agent work: it carries the agent mark and the
 * owner's colour. Things people make on the board (notes, decisions) carry no mark.
 */
export function BlockChrome({ data, children }: { data: BlockData; children: ReactNode }) {
  const { open, compare } = useBoardActions();
  const { item, missing, agreement, changed, zone, pin } = data;
  const state = agreement ? 'agreed' : 'draft';
  return (
    <div
      className={`block block-${item.type} zone-${zone}${changed ? ' is-changed' : ''}`}
      data-testid="block"
      data-path={item.path}
      data-id={item.id}
      data-zone={zone}
      data-state={state}
      data-changed={changed ? 'yes' : 'no'}
      style={{ '--agent': data.agentColor } as CSSProperties}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className="block-handle" />
      <div className="block-title" title={item.path}>
        <span className="block-kind">{item.type === 'html' ? 'HTML' : 'MD'}</span>
        <span className="block-name">{fileName(item.path)}</span>
        <CommentPin target={item.id} name={item.path} pin={pin} />
        <button type="button" className="block-open nodrag" onClick={() => open(item)} aria-label={`open ${item.path}`}>
          open
        </button>
      </div>
      <div className="block-meta">
        <span className="agent-mark" data-testid="agent-mark" title={`Written by ${item.owner}'s agent`}>
          <span className="agent-dot" aria-hidden="true" />
          {item.owner}'s agent
        </span>
        <span className="zone-tag">{zone}</span>
        {agreement && (
          <span className="agreed-badge" data-testid="agreed-badge">
            agreed
          </span>
        )}
      </div>
      {changed && (
        <div className="changed-mark nodrag" data-testid="changed-mark">
          <span>changed after agreement</span>
          <button type="button" onClick={(e) => {
              e.stopPropagation();
              compare(item.id);
            }} aria-label={`compare ${item.path} with the agreed snapshot`}>
            Compare
          </button>
        </div>
      )}
      {children}
      {missing.length > 0 && (
        <div className="block-missing" data-testid="missing-links">
          {missing.map((p) => (
            <div key={p}>links to missing file: {p}</div>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} className="block-handle" />
    </div>
  );
}
