import http from 'http';

import {Context} from '../context';
import {FppOAuth} from '../auth/oauth/oauth';
import {Session} from '../auth/session';
export default async function loadCurrentSession(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  isOnline = true,
): Promise<Session | undefined> {
  Context.throwIfUninitialized();

  const sessionId = FppOAuth.getCurrentSessionId(
    request,
    response,
    isOnline,
  );
  if (!sessionId) {
    return Promise.resolve(undefined);
  }

  return Context.SESSION_STORAGE.loadSession(sessionId);
}
