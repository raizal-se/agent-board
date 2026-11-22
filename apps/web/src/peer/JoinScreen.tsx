import type { Side } from '@agent-board/model';
import type { JoinStep } from '@agent-board/sync/peer';
import { useState } from 'react';
import type { Me } from './browserPeer';
import { joinText } from './words';

/** A guest's first screen: a name and a side, then one button. */
export function JoinForm({ initial, onJoin }: { initial?: Me; onJoin: (me: Me) => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [side, setSide] = useState<Side>(initial?.side ?? 'product');
  const ok = name.trim().length > 0;
  return (
    <div className="join-screen" data-testid="join-screen">
      <form
        className="join-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onJoin({ name: name.trim(), side });
        }}
      >
        <h2>Join this board</h2>
        <label>
          Your name
          <input data-testid="join-name" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} placeholder="for example Dewi" />
        </label>
        <fieldset className="join-sides">
          <legend>Your side</legend>
          {(['product', 'engineering'] as const).map((s) => (
            <label key={s} className={`join-side${side === s ? ' is-picked' : ''}`}>
              <input type="radio" name="side" value={s} checked={side === s} onChange={() => setSide(s)} />
              {s === 'product' ? 'Product' : 'Engineering'}
            </label>
          ))}
        </fieldset>
        <button type="submit" className="btn btn-primary" data-testid="join-submit" disabled={!ok}>
          Ask to join
        </button>
        <p className="hint">A person on the board lets you in. Then your browser keeps a copy of the board.</p>
      </form>
    </div>
  );
}

/** While the guest waits: plain words only. */
export function JoinWait({ step, fingerprint, onRetry }: { step: JoinStep; fingerprint?: string; onRetry?: () => void }) {
  const done = step.step === 'denied' || step.step === 'rejected';
  return (
    <div className="join-screen" data-testid="join-screen">
      <div className="join-card">
        {!done && <div className="spinner" aria-hidden="true" />}
        <p className="join-status" data-testid="join-status" data-step={step.step}>
          {joinText(step)}
        </p>
        {fingerprint && step.step === 'waiting' && (
          <p className="hint">
            Your code: <span className="fingerprint">{fingerprint}</span>
          </p>
        )}
        {done && onRetry && (
          <button type="button" className="btn" onClick={onRetry}>
            Back
          </button>
        )}
      </div>
    </div>
  );
}

/** The app URL alone, in a browser that never joined a board. */
export function NoBoard() {
  return (
    <div className="join-screen" data-testid="no-board">
      <div className="join-card">
        <h2>agent-board</h2>
        <p>Open the invite link you got from a person on the board.</p>
      </div>
    </div>
  );
}
