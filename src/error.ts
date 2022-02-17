class FppError extends Error {
  constructor(...args: any) {
    super(...args);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class InvalidHmacError extends FppError {}
class InvalidShopError extends FppError {}
class InvalidJwtError extends FppError {}
class MissingJwtTokenError extends FppError {}

class SafeCompareError extends FppError {}
class UninitializedContextError extends FppError {}
class PrivateAppError extends FppError {}

class HttpRequestError extends FppError {}
class HttpMaxRetriesError extends FppError {}
class HttpResponseError extends FppError {
  public constructor(
    message: string,
    readonly code: number,
    readonly statusText: string,
  ) {
    super(message);
  }
}
class HttpRetriableError extends FppError {}
class HttpInternalError extends HttpRetriableError {}
class HttpThrottlingError extends HttpRetriableError {
  public constructor(message: string, readonly retryAfter?: number) {
    super(message);
  }
}

class InvalidOAuthError extends FppError {}
class SessionNotFound extends FppError {}
class CookieNotFound extends FppError {}
class InvalidSession extends FppError {}

class InvalidWebhookError extends FppError {}
class SessionStorageError extends FppError {}

class MissingRequiredArgument extends FppError {}
class UnsupportedClientType extends FppError {}

export {
  FppError,
  InvalidHmacError,
  InvalidShopError,
  InvalidJwtError,
  MissingJwtTokenError,
  SafeCompareError,
  HttpRequestError,
  HttpMaxRetriesError,
  HttpResponseError,
  HttpRetriableError,
  HttpInternalError,
  HttpThrottlingError,
  UninitializedContextError,
  InvalidOAuthError,
  SessionNotFound,
  CookieNotFound,
  InvalidSession,
  InvalidWebhookError,
  MissingRequiredArgument,
  UnsupportedClientType,
  SessionStorageError,
  PrivateAppError,
};
