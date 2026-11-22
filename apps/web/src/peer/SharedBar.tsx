import { agentPrompt } from '@agent-board/model';
import type { PeerState } from '@agent-board/sync/peer';
import { useEffect, useRef, useState } from 'react';
import type { Session, SessionView } from './session';
import { blockedText, offlineText, onlineNote, requestText } from './words';

/** Copy text: the clipboard API where the page may use it, else a selected text field. */
export async function copyText(text: string, field?: HTMLTextAreaElement | HTMLInputElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (!field) return false;
    field.select();
    return document.execCommand('copy');
  }
}

function CopyButton({ text, field, label = 'Copy' }: { text: string; field?: () => HTMLTextAreaElement | HTMLInputElement | null; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      data-testid="copy"
      onClick={() => void copyText(text, field?.()).then((ok) => ok && (setDone(true), setTimeout(() => setDone(false), 2000)))}
    >
      {done ? 'Copied' : label}
    </button>
  );
}

/** The requests to join, on every member's page: one click to let a person in. */
function Requests({ peer, session }: { peer: PeerState; session: Session }) {
  if (!peer.member || peer.requests.length === 0) return null;
  return (
    <div className="join-requests">
      {peer.requests.map((r) => (
        <div key={r.pk} className="join-request" data-testid="join-request" data-name={r.name}>
          <div>
            <strong>{requestText(r)}</strong>
            {r.nameTaken && <div className="hint">Someone on this board already has this name.</div>}
            {r.handledBy && <div className="hint" data-testid="handled-by">{r.handledBy} is handling this</div>}
            <div className="fingerprint" title="Ask them which code their screen shows, if you want to be sure">
              {r.fingerprint}
            </div>
          </div>
          <div className="join-request-actions">
            <button type="button" className="btn btn-primary" onClick={() => session.approve(r.pk)}>
              Approve
            </button>
            <button type="button" className="btn" onClick={() => session.deny(r.pk)}>
              Deny
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function PeoplePanel({ view, session, onClose }: { view: SessionView; session: Session; onClose: () => void }) {
  const peer = view.peer!;
  const online = new Set(peer.online.map((o) => o.pk));
  const members = peer.members;
  return (
    <div className="side-panel" data-testid="people-panel" role="dialog" aria-label="People">
      <div className="side-panel-head">
        <strong>People</strong>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
      <h4>Online now</h4>
      <ul className="people-list" data-testid="online-list">
        <li data-testid="online-person" data-name={peer.me.name}>
          <span className={`side-dot side-${peer.me.side}`} /> {peer.me.name} <span className="hint">(you)</span>
        </li>
        {peer.online.map((o) => (
          <li key={o.id} data-testid="online-person" data-name={o.name}>
            <span className={`side-dot side-${o.side}`} /> {o.name} <span className="hint">{onlineNote(o)}</span>
          </li>
        ))}
      </ul>
      {peer.member && (
        <>
          <h4>Devices on this board</h4>
          <ul className="people-list" data-testid="device-list">
            {members.map((m) => (
              <li key={m.pk} data-testid="device" data-name={m.name}>
                <span className={`side-dot side-${m.side}`} /> {m.name} <span className="hint">{m.kind === 'cli' ? 'agent' : 'browser'}</span>
                {m.pk === peer.me.pk && <span className="hint"> · this device</span>}
                {online.has(m.pk) && <span className="hint"> · online</span>}
                {m.by !== null && m.pk !== peer.me.pk && (
                  <button type="button" className="btn btn-small" onClick={() => session.revoke(m.pk)} aria-label={`remove ${m.name}'s device`}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {view.link ? (
        <>
          <h4>Invite</h4>
          <InviteLink link={view.link} />
        </>
      ) : (
        view.mode === 'hub' &&
        !view.shared && (
          <p className="hint">
            To share this board, run <code>agent-board invite &lt;folder&gt; --app-url &lt;address of the web app&gt;</code>.
          </p>
        )
      )}
    </div>
  );
}

function InviteLink({ link }: { link: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="invite">
      <div className="copy-row">
        <input ref={ref} readOnly value={link} data-testid="invite-link" onFocus={(e) => e.currentTarget.select()} />
        <CopyButton text={link} field={() => ref.current} />
      </div>
      <p className="hint">Anyone with this link can ask to join. Only a person on the board can let them in.</p>
    </div>
  );
}

/** "Connect your agent": a ready prompt to paste into an AI agent. */
export function ConnectAgentDialog({ view, onClose }: { view: SessionView; onClose: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const me = view.me ?? { name: 'me', side: 'product' as const };
  const prompt = agentPrompt({ name: me.name, side: me.side, boardName: view.boardName || 'agent-board', invite: view.link });
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal connect-agent" data-testid="connect-agent" role="dialog" aria-label="Connect your agent" onClick={(e) => e.stopPropagation()}>
        <h3>Connect your agent</h3>
        <p>Paste this into your AI agent (for example Claude Code). It tells the agent how to join this board and where to write.</p>
        <textarea ref={ref} readOnly value={prompt} data-testid="agent-prompt" rows={12} />
        {view.link ? (
          <p className="warning" data-testid="prompt-warning">
            Anyone with this prompt can ask to join. Send it only to your own agent.
          </p>
        ) : (
          <p className="hint">The prompt has no invite link: ask a person on the board for it.</p>
        )}
        <div className="modal-actions">
          <CopyButton text={prompt} field={() => ref.current} label="Copy prompt" />
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** A short note that goes away by itself ("You're in"). */
export function useToast(): [string | null, (t: string) => void] {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [
    text,
    (t) => {
      setText(t);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setText(null), 4000);
    },
  ];
}

/** The header buttons of a shared board (People, Connect your agent), its banners and the join requests. */
export function SharedBar({ view, session }: { view: SessionView; session: Session }) {
  const [people, setPeople] = useState(false);
  const [agent, setAgent] = useState(false);
  const peer = view.peer;

  const offline = peer ? offlineText(peer) : null;
  return (
    <>
      {peer && (
        <button type="button" className="btn" data-testid="people-button" onClick={() => setPeople((p) => !p)} title="Who is on this board">
          People · {peer.online.length + 1} online
        </button>
      )}
      <button type="button" className="btn" data-testid="connect-agent-button" onClick={() => setAgent(true)}>
        Connect your agent
      </button>
      <div className="shared-notes">
        {offline && (
          <div className="banner" data-testid="offline-banner">
            {offline}
          </div>
        )}
        {peer?.blocked.map((n) => (
          <div key={n} className="banner banner-warn" data-testid="blocked-banner">
            {blockedText(n)}
          </div>
        ))}
        {peer && <Requests peer={peer} session={session} />}
      </div>
      {people && peer && <PeoplePanel view={view} session={session} onClose={() => setPeople(false)} />}
      {agent && <ConnectAgentDialog view={view} onClose={() => setAgent(false)} />}
    </>
  );
}
