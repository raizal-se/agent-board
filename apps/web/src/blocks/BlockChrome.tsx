import { fileName, type FileItem } from '@agent-board/model';
import { Handle, Position } from '@xyflow/react';
import type { ReactNode } from 'react';
import { useBoardActions } from '../board/actions';

/** Title bar, link handles and the "links to missing file" note, shared by both block types. */
export function BlockChrome({ item, missing, children }: { item: FileItem; missing: string[]; children: ReactNode }) {
  const { open } = useBoardActions();
  return (
    <div className={`block block-${item.type}`} data-testid="block" data-path={item.path} data-id={item.id}>
      <Handle type="target" position={Position.Left} isConnectable={false} className="block-handle" />
      <div className="block-title" title={item.path}>
        <span className="block-kind">{item.type === 'html' ? 'HTML' : 'MD'}</span>
        <span className="block-name">{fileName(item.path)}</span>
        <button type="button" className="block-open nodrag" onClick={() => open(item)} aria-label={`open ${item.path}`}>
          open
        </button>
      </div>
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
