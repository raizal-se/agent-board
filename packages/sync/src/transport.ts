/**
 * The smallest transport surface the sync layer needs. A local WebSocket implements it in
 * this slice (websocket.ts); the peer-to-peer transport from spike B plugs in later.
 */
export type Unsubscribe = () => void;

export interface Channel {
  /** Send to one peer, a list of peers, or (to omitted) every connected peer. */
  send(data: Uint8Array, to?: string | string[]): void;
  onMessage(handler: (data: Uint8Array, from: string) => void): Unsubscribe;
}

export interface Transport {
  readonly selfId: string;
  /** Peers we have a working direct link to right now. */
  peers(): string[];
  onPeerJoin(handler: (peerId: string) => void): Unsubscribe;
  onPeerLeave(handler: (peerId: string) => void): Unsubscribe;
  /** A named message channel. Names must be short (at most 255 bytes). */
  channel(name: string): Channel;
  leave(): Promise<void>;
}
