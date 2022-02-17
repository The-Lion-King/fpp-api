import crypto from 'crypto';
import querystring from 'querystring';

import {AuthQuery} from '../auth/oauth/types';
import * as FppErrors from '../error';
import {Context} from '../context';

import safeCompare from './safe-compare';

export function stringifyQuery(query: AuthQuery): string {
  const orderedObj = Object.keys(query)
    .sort((val1, val2) => val1.localeCompare(val2))
    .reduce((obj: {[key: string]: string | undefined;}, key: keyof AuthQuery) => {
      obj[key] = query[key];
      return obj;
    }, {});
  return querystring.stringify(orderedObj);
}

export function generateLocalHmac({
  code,
  timestamp,
  state,
  shop,
  host,
}: AuthQuery): string {
  const queryString = stringifyQuery({
    code,
    timestamp,
    state,
    shop,
    ...host && {host},
  });
  return crypto
    .createHmac('sha256', Context.API_SECRET_KEY)
    .update(queryString)
    .digest('hex');
}

export default function validateHmac(query: AuthQuery): boolean {
  if (!query.hmac) {
    throw new FppErrors.InvalidHmacError(
      'Query does not contain an HMAC value.',
    );
  }
  const {hmac} = query;
  const localHmac = generateLocalHmac(query);

  return safeCompare(hmac as string, localHmac);
}