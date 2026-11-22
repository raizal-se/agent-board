import { useSyncExternalStore } from 'react';
import { EMPTY_VIEW, type Session, type SessionView } from './session';

const none = () => () => {};
const empty = () => EMPTY_VIEW;

export function useSession(session: Session | undefined): SessionView {
  return useSyncExternalStore(session ? session.onChange : none, session ? session.view : empty);
}
