import type { PeerState } from '@agent-board/sync/peer';
import { describe, expect, it } from 'vitest';
import { blockedText, joinText, listNames, offlineText, onlineNote, requestText } from './words';

const member = (name: string, side: 'product' | 'engineering' = 'product') => ({ pk: name, name, side, kind: 'browser' as const, by: null, at: 0, sig: '', fingerprint: 'ab12' });

function state(p: Partial<PeerState>): PeerState {
  return {
    me: { name: 'Dewi', side: 'product', kind: 'browser', pk: 'Dewi', fingerprint: 'ab12' },
    member: true,
    join: { step: 'in' },
    online: [],
    members: [member('Dewi'), member('Raizal', 'engineering')],
    requests: [],
    closed: [],
    blocked: [],
    linked: false,
    ...p,
  };
}

describe('plain words', () => {
  it('names one, two or more people', () => {
    expect(listNames(['Raizal'])).toBe('Raizal');
    expect(listNames(['Raizal', 'Tan'], true)).toBe('Raizal or Tan');
    expect(listNames(['A', 'B', 'C'])).toBe('A, B and C');
  });

  it('says who the guest waits for, and what happened', () => {
    expect(joinText({ step: 'waiting', by: ['Raizal'] })).toBe('Waiting for Raizal to let you in');
    expect(joinText({ step: 'in' })).toBe("You're in");
    expect(joinText({ step: 'denied', by: 'Raizal' })).toBe('Raizal did not let you in.');
  });

  it('says the others are offline only when nobody is online', () => {
    expect(offlineText(state({}))).toBe("Raizal is offline, you're still working on your own copy");
    expect(offlineText(state({ online: [{ id: 'x', pk: 'Raizal', name: 'Raizal', side: 'engineering', kind: 'cli', via: null, cursor: null }] }))).toBeNull();
    expect(offlineText(state({ members: [member('Dewi')] }))).toBeNull();
    expect(offlineText(state({ member: false }))).toBeNull();
    expect(offlineText(state({ members: [member('Dewi'), member('Raizal'), member('Tan')] }))).toBe("Raizal and Tan are offline, you're still working on your own copy");
  });

  it('has no ports, relays or keys in what a person reads', () => {
    const lines = [blockedText('Dewi'), requestText({ name: 'Dewi', side: 'product' }), onlineNote({ via: 'Tan', kind: 'browser' })];
    expect(lines).toEqual([
      'Your network blocks a direct link to Dewi; ask them to try another Wi-Fi or a phone hotspot',
      'Dewi (product) wants to join',
      'in a browser · synced through Tan',
    ]);
    for (const l of lines) expect(l).not.toMatch(/port|relay|key|nostr|webrtc/i);
  });
});
