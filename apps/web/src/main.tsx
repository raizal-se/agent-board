import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '@excalidraw/excalidraw/index.css';
import './styles.css';
import { App } from './App';
import { connectBoard } from './board/connection';
import { lastInvite } from './peer/browserPeer';
import { NoBoard } from './peer/JoinScreen';
import { PeerRoot } from './peer/PeerRoot';

const root = createRoot(document.getElementById('root')!);
const render = (node: ReactNode) => root.render(<StrictMode>{node}</StrictMode>);

/** Does a CLI serve this page (`agent-board watch`)? A static host answers with the page instead. */
async function servedByCli(): Promise<boolean> {
  try {
    const r = await fetch('/.cli', { cache: 'no-store' });
    return r.ok && ((await r.json()) as { cli?: unknown }).cli === true;
  } catch {
    return false;
  }
}

async function boot() {
  // An invite link (`<app URL>/#<board>.<secret>.<root>`): this browser is a peer of that board.
  const hash = location.hash.slice(1);
  let link = hash ? location.href : null;
  let appUrl = location.href.replace(/#.*$/, '');
  if (!link && (await servedByCli())) {
    render(<App conn={connectBoard()} />);
    return;
  }
  if (!link) {
    const last = lastInvite();
    if (last) ({ invite: link, appUrl } = last);
  }
  const { parseInvite } = await import('@agent-board/sync/peer');
  const invite = link ? parseInvite(link) : null;
  if (!invite) {
    render(<NoBoard />);
    return;
  }
  render(
    <PeerRoot invite={invite} appUrl={appUrl}>
      {(conn) => <App conn={conn} />}
    </PeerRoot>,
  );
}

void boot();
