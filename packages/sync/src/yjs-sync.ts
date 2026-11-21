import * as Y from 'yjs';
import type { Transport, Unsubscribe } from './transport';

const MSG_STATE_VECTOR = 0; // "here is what I have, send me the rest"
const MSG_UPDATE = 1; // a Yjs update (reply to a state vector, a live change, or a forward)

/** Transaction origin for updates that came from a peer. */
export class RemoteOrigin {
  constructor(readonly peerId: string) {}
}

export interface SyncStats {
  /** Update messages received from peers. */
  received: number;
  /** Received updates that changed the doc (Yjs emitted 'update'). */
  applied: number;
  /** Received updates that changed nothing (already known: loops, duplicates). */
  duplicates: number;
  /** Messages sent on behalf of another peer (forwarding). */
  forwarded: number;
  /** Messages sent for local changes and handshake replies. */
  sent: number;
}

export interface YjsSyncOptions {
  /** Forward updates from one peer to every other peer. Default true. */
  forward?: boolean;
  /** Channel name. Default 'y'. */
  channelName?: string;
}

/**
 * Syncs one Y.Doc over a Transport.
 *
 * - On peer join: exchange state vectors, reply with the missing diff.
 * - Local change: send to every connected peer.
 * - Forwarding: when an update from peer P changes the doc, send that change to every
 *   connected peer except P. Yjs emits 'update' only for content it did not have, so a
 *   duplicate that comes back around a loop changes nothing and is not forwarded again.
 *   That is what makes loops terminate.
 */
export class YjsSync {
  readonly stats: SyncStats = { received: 0, applied: 0, duplicates: 0, forwarded: 0, sent: 0 };
  private readonly forward: boolean;
  private readonly offs: Unsubscribe[] = [];
  private readonly channel;
  private readonly updateListeners = new Set<(update: Uint8Array, from: string) => void>();

  constructor(
    readonly doc: Y.Doc,
    readonly transport: Transport,
    opts: YjsSyncOptions = {},
  ) {
    this.forward = opts.forward ?? true;
    this.channel = transport.channel(opts.channelName ?? 'y');

    const onDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin instanceof RemoteOrigin) {
        this.stats.applied++;
        for (const l of this.updateListeners) l(update, origin.peerId);
        if (!this.forward) return;
        const targets = transport.peers().filter((p) => p !== origin.peerId);
        if (targets.length === 0) return;
        this.stats.forwarded += targets.length;
        this.channel.send(frame(MSG_UPDATE, update), targets);
      } else {
        const targets = transport.peers();
        if (targets.length === 0) return;
        this.stats.sent += targets.length;
        this.channel.send(frame(MSG_UPDATE, update), targets);
      }
    };
    doc.on('update', onDocUpdate);
    this.offs.push(() => doc.off('update', onDocUpdate));

    this.offs.push(transport.onPeerJoin((peerId) => this.sendStateVector(peerId)));
    for (const p of transport.peers()) this.sendStateVector(p);

    this.offs.push(
      this.channel.onMessage((data, from) => {
        const type = data[0];
        const body = data.subarray(1);
        if (type === MSG_STATE_VECTOR) {
          this.stats.sent++;
          this.channel.send(frame(MSG_UPDATE, Y.encodeStateAsUpdate(doc, body)), from);
        } else if (type === MSG_UPDATE) {
          this.stats.received++;
          const before = this.stats.applied;
          Y.applyUpdate(doc, body, new RemoteOrigin(from));
          if (this.stats.applied === before) this.stats.duplicates++;
        }
      }),
    );
  }

  /** Called for each remote update that changed the doc, with the peer it arrived from. */
  onRemoteUpdate(handler: (update: Uint8Array, from: string) => void): Unsubscribe {
    this.updateListeners.add(handler);
    return () => this.updateListeners.delete(handler);
  }

  private sendStateVector(peerId: string) {
    this.channel.send(frame(MSG_STATE_VECTOR, Y.encodeStateVector(this.doc)), peerId);
  }

  destroy() {
    for (const off of this.offs.splice(0)) off();
  }
}

function frame(type: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 1);
  out[0] = type;
  out.set(body, 1);
  return out;
}
