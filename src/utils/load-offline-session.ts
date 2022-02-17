import {Session} from '../auth/session/session';
import {Context} from '../context';
import OAuth from '../auth/oauth';

export default async function loadOfflineSession(
  shop: string,
  includeExpired = false,
): Promise<Session | undefined> {
  Context.throwIfUninitialized();

  const sessionId = OAuth.getOfflineSessionId(shop);
  const session = await Context.SESSION_STORAGE.loadSession(sessionId);

  const now = new Date();

  if (
    session &&
    !includeExpired &&
    session.expires &&
    session.expires.getTime() < now.getTime()
  ) {
    return undefined;
  }

  return session;
}
