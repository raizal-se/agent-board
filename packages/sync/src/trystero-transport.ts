import type { Room } from 'trystero';
import type { Channel, Transport, Unsubscribe } from './transport';

export interface TrysteroTransport extends Transport {
  readonly room: Room;
  /**
   * Test hook: treat a peer as unreachable. Messages to and from it are dropped and it is
   * left out of peers(). The WebRTC link itself stays open (see docs/spike/b-sync.md).
   */
  block(peerId: string): void;
}

/** Wrap a joined Trystero room. Await room.ready first if you need relays connected. */
export async function trysteroTransport(room: Room): Promise<TrysteroTransport> {
  const self = await room.getSelf();
  const blocked = new Set<string>();
  const peers = () =>
    Object.entries(room.getPeers())
      .filter(([id, info]) => info.direct && !blocked.has(id))
      .map(([id]) => id);

  const actions = new Map<string, Channel>();
  return {
    room,
    selfId: self.peerId,
    peers,
    block: (id) => void blocked.add(id),
    binding(peerId) {
      const pc = room.getPeers()[peerId]?.connection as RTCPeerConnection | undefined;
      return sdpBinding(pc?.localDescription?.sdp, pc?.remoteDescription?.sdp);
    },
    onPeerJoin(h) {
      return room.onPeerJoin(({ peerId }) => {
        if (!blocked.has(peerId)) h(peerId);
      });
    },
    onPeerLeave(h) {
      return room.onPeerLeave(({ peerId }) => h(peerId));
    },
    channel(name) {
      const existing = actions.get(name);
      if (existing) return existing;
      const action = room.makeAction<Uint8Array>(name);
      const ch: Channel = {
        send(data, to) {
          const targets = (to === undefined ? peers() : typeof to === 'string' ? [to] : to).filter(
            (p) => !blocked.has(p),
          );
          if (targets.length === 0) return;
          action.send(data, { target: targets }).catch(() => {
            /* peer left mid-send; sync recovers on rejoin */
          });
        },
        onMessage(h): Unsubscribe {
          return action.onMessage((data, { peerId }) => {
            if (blocked.has(peerId)) return;
            h(toBytes(data), peerId);
          });
        },
      };
      actions.set(name, ch);
      return ch;
    },
    leave: () => room.leave(),
  };
}

/** The sorted `a=fingerprint` lines of both descriptions, lower case. */
export function sdpBinding(local: string | undefined, remote: string | undefined): string {
  const prints = (sdp: string | undefined) =>
    [...(sdp ?? '').matchAll(/^a=fingerprint:(\S+) (\S+)\s*$/gim)].map((m) => `${m[1]!.toLowerCase()} ${m[2]!.toLowerCase()}`);
  const all = [...new Set([...prints(local), ...prints(remote)])].sort();
  return all.join('|');
}

function toBytes(d: unknown): Uint8Array {
  if (d instanceof Uint8Array) return d;
  if (d instanceof ArrayBuffer) return new Uint8Array(d);
  if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
  throw new Error('unexpected payload type');
}

/** Describe the WebRTC link to a peer from getStats(): host, srflx/prflx (direct through NAT) or relay (TURN). */
export async function linkType(
  pc: RTCPeerConnection | null | undefined,
): Promise<{ kind: 'direct' | 'relay' | 'unknown'; local?: string; remote?: string; rttMs?: number }> {
  if (!pc) return { kind: 'unknown' };
  const stats = await pc.getStats();
  let pair: any;
  stats.forEach((s: any) => {
    if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId);
  });
  if (!pair)
    stats.forEach((s: any) => {
      if (s.type === 'candidate-pair' && s.state === 'succeeded' && (s.nominated || s.selected)) pair ??= s;
    });
  if (!pair) return { kind: 'unknown' };
  const local = stats.get(pair.localCandidateId)?.candidateType as string | undefined;
  const remote = stats.get(pair.remoteCandidateId)?.candidateType as string | undefined;
  const kind = local === 'relay' || remote === 'relay' ? 'relay' : local && remote ? 'direct' : 'unknown';
  // Spec unit is seconds (browsers). node-datachannel's polyfill passes milliseconds through,
  // so in Node this reads 1000x too high.
  const rttMs = typeof pair.currentRoundTripTime === 'number' ? Math.round(pair.currentRoundTripTime * 1000) : undefined;
  return { kind, local, remote, rttMs };
}
