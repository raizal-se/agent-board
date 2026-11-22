import type { JoinStep, PeerState } from '@agent-board/sync/peer';

/** Everything a person reads about the shared board: plain words, no ports, relays or keys. */

export function listNames(names: readonly string[], or = false): string {
  const n = [...new Set(names)];
  if (n.length <= 1) return n[0] ?? '';
  return `${n.slice(0, -1).join(', ')} ${or ? 'or' : 'and'} ${n.at(-1)}`;
}

/** What the join screen says while this device asks to join. */
export function joinText(step: JoinStep): string {
  switch (step.step) {
    case 'looking':
      return 'Looking for the people on this board…';
    case 'waiting':
      return `Waiting for ${listNames(step.by, true)} to let you in`;
    case 'denied':
      return `${step.by} did not let you in.`;
    case 'approved':
      return `${step.by} let you in. Getting the board…`;
    case 'in':
      return "You're in";
    case 'rejected':
      return 'This link does not lead to the board it names. Ask the person who sent it for a new link.';
  }
}

/** The other people on the board (not this person), by name. */
export function otherPeople(s: PeerState): string[] {
  return [...new Set(s.members.map((m) => m.name))].filter((n) => n !== s.me.name);
}

/** "Raizal is offline, you're still working on your own copy" when nobody else is online. */
export function offlineText(s: PeerState): string | null {
  if (!s.member || s.online.length > 0) return null;
  const others = otherPeople(s);
  if (others.length === 0) return null;
  const who = others.length > 2 ? 'Everyone else is' : `${listNames(others)} ${others.length === 1 ? 'is' : 'are'}`;
  return `${who} offline, you're still working on your own copy`;
}

/** One line per person we reach only through someone else, even after a new try. */
export function blockedText(name: string): string {
  return `Your network blocks a direct link to ${name}; ask them to try another Wi-Fi or a phone hotspot`;
}

/** "Dewi (product) wants to join". */
export function requestText(r: { name: string; side: string }): string {
  return `${r.name} (${r.side}) wants to join`;
}

/** The line under a name in the online list. */
export function onlineNote(o: { via: string | null; kind: string }): string {
  const what = o.kind === 'cli' ? 'with an agent' : 'in a browser';
  return o.via ? `${what} · synced through ${o.via}` : what;
}
