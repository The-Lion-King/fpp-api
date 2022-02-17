import {Context} from '../context';
import {Session} from '../auth/session';

export default async function storeSession(session: Session): Promise<boolean> {
  Context.throwIfUninitialized();

  return Context.SESSION_STORAGE.storeSession(session);
}
