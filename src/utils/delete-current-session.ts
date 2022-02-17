import http from 'http';

import {Context} from '../context';
import {FppOAuth} from '../auth/oauth/oauth';
import * as FppErrors from '../error';

export default async function deleteCurrentSession(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  isOnline = true,
): Promise<boolean | never> {
  Context.throwIfUninitialized();

  const sessionId = FppOAuth.getCurrentSessionId(
    request,
    response,
    isOnline,
  );
  if (!sessionId) {
    throw new FppErrors.SessionNotFound('No active session found.');
  }

  return Context.SESSION_STORAGE.deleteSession(sessionId);
}
