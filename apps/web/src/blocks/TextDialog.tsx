import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

/**
 * Asks for one piece of text: a link label, a decision. Enter (Ctrl/Cmd+Enter in a long text)
 * saves, Esc cancels.
 */
export function TextDialog({
  title,
  label,
  initial = '',
  submit,
  multiline = false,
  required = false,
  onSubmit,
  onCancel,
}: {
  title: string;
  label: string;
  initial?: string;
  submit: string;
  multiline?: boolean;
  required?: boolean;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const empty = required && text.trim() === '';

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const done = () => {
    if (!empty) onSubmit(text.trim());
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      done();
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="text-dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          done();
        }}
      >
        <h2 className="dialog-title">{title}</h2>
        <label className="dialog-field">
          <span>{label}</span>
          {multiline ? (
            <textarea ref={ref} rows={4} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
          ) : (
            <input ref={ref} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
          )}
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={empty}>
            {submit}
          </button>
        </div>
      </form>
    </div>
  );
}
