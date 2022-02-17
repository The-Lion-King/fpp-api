import {Context} from '../context';
import OAuth from '../auth/oauth';

export default async function deleteOfflineSession(
  shop: string,
): Promise<boolean> {
  Context.throwIfUninitialized();

  const sessionId = OAuth.getOfflineSessionId(shop);

  return Context.SESSION_STORAGE.deleteSession(sessionId);
}
