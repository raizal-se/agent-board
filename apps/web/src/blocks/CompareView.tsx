import { agreeItem, changedAfterAgreement, keepSnapshot, lineDiff, type Agreement, type FileItem } from '@agent-board/model';
import { useEffect, useMemo } from 'react';
import { useBoardActions } from '../board/actions';
import { shortTime } from './DecisionCard';

/**
 * The agreed snapshot and the file as it is now, side by side. An edited line shows as one changed
 * line. "Keep snapshot" clears the mark until the file changes again; "Agree again" takes a new
 * snapshot of the file as it is now.
 */
export function CompareView({ item, agreement, onClose }: { item: FileItem; agreement: Agreement; onClose: () => void }) {
  const { doc, me } = useBoardActions();
  const rows = useMemo(() => lineDiff(agreement.snapshot.text, item.text), [agreement.snapshot.text, item.text]);
  const changed = changedAfterAgreement(item, agreement);
  const differs = rows.some((r) => r.kind !== 'same');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fullview-backdrop" onClick={onClose}>
      <div className="fullview compare" role="dialog" aria-modal="true" aria-label={`Compare ${item.path}`} data-testid="compare" onClick={(e) => e.stopPropagation()}>
        <div className="fullview-title">
          <span>Compare {item.path}</span>
          {changed && <span className="changed-tag">changed after agreement</span>}
          <button type="button" className="fullview-close" onClick={onClose} aria-label="Close" title="Close (Esc)">
            Close <kbd>Esc</kbd>
          </button>
        </div>
        <div className="compare-cols compare-heads">
          <div>Agreed snapshot · {shortTime(agreement.snapshot.at)}</div>
          <div>Now · {shortTime(item.updatedAt)}</div>
        </div>
        <div className="compare-body" data-testid="compare-rows">
          {!differs && <div className="compare-same">The file is the same as the agreed snapshot.</div>}
          {rows.map((r, i) => (
            <div key={i} className={`compare-cols diff-row diff-${r.kind}`} data-testid="diff-row" data-kind={r.kind}>
              <div className="diff-cell diff-left">
                {'leftNo' in r && <span className="diff-no">{r.leftNo}</span>}
                <code>{'left' in r ? r.left : ''}</code>
              </div>
              <div className="diff-cell diff-right">
                {'rightNo' in r && <span className="diff-no">{r.rightNo}</span>}
                <code>{'right' in r ? r.right : ''}</code>
              </div>
            </div>
          ))}
        </div>
        <div className="compare-actions">
          <span className="compare-hint">Keep snapshot: the agreement stays as it was. Agree again: the file as it is now becomes the agreement.</span>
          <button
            type="button"
            className="btn"
            disabled={!changed}
            onClick={() => {
              keepSnapshot(doc, item.id);
              onClose();
            }}
          >
            Keep snapshot
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              agreeItem(doc, item.id, { by: me });
              onClose();
            }}
          >
            Agree again
          </button>
        </div>
      </div>
    </div>
  );
}
