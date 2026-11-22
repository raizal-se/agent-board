/**
 * Shim so Trystero 0.27 works with the node-datachannel RTCPeerConnection polyfill.
 *
 * libdatachannel auto-negotiates: createDataChannel() makes the local offer at once. Trystero's
 * initiator then sees `localDescription` already set and `signalingState !== 'stable'`, so it
 * never runs its own createOffer(), and getOffer() waits forever. No peer ever connects.
 * The polyfill's setLocalDescription() with no argument is also a no-op.
 *
 * The shim reports 'stable' and no local description until Trystero first calls
 * setLocalDescription / setRemoteDescription. After that it passes the real values through.
 */
export function trysteroCompatibleRtc<T extends typeof RTCPeerConnection>(Base: T): T {
  class Shim extends (Base as typeof RTCPeerConnection) {
    #touched = false;
    override get localDescription() {
      return this.#touched ? super.localDescription : null;
    }
    override get signalingState() {
      return this.#touched ? super.signalingState : 'stable';
    }
    override setLocalDescription(d?: RTCLocalSessionDescriptionInit) {
      this.#touched = true;
      return super.setLocalDescription(d);
    }
    override setRemoteDescription(d: RTCSessionDescriptionInit) {
      this.#touched = true;
      return super.setRemoteDescription(d);
    }
  }
  return Shim as unknown as T;
}
