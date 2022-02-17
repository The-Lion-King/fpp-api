import {Context} from './context';
import * as FppErrors from './error';
import FppAuth from './auth/oauth';
import FppSession from './auth/session';
import FppClients from './clients';
import FppUtils from './utils';
import FppWebhooks from './webhooks';

export const Fpp = {
  Context,
  Auth: FppAuth,
  Session: FppSession,
  Clients: FppClients,
  Utils: FppUtils,
  Webhooks: FppWebhooks,
  Errors: FppErrors,
};

export default Fpp;
export * from './types';
