import http from 'http';
import querystring from 'querystring';

import {v4 as uuidv4} from 'uuid';
import Cookies from 'cookies';

import {Context} from '../../context';
import nonce from '../../utils/nonce';
// import validateHmac from '../../utils/hmac-validator';
import validateShop from '../../utils/shop-validator';
// import safeCompare from '../../utils/safe-compare';
import decodeSessionToken from '../../utils/decode-session-token';
import {Session} from '../session';
import {HttpClient} from '../../clients/http_client/http_client';
import {DataType} from '../../clients/http_client/types';
import * as FppErrors from '../../error';
import {SessionInterface} from '../session/types';

import {
  AuthQuery,
  AccessTokenResponse,
  OnlineAccessResponse,
  OnlineAccessInfo,
} from './types';

const FppOAuth = {
  SESSION_COOKIE_NAME: 'fpp_app_session',
  async beginAuth(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    shop: string,
    redirectPath: string,
    isOnline = true,
  ): Promise<string> {
    Context.throwIfUninitialized();
    Context.throwIfPrivateApp('Cannot perform OAuth for private apps');

    const cookies = new Cookies(request, response, {
      keys: [Context.API_SECRET_KEY],
      secure: true,
    });

    const state = nonce();

    const session = new Session(
      isOnline ? uuidv4() : this.getOfflineSessionId(shop),
      shop,
      state,
      isOnline,
    );

    const sessionStored = await Context.SESSION_STORAGE.storeSession(session);

    if (!sessionStored) {
      throw new FppErrors.SessionStorageError(
        'OAuth Session could not be saved. Please check your session storage functionality.',
      );
    }

    cookies.set(FppOAuth.SESSION_COOKIE_NAME, session.id, {
      signed: true,
      expires: new Date(Date.now() + 60000),
      sameSite: 'lax',
      secure: true,
    });

    /* eslint-disable @typescript-eslint/naming-convention */
    const query = {
      client_id: Context.API_KEY,
      scope: Context.SCOPES.toString(),
      redirect_uri: `https://${Context.HOST_NAME}${redirectPath}`,
      // state,
      // 'grant_options[]': isOnline ? 'per-user' : '',
      response_type: 'code'
    };
    /* eslint-enable @typescript-eslint/naming-convention */

    const queryString = querystring.stringify(query);

    return `https://${shop}/admin/oauth/authorize?${queryString}`;
  },

  async validateAuthCallback(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    query: AuthQuery,
  ): Promise<SessionInterface> {
    Context.throwIfUninitialized();
    Context.throwIfPrivateApp('Cannot perform OAuth for private apps');

    const cookies = new Cookies(request, response, {
      keys: [Context.API_SECRET_KEY],
      secure: true,
    });

    const sessionCookie = this.getCookieSessionId(request, response);
    if (!sessionCookie) {
      throw new FppErrors.CookieNotFound(
        `Cannot complete OAuth process. Could not find an OAuth cookie for shop url: ${query.shop}`,
      );
    }

    let currentSession = await Context.SESSION_STORAGE.loadSession(
      sessionCookie,
    );
    if (!currentSession) {
      throw new FppErrors.SessionNotFound(
        `Cannot complete OAuth process. No session found for the specified shop url: ${query.shop}`,
      );
    }

    if (!validQuery(query)) {
      throw new FppErrors.InvalidOAuthError('Invalid OAuth callback.');
    }

    /* eslint-disable @typescript-eslint/naming-convention */
    const body = {
      client_id: Context.API_KEY,
      client_secret: Context.API_SECRET_KEY,
      code: query.code,
    };
    /* eslint-enable @typescript-eslint/naming-convention */

    const postParams = {
      path: '/admin/oauth/access_token',
      type: DataType.JSON,
      data: body,
    };

    const client = new HttpClient(currentSession.shop);
    const postResponse = await client.post(postParams);

    if (currentSession.isOnline) {
      const responseBody = postResponse.body as OnlineAccessResponse;
      const {access_token, scope, ...rest} = responseBody; // eslint-disable-line @typescript-eslint/naming-convention
      const sessionExpiration = new Date(
        Date.now() + responseBody.expires_in * 1000,
      );
      currentSession.accessToken = access_token;
      currentSession.expires = sessionExpiration;
      currentSession.scope = scope;
      currentSession.onlineAccessInfo = rest;

      if (Context.IS_EMBEDDED_APP) {
        const onlineInfo = currentSession.onlineAccessInfo as OnlineAccessInfo;
        const jwtSessionId = this.getJwtSessionId(
          currentSession.shop,
          `${onlineInfo.associated_user.id}`,
        );
        const jwtSession = Session.cloneSession(currentSession, jwtSessionId);

        const sessionDeleted = await Context.SESSION_STORAGE.deleteSession(currentSession.id);
        if (!sessionDeleted) {
          throw new FppErrors.SessionStorageError(
            'OAuth Session could not be deleted. Please check your session storage functionality.',
          );
        }
        currentSession = jwtSession;
      }
    } else {
      const responseBody = postResponse.body as AccessTokenResponse;
      currentSession.accessToken = responseBody.access_token;
      currentSession.scope = responseBody.scope;
    }

    cookies.set(FppOAuth.SESSION_COOKIE_NAME, currentSession.id, {
      signed: true,
      expires: Context.IS_EMBEDDED_APP ? new Date() : currentSession.expires,
      sameSite: 'lax',
      secure: true,
    });

    const sessionStored = await Context.SESSION_STORAGE.storeSession(currentSession);
    if (!sessionStored) {
      throw new FppErrors.SessionStorageError(
        'OAuth Session could not be saved. Please check your session storage functionality.',
      );
    }

    return currentSession;
  },
  getCookieSessionId(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): string | undefined {
    const cookies = new Cookies(request, response, {
      secure: true,
      keys: [Context.API_SECRET_KEY],
    });
    return cookies.get(this.SESSION_COOKIE_NAME, {signed: true});
  },

  getJwtSessionId(shop: string, userId: string): string {
    return `${shop}_${userId}`;
  },

  getOfflineSessionId(shop: string): string {
    return `offline_${shop}`;
  },
  getCurrentSessionId(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    isOnline = true,
  ): string | undefined {
    let currentSessionId: string | undefined;

    if (Context.IS_EMBEDDED_APP) {
      const authHeader = request.headers.authorization;
      if (authHeader) {
        const matches = authHeader.match(/^Bearer (.+)$/);
        if (!matches) {
          throw new FppErrors.MissingJwtTokenError(
            'Missing Bearer token in authorization header',
          );
        }

        const jwtPayload = decodeSessionToken(matches[1]);
        const shop = jwtPayload.dest.replace(/^https:\/\//, '');
        if (isOnline) {
          currentSessionId = this.getJwtSessionId(shop, jwtPayload.sub);
        } else {
          currentSessionId = this.getOfflineSessionId(shop);
        }
      }
    }

    if (!currentSessionId) {
      currentSessionId = this.getCookieSessionId(request, response);
    }

    return currentSessionId;
  },
};

function validQuery(query: AuthQuery): boolean {
  // return (
  //   validateHmac(query) &&
  //   validateShop(query.shop) &&
  //   safeCompare(query.state, session.state as string)
  // );
  return validateShop(query.shop)
}

export {FppOAuth};
