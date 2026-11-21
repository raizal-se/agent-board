import type { FileItem } from '@agent-board/model';
import { useEffect, useRef } from 'react';
import { HTML_SANDBOX } from './HtmlBlock';
import { MarkdownBody } from './MarkdownBlock';

/**
 * A block at full size. An HTML page takes clicks here; it is still sandboxed.
 *
 * Closing: the close button always works, and so does Esc while focus is in the board. A click
 * inside the page moves focus into its frame, whose keys the board cannot hear (opaque origin),
 * so when the pointer leaves the page, focus comes back to the dialog and Esc works again.
 */
export function FullView({ item, onClose }: { item: FileItem; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const takeFocusBack = () => dialogRef.current?.focus();

  return (
    <div className="fullview-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="fullview"
        role="dialog"
        aria-modal="true"
        aria-label={item.path}
        data-testid="fullview"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fullview-title">
          <span>{item.path}</span>
          {item.gone && <span className="gone-tag">gone</span>}
          <button type="button" className="fullview-close" onClick={onClose} aria-label="Close" title="Close (Esc)">
            Close <kbd>Esc</kbd>
          </button>
        </div>
        {item.type === 'html' ? (
          <iframe
            className="fullview-frame"
            title={item.path}
            sandbox={HTML_SANDBOX}
            srcDoc={item.text}
            onMouseLeave={takeFocusBack}
          />
        ) : (
          <div className="fullview-body">
            <MarkdownBody text={item.text} />
          </div>
        )}
      </div>
    </div>
  );
}
