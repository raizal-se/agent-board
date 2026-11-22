/**
 * One sync peer in its own Node process (Trystero allows one join per room per process).
 * Driven over stdin/stdout with JSON lines. Used by trystero-node.test.ts.
 *   args: <relayUrl> <secret> <name> [blockName]
 * stdout events: {ev:'ready',id} {ev:'presence',names,direct,blocked} {ev:'update',from,text}
 * stdin commands: {cmd:'insert',text} {cmd:'state'} {cmd:'quit'}
 */
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import * as Y from 'yjs';
import { joinBoardRoom } from '../room';
import { YjsSync, RemoteOrigin } from '../yjs-sync';
import { Presence } from '../awareness';
import { trysteroCompatibleRtc } from '../node-rtc';

// node-datachannel is a dependency of apps/cli, not of this package; borrow it for the test.
const req = createRequire(new URL('../../../../apps/cli/package.json', import.meta.url));
const { RTCPeerConnection } = (await import(req.resolve('node-datachannel/polyfill'))) as {
  RTCPeerConnection: typeof globalThis.RTCPeerConnection;
};

const [relayUrl, secret, name, blockName] = process.argv.slice(2) as [string, string, string, string?];
const out = (o: object) => process.stdout.write(JSON.stringify(o) + '\n');

const transport = await joinBoardRoom({ secret, relayUrls: [relayUrl], iceServers: [], rtcPolyfill: process.env.NO_SHIM ? RTCPeerConnection : trysteroCompatibleRtc(RTCPeerConnection) });
transport.room.onError((e) => process.stderr.write(`room error ${e.code}: ${e.message}\n`));
if (process.env.PEER_TTL_MS) setTimeout(() => process.exit(0), Number(process.env.PEER_TTL_MS)).unref();
const doc = new Y.Doc();
const sync = new YjsSync(doc, transport);
const presence = new Presence(transport, { name }, { heartbeatMs: 1000 });
const text = doc.getText('t');
const blocked = new Set<string>();
const nameOf = (id: string) => (presence.entries.get(id)?.state?.name as string | undefined) ?? id;

const report = () => {
  if (blockName)
    for (const e of presence.others())
      if (e.state?.name === blockName && !blocked.has(e.id)) {
        blocked.add(e.id);
        transport.block(e.id);
      }
  out({
    ev: 'presence',
    names: presence.others().map((e) => e.state?.name).sort(),
    direct: transport.peers().map(nameOf).sort(),
    blocked: [...blocked].map(nameOf),
  });
};
presence.onChange(report);
transport.onPeerJoin(report);
transport.onPeerLeave(report);
doc.on('update', (_u: Uint8Array, origin: unknown) => {
  if (origin instanceof RemoteOrigin) out({ ev: 'update', from: nameOf(origin.peerId), text: text.toString() });
});
out({ ev: 'ready', id: transport.selfId });

createInterface({ input: process.stdin }).on('line', async (line) => {
  const c = JSON.parse(line) as { cmd: string; text?: string };
  if (c.cmd === 'insert') text.insert(text.length, c.text ?? '');
  else if (c.cmd === 'state') out({ ev: 'state', text: text.toString(), stats: sync.stats });
  else if (c.cmd === 'quit') {
    presence.destroy();
    await transport.leave();
    process.exit(0);
  }
});
