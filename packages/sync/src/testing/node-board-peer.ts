/**
 * One BoardPeer in its own Node process, over real Trystero and WebRTC. Used by
 * trystero-node.test.ts. JSON lines on stdin and stdout.
 *   args: <relayUrl> <secret> <host|guest> <name> <side> [root]
 * stdout: {ev:'ready',pk,root} {ev:'state',join,requests,online,text,bindings}
 * stdin: {cmd:'approve'} (the first request) {cmd:'insert',text} {cmd:'quit'}
 */
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import * as Y from 'yjs';
import { devicePk, newDeviceKey } from '../device';
import { makeRoot } from '../members';
import { trysteroCompatibleRtc } from '../node-rtc';
import { BoardPeer } from '../peer';
import { joinBoardRoom } from '../room';

const req = createRequire(new URL('../../../../apps/cli/package.json', import.meta.url));
const { RTCPeerConnection } = (await import(req.resolve('node-datachannel/polyfill'))) as {
  RTCPeerConnection: typeof globalThis.RTCPeerConnection;
};

const [relayUrl, secret, role, name, side, rootArg] = process.argv.slice(2) as [string, string, 'host' | 'guest', string, 'product' | 'engineering', string?];
const out = (o: object) => process.stdout.write(JSON.stringify(o) + '\n');
const doc = new Y.Doc();
const device = newDeviceKey();
const me = { name, side, kind: 'cli' as const };
if (role === 'host') {
  doc.getMap('meta').set('id', 'board-node-1');
  makeRoot(doc, device, me);
}
const root = rootArg ?? devicePk(device);
const peer = new BoardPeer({
  doc,
  device,
  me,
  root,
  connect: () => joinBoardRoom({ secret, relayUrls: [relayUrl], iceServers: [], rtcPolyfill: trysteroCompatibleRtc(RTCPeerConnection) }),
  presenceHeartbeatMs: 1000,
});
await peer.start();
out({ ev: 'ready', pk: devicePk(device), root });

const report = () => {
  const s = peer.state();
  const gate = peer.gate;
  out({
    ev: 'state',
    join: s.join.step,
    requests: s.requests.map((r) => r.name),
    online: s.online.map((o) => o.name),
    text: doc.getText('t').toString(),
    bindings: gate ? gate.provenPeers().map((p) => gate.binding(p.id)) : [],
  });
};
peer.onChange(report);
doc.on('update', report);

createInterface({ input: process.stdin }).on('line', async (line) => {
  const c = JSON.parse(line) as { cmd: string; text?: string };
  if (c.cmd === 'approve') {
    const r = peer.state().requests[0];
    if (r) peer.approve(r.pk);
  } else if (c.cmd === 'insert') doc.getText('t').insert(doc.getText('t').length, c.text ?? '');
  else if (c.cmd === 'quit') {
    await peer.stop();
    process.exit(0);
  }
});
