import type { StorySize } from '@agent-board/model';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';

/** The frame of a dialog: Esc and a press-and-release on the backdrop cancel. */
function Dialog({
  title,
  testId,
  onCancel,
  onSubmit,
  children,
  submit,
  danger,
  aside,
}: {
  title: string;
  testId: string;
  onCancel: () => void;
  onSubmit: () => void;
  children: ReactNode;
  submit: string;
  /** The submit button deletes something. It gets the focus: Esc cancels, Enter confirms. */
  danger?: boolean;
  /** A button at the left of the actions (a delete). */
  aside?: ReactNode;
}) {
  const pressedOutside = useRef(false);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => (pressedOutside.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressedOutside.current) onCancel();
      }}
    >
      <form
        className="dialog dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        onKeyDown={onKey}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <h2 className="dialog-title">{title}</h2>
        <div className="dialog-scroll">{children}</div>
        <div className="dialog-actions">
          {aside && <div className="dialog-aside">{aside}</div>}
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className={`btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`} data-testid="dialog-save" autoFocus={danger}>
            {submit}
          </button>
        </div>
      </form>
    </div>
  );
}

function useFocusFirst() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return ref;
}

export interface StoryFields {
  title: string;
  story: string;
  check: string;
  size: StorySize | null;
  owner: string;
  blockedBy: string[];
}

export interface Choice {
  id: string;
  label: string;
  /** A second line, quieter. */
  note?: string;
}

/** Checkboxes, each a 36 px row. */
function Checks({ choices, picked, onChange, empty, name }: { choices: Choice[]; picked: string[]; onChange: (ids: string[]) => void; empty: string; name: string }) {
  if (choices.length === 0) return <div className="dialog-empty">{empty}</div>;
  return (
    <div className="choice-list" role="group" aria-label={name}>
      {choices.map((c) => (
        <label key={c.id} className="choice" data-testid="choice">
          <input
            type="checkbox"
            checked={picked.includes(c.id)}
            onChange={(e) => onChange(e.target.checked ? [...picked, c.id] : picked.filter((p) => p !== c.id))}
          />
          <span className="choice-text">
            <span>{c.label}</span>
            {c.note && <span className="choice-note">{c.note}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

const SIZES: (StorySize | null)[] = ['S', 'M', 'L', null];

/**
 * Edit every field of a story: title, story, check, size, owner and blocked by. A change to the
 * title, story, check or size resets its accepts; the dialog says so.
 */
export function StoryDialog({
  title,
  initial,
  blockers,
  hasAccepts,
  onSubmit,
  onCancel,
  onDelete,
}: {
  title: string;
  initial: StoryFields;
  /** Stories it may be blocked by (same milestone, no loop). */
  blockers: Choice[];
  hasAccepts: boolean;
  onSubmit: (f: StoryFields) => void;
  onCancel: () => void;
  /** "Delete story": the page asks first. */
  onDelete?: () => void;
}) {
  const [f, setF] = useState<StoryFields>(initial);
  const first = useFocusFirst();
  const set = <K extends keyof StoryFields>(k: K, v: StoryFields[K]) => setF((o) => ({ ...o, [k]: v }));
  const resets = hasAccepts && (f.title.trim() !== initial.title || f.story.trim() !== initial.story || f.check.trim() !== initial.check || f.size !== initial.size);
  return (
    <Dialog
      title={title}
      testId="story-dialog"
      submit="Save"
      onCancel={onCancel}
      onSubmit={() => onSubmit(f)}
      aside={
        onDelete && (
          <button type="button" className="btn btn-danger" data-testid="story-delete" onClick={onDelete}>
            Delete story
          </button>
        )
      }
    >
      <label className="dialog-field">
        <span>Short title</span>
        <input ref={first} name="title" value={f.title} onChange={(e) => set('title', e.target.value)} />
      </label>
      <label className="dialog-field">
        <span>Story: "As a …, I want …, so that …"</span>
        <textarea name="story" rows={3} value={f.story} onChange={(e) => set('story', e.target.value)} />
      </label>
      <label className="dialog-field">
        <span>Check: "We know it works when …"</span>
        <textarea name="check" rows={2} value={f.check} onChange={(e) => set('check', e.target.value)} />
      </label>
      <div className="dialog-field">
        <span>Size</span>
        <div className="size-pick" role="radiogroup" aria-label="size">
          {SIZES.map((s) => (
            <button key={s ?? 'none'} type="button" role="radio" aria-checked={f.size === s} className="btn size-option" data-testid={`size-${s ?? 'none'}`} onClick={() => set('size', s)}>
              {s ?? 'not set'}
            </button>
          ))}
        </div>
        {f.size === 'L' && <span className="dialog-warn">An L story is too big to accept: split it.</span>}
      </div>
      <label className="dialog-field">
        <span>Owner</span>
        <input name="owner" value={f.owner} onChange={(e) => set('owner', e.target.value)} />
      </label>
      <div className="dialog-field">
        <span>Blocked by</span>
        <Checks name="blocked by" choices={blockers} picked={f.blockedBy} onChange={(ids) => set('blockedBy', ids)} empty="No other story in this milestone can block it." />
      </div>
      {resets && <div className="dialog-warn" data-testid="resets-accepts">Saving this resets the accepts: people agree again.</div>}
    </Dialog>
  );
}

/** Number, name and goal of a milestone. */
export function MilestoneDialog({
  initial,
  onSubmit,
  onCancel,
  onDelete,
}: {
  initial: { number: number; name: string; goal: string };
  onSubmit: (f: { number: number; name: string; goal: string }) => void;
  onCancel: () => void;
  /** "Delete milestone": the page asks first. */
  onDelete?: () => void;
}) {
  const [number, setNumber] = useState(String(initial.number));
  const [name, setName] = useState(initial.name);
  const [goal, setGoal] = useState(initial.goal);
  const first = useFocusFirst();
  const n = Number(number);
  const ok = Number.isInteger(n) && n >= 1;
  return (
    <Dialog
      title="Milestone"
      testId="milestone-dialog"
      submit="Save"
      onCancel={onCancel}
      onSubmit={() => ok && onSubmit({ number: n, name, goal })}
      aside={
        onDelete && (
          <button type="button" className="btn btn-danger" data-testid="milestone-delete" onClick={onDelete}>
            Delete milestone
          </button>
        )
      }
    >
      <label className="dialog-field">
        <span>Name</span>
        <input ref={first} name="name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="dialog-field">
        <span>Number</span>
        <input name="number" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} />
      </label>
      {!ok && <span className="dialog-warn">The number is a whole number from 1.</span>}
      <label className="dialog-field">
        <span>Goal</span>
        <textarea name="goal" rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} />
      </label>
    </Dialog>
  );
}

/** Pick some of a list: the cards a story covers. */
export function PickDialog({
  title,
  label,
  choices,
  initial,
  empty,
  onSubmit,
  onCancel,
}: {
  title: string;
  label: string;
  choices: Choice[];
  initial: string[];
  empty: string;
  onSubmit: (ids: string[]) => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState(initial);
  return (
    <Dialog title={title} testId="pick-dialog" submit="Save" onCancel={onCancel} onSubmit={() => onSubmit(picked)}>
      <div className="dialog-field">
        <span>{label}</span>
        <Checks name={label} choices={choices} picked={picked} onChange={setPicked} empty={empty} />
      </div>
    </Dialog>
  );
}

/** Pick one of a list: the story a card goes to. A tap on a row picks it. */
export function ChooseDialog({ title, label, choices, empty, onPick, onCancel }: { title: string; label: string; choices: Choice[]; empty: string; onPick: (id: string) => void; onCancel: () => void }) {
  return (
    <Dialog title={title} testId="choose-dialog" submit="Close" onCancel={onCancel} onSubmit={onCancel}>
      <div className="dialog-field">
        <span>{label}</span>
        {choices.length === 0 ? (
          <div className="dialog-empty">{empty}</div>
        ) : (
          <div className="choice-list">
            {choices.map((c) => (
              <button key={c.id} type="button" className="choice choice-button" data-testid="choice" onClick={() => onPick(c.id)}>
                <span className="choice-text">
                  <span>{c.label}</span>
                  {c.note && <span className="choice-note">{c.note}</span>}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** "Are you sure?" before a delete: the question, Cancel, and a red Delete button. */
export function ConfirmDialog({ title, text, confirm, onConfirm, onCancel }: { title: string; text: string; confirm: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Dialog title={title} testId="confirm-dialog" submit={confirm} danger onCancel={onCancel} onSubmit={onConfirm}>
      <div className="dialog-text" data-testid="confirm-text">
        {text}
      </div>
    </Dialog>
  );
}
