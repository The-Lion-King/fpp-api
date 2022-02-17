import querystring, {ParsedUrlQueryInput} from 'querystring';
import crypto from 'crypto';
import fs from 'fs';

import fetch, {RequestInit, Response} from 'node-fetch';

import {Method, StatusCode} from '../../utils/network';
import * as FppErrors from '../../error';
import {FPP_API_LIBRARY_VERSION} from '../../version';
import validateShop from '../../utils/shop-validator';
import {Context} from '../../context';

import {
  DataType,
  GetRequestParams,
  PostRequestParams,
  PutRequestParams,
  DeleteRequestParams,
  RequestParams,
  RequestReturn,
} from './types';

class HttpClient {
  static readonly RETRY_WAIT_TIME = 1000;
  static readonly DEPRECATION_ALERT_DELAY = 300000;
  private LOGGED_DEPRECATIONS: {[key: string]: number;} = {};

  public constructor(private readonly domain: string) {
    if (!validateShop(domain)) {
      throw new FppErrors.InvalidShopError(`Domain ${domain} is not valid`);
    }

    this.domain = domain;
  }

  public async get(params: GetRequestParams): Promise<RequestReturn> {
    return this.request({method: Method.Get, ...params});
  }

  public async post(params: PostRequestParams): Promise<RequestReturn> {
    return this.request({method: Method.Post, ...params});
  }

  public async put(params: PutRequestParams): Promise<RequestReturn> {
    return this.request({method: Method.Put, ...params});
  }

  public async delete(params: DeleteRequestParams): Promise<RequestReturn> {
    return this.request({method: Method.Delete, ...params});
  }

  protected async request(params: RequestParams): Promise<RequestReturn> {
    const maxTries = params.tries ? params.tries : 1;
    if (maxTries <= 0) {
      throw new FppErrors.HttpRequestError(
        `Number of tries must be >= 0, got ${maxTries}`,
      );
    }

    let userAgent = `Fpp API Library v${FPP_API_LIBRARY_VERSION} | Node ${process.version}`;

    if (Context.USER_AGENT_PREFIX) {
      userAgent = `${Context.USER_AGENT_PREFIX} | ${userAgent}`;
    }

    if (params.extraHeaders) {
      if (params.extraHeaders['user-agent']) {
        userAgent = `${params.extraHeaders['user-agent']} | ${userAgent}`;
        delete params.extraHeaders['user-agent'];
      } else if (params.extraHeaders['User-Agent']) {
        userAgent = `${params.extraHeaders['User-Agent']} | ${userAgent}`;
      }
    }

    let headers: typeof params.extraHeaders = {
      ...params.extraHeaders,
      'User-Agent': userAgent,
    };
    let body = null;
    if (params.method === Method.Post || params.method === Method.Put) {
      const {type, data} = params as PostRequestParams;
      if (data) {
        switch (type) {
          case DataType.JSON:
            body = typeof data === 'string' ? data : JSON.stringify(data);
            break;
          case DataType.URLEncoded:
            body =
              typeof data === 'string'
                ? data
                : querystring.stringify(data as ParsedUrlQueryInput);
            break;
          case DataType.GraphQL:
            body = data as string;
            break;
        }
        headers = {
          'Content-Type': type,
          'Content-Length': Buffer.byteLength(body as string),
          ...params.extraHeaders,
        };
      }
    }

    const queryString = params.query
      ? `?${querystring.stringify(params.query as ParsedUrlQueryInput)}`
      : '';

    const url = `https://${this.domain}${this.getRequestPath(params.path)}${queryString}`;
    const options: RequestInit = {
      method: params.method.toString(),
      headers,
      body,
    } as RequestInit;

    async function sleep(waitTime: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    let tries = 0;
    while (tries < maxTries) {
      try {
        return await this.doRequest(url, options);
      } catch (error) {
        tries++;
        if (error instanceof FppErrors.HttpRetriableError) {
          if (tries < maxTries) {
            let waitTime = HttpClient.RETRY_WAIT_TIME;
            if (
              error instanceof FppErrors.HttpThrottlingError &&
              error.retryAfter
            ) {
              waitTime = error.retryAfter * 1000;
            }
            await sleep(waitTime);
            continue;
          }

          if (maxTries > 1) {
            throw new FppErrors.HttpMaxRetriesError(
              `Exceeded maximum retry count of ${maxTries}. Last message: ${error.message}`,
            );
          }
        }

        throw error;
      }
    }

    throw new FppErrors.FppError(
      `Unexpected flow, reached maximum HTTP tries but did not throw an error`,
    );
  }

  protected getRequestPath(path: string): string {
    return `/${path.replace(/^\//, '')}`;
  }

  private async doRequest(
    url: string,
    options: RequestInit,
  ): Promise<RequestReturn> {
    return fetch(url, options)
      .then(async (response: Response) => {
        const body = await response.json();

        if (response.ok) {
          if (
            response.headers &&
            response.headers.has('X-Fpp-API-Deprecated-Reason')
          ) {
            const deprecation = {
              message: response.headers.get('X-Fpp-API-Deprecated-Reason'),
              path: url,
            };

            const depHash = crypto
              .createHash('md5')
              .update(JSON.stringify(deprecation))
              .digest('hex');

            if (
              !Object.keys(this.LOGGED_DEPRECATIONS).includes(depHash) ||
              Date.now() - this.LOGGED_DEPRECATIONS[depHash] >=
                HttpClient.DEPRECATION_ALERT_DELAY
            ) {
              this.LOGGED_DEPRECATIONS[depHash] = Date.now();

              if (Context.LOG_FILE) {
                const stack = new Error().stack;
                const log = `API Deprecation Notice ${new Date().toLocaleString()} : ${JSON.stringify(
                  deprecation,
                )}\n    Stack Trace: ${stack}\n`;
                fs.writeFileSync(Context.LOG_FILE, log, {
                  flag: 'a',
                  encoding: 'utf-8',
                });
              } else {
                console.warn('API Deprecation Notice:', deprecation);
              }
            }
          }

          return {
            body,
            headers: response.headers,
          };
        } else {
          const errorMessages: string[] = [];
          if (body.errors) {
            errorMessages.push(JSON.stringify(body.errors, null, 2));
          }
          if (response.headers && response.headers.get('x-request-id')) {
            errorMessages.push(
              `If you report this error, please include this id: ${response.headers.get(
                'x-request-id',
              )}`,
            );
          }

          const errorMessage = errorMessages.length
            ? `:\n${errorMessages.join('\n')}`
            : '';
          switch (true) {
            case response.status === StatusCode.TooManyRequests: {
              const retryAfter = response.headers.get('Retry-After');
              throw new FppErrors.HttpThrottlingError(
                `Fpp is throttling requests${errorMessage}`,
                retryAfter ? parseFloat(retryAfter) : undefined,
              );
            }
            case response.status >= StatusCode.InternalServerError:
              throw new FppErrors.HttpInternalError(
                `Fpp internal error${errorMessage}`,
              );
            default:
              throw new FppErrors.HttpResponseError(
                `Received an error response (${response.status} ${response.statusText}) from Fpp${errorMessage}`,
                response.status,
                response.statusText,
              );
          }
        }
      })
      .catch((error) => {
        if (error instanceof FppErrors.FppError) {
          throw error;
        } else {
          throw new FppErrors.HttpRequestError(
            `Failed to make Fpp HTTP request: ${error}`,
          );
        }
      });
  }
}

export {HttpClient};
