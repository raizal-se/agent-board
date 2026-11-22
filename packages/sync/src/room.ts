import { joinRoom } from 'trystero';
import { trysteroTransport, type TrysteroTransport } from './trystero-transport';

export const APP_ID = 'agent-board';

export interface JoinOptions {
  /** The room secret from the invite link (after the #). Used as the Trystero password. */
  secret: string;
  /** Nostr relay URLs. Default: Trystero's built-in public list. */
  relayUrls?: string[];
  /** ICE servers. Default: Trystero's public STUN (Google + Cloudflare). No TURN. */
  iceServers?: RTCIceServer[];
  /** Node: an RTCPeerConnection implementation (e.g. node-datachannel/polyfill). */
  rtcPolyfill?: typeof RTCPeerConnection;
  appId?: string;
}

/**
 * Join the board room over Trystero (Nostr strategy). The room id is a hash of the secret,
 * so relays never see the secret; the secret itself is the Trystero password, which
 * encrypts the WebRTC handshake (PBKDF2 -> AES-GCM inside Trystero).
 */
export async function joinBoardRoom(opts: JoinOptions): Promise<TrysteroTransport> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(opts.secret)));
  const roomId = 'b-' + Array.from(digest.subarray(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
  const room = joinRoom(
    {
      appId: opts.appId ?? APP_ID,
      password: opts.secret,
      ...(opts.relayUrls ? { relayConfig: { urls: opts.relayUrls, redundancy: opts.relayUrls.length } } : {}),
      ...(opts.iceServers ? { rtcConfig: { iceServers: opts.iceServers } } : {}),
      ...(opts.rtcPolyfill ? { rtcPolyfill: opts.rtcPolyfill } : {}),
    },
    roomId,
  );
  return trysteroTransport(room);
}
