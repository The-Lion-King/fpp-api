import jwt from 'jsonwebtoken';

import {Context} from '../context';
import * as FppErrors from '../error';

import validateShop from './shop-validator';

const JWT_PERMITTED_CLOCK_TOLERANCE = 5;

interface JwtPayload {
  iss: string;
  dest: string;
  aud: string;
  sub: string;
  exp: number;
  nbf: number;
  iat: number;
  jti: string;
  sid: string;
}

function decodeSessionToken(token: string): JwtPayload {
  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, Context.API_SECRET_KEY, {
      algorithms: ['HS256'],
      clockTolerance: JWT_PERMITTED_CLOCK_TOLERANCE,
    }) as JwtPayload;
  } catch (error) {
    throw new FppErrors.InvalidJwtError(
      `Failed to parse session token '${token}': ${error.message}`,
    );
  }

  if (payload.aud !== Context.API_KEY) {
    throw new FppErrors.InvalidJwtError(
      'Session token had invalid API key',
    );
  }

  if (!validateShop(payload.dest.replace(/^https:\/\//, ''))) {
    throw new FppErrors.InvalidJwtError('Session token had invalid shop');
  }

  return payload;
}

export default decodeSessionToken;

export {decodeSessionToken, JwtPayload};
