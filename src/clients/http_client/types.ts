import {Headers} from 'node-fetch';

import {Method} from '../../utils/network';


export interface HeaderParams {
 [key: string]: string | number;
}

export enum DataType {
  JSON = 'application/json',
  GraphQL = 'application/graphql',
  URLEncoded = 'application/x-www-form-urlencoded',
}

export interface GetRequestParams {
  path: string;
  type?: DataType;
  data?: {[key: string]: unknown;} | string;
  query?: {[key: string]: string | number;};
  extraHeaders?: HeaderParams;
  tries?: number;
}

export type PostRequestParams = GetRequestParams & {
  type: DataType;
  data: {[key: string]: unknown;} | string;
};

export type PutRequestParams = PostRequestParams;

export type DeleteRequestParams = GetRequestParams;

export type RequestParams = (GetRequestParams | PostRequestParams) & {
  method: Method;
};

export interface RequestReturn {
  body: unknown;
  headers: Headers;
}
