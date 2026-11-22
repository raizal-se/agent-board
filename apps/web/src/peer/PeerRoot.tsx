import type { Invite } from '@agent-board/sync/peer';
import { useEffect, useState, type ReactNode } from 'react';
import { connectPeer, knownMember, savedMe, type Me, type PeerConnection } from './browserPeer';
import { JoinForm, JoinWait } from './JoinScreen';
import { useSession } from './useSession';

/** Nostr relays for tests and private setups (`localStorage['agent-board:relays']`, comma separated). */
function relayUrls(): string[] | undefined {
  const v = localStorage.getItem('agent-board:relays')?.split(',').map((s) => s.trim()).filter(Boolean);
  return v?.length ? v : undefined;
}

type Phase = { at: 'loading' } | { at: 'form'; initial?: Me } | { at: 'on'; conn: PeerConnection };

/**
 * A browser that opened an invite: the join form, then the wait, then the board. A device that is
 * already on the board's list goes to the board with no prompt.
 */
export function PeerRoot({ invite, appUrl, children }: { invite: Invite; appUrl: string; children: (conn: PeerConnection) => ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ at: 'loading' });

  const start = (me: Me) => {
    setPhase({ at: 'loading' });
    void connectPeer({ invite, appUrl, me, relayUrls: relayUrls() }).then((conn) => setPhase({ at: 'on', conn }));
  };

  useEffect(() => {
    let live = true;
    void Promise.all([savedMe(invite.boardId), knownMember(invite.boardId)]).then(([me, member]) => {
      if (!live) return;
      if (me && member) start(me);
      else setPhase({ at: 'form', initial: me });
    });
    return () => {
      live = false;
    };
  }, [invite.boardId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase.at === 'loading') return <JoinWait step={{ step: 'looking' }} />;
  if (phase.at === 'form') return <JoinForm initial={phase.initial} onJoin={start} />;
  return (
    <Joined
      conn={phase.conn}
      onBack={() => {
        const me = phase.conn.session.view().me ?? undefined;
        void phase.conn.stop();
        setPhase({ at: 'form', initial: me });
      }}
    >
      {children}
    </Joined>
  );
}

function Joined({ conn, onBack, children }: { conn: PeerConnection; onBack: () => void; children: (conn: PeerConnection) => ReactNode }) {
  const view = useSession(conn.session);
  const peer = view.peer;
  if (!peer || !peer.member || peer.join.step === 'rejected') {
    return <JoinWait step={peer?.join ?? { step: 'looking' }} fingerprint={peer?.me.fingerprint} onRetry={onBack} />;
  }
  return <>{children(conn)}</>;
}
