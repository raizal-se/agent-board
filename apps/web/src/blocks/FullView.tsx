import type { FileItem } from '@agent-board/model';
import { useEffect } from 'react';
import { HTML_SANDBOX } from './HtmlBlock';
import { MarkdownBody } from './MarkdownBlock';

/** A block at full size. An HTML page takes clicks here; it is still sandboxed. */
export function FullView({ item, onClose }: { item: FileItem; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fullview-backdrop" onClick={onClose}>
      <div className="fullview" role="dialog" aria-label={item.path} data-testid="fullview" onClick={(e) => e.stopPropagation()}>
        <div className="fullview-title">
          <span>{item.path}</span>
          {item.gone && <span className="gone-tag">gone</span>}
          <button type="button" onClick={onClose}>close</button>
        </div>
        {item.type === 'html' ? (
          <iframe className="fullview-frame" title={item.path} sandbox={HTML_SANDBOX} srcDoc={item.text} />
        ) : (
          <div className="fullview-body">
            <MarkdownBody text={item.text} />
          </div>
        )}
      </div>
    </div>
  );
}
