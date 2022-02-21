import {createHmac} from 'crypto';
import http from 'http';

import {StatusCode} from '../utils/network';
import {GraphqlClient} from '../clients/graphql/graphql_client';
import {ApiVersion, FppHeader} from '../base_types';
import FppUtilities from '../utils';
import {Context} from '../context';
import * as FppErrors from '../error';

import {
  DeliveryMethod,
  RegisterOptions,
  RegisterReturn,
  WebhookRegistryEntry,
  WebhookCheckResponse,
  WebhookCheckResponseLegacy,
  ShortenedRegisterOptions,
} from './types';

interface AddHandlersProps {
  [topic: string]: WebhookRegistryEntry;
}

interface RegistryInterface {
  webhookRegistry: {[topic: string]: WebhookRegistryEntry;};
  
  addHandler(topic: string, options: WebhookRegistryEntry): void;
  
  addHandlers(handlers: AddHandlersProps): void;
  
  getHandler(topic: string): WebhookRegistryEntry | null;
  
  getTopics(): string[];
  
  register(options: RegisterOptions): Promise<RegisterReturn>;
  
  registerAll(options: ShortenedRegisterOptions): Promise<RegisterReturn>;
  
  process(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void>;
  
  isWebhookPath(path: string): boolean;
}

function isSuccess(
  result: any,
  deliveryMethod: DeliveryMethod,
  webhookId?: string,
): boolean {
  let endpoint;
  switch (deliveryMethod) {
    case DeliveryMethod.Http:
      endpoint = 'webhookSubscription';
      break;
    case DeliveryMethod.EventBridge:
      endpoint = 'eventBridgeWebhookSubscription';
      break;
    case DeliveryMethod.PubSub:
      endpoint = 'pubSubWebhookSubscription';
      break;
    default:
      return false;
  }
  endpoint += webhookId ? 'Update' : 'Create';
  return Boolean(
    result.data &&
      result.data[endpoint] &&
      result.data[endpoint].webhookSubscription,
  );
}

function versionSupportsEndpointField() {
  return FppUtilities.versionCompatible(ApiVersion.January22);
}

function versionSupportsPubSub() {
  return FppUtilities.versionCompatible(ApiVersion.January22);
}

function validateDeliveryMethod(deliveryMethod: DeliveryMethod) {
  if (
    deliveryMethod === DeliveryMethod.EventBridge &&
    !versionSupportsEndpointField()
  ) {
    throw new FppErrors.UnsupportedClientType(
      `EventBridge webhooks are not supported in API version "${Context.API_VERSION}".`,
    );
  } else if (
    deliveryMethod === DeliveryMethod.PubSub &&
    !versionSupportsPubSub()
  ) {
    throw new FppErrors.UnsupportedClientType(
      `Pub/Sub webhooks are not supported in API version "${Context.API_VERSION}".`,
    );
  }
}

function buildCheckQuery(topic: string): string {
  const query = `{
    webhookSubscriptions(first: 1, topics: ${topic}) {
      edges {
        node {
          id
          endpoint {
            __typename
            ... on WebhookHttpEndpoint {
              callbackUrl
            }
            ... on WebhookEventBridgeEndpoint {
              arn
            }
            ${
              versionSupportsPubSub()
                ? '... on WebhookPubSubEndpoint { \
                    pubSubProject \
                    pubSubTopic \
                  }'
                : ''
            }
          }
        }
      }
    }
  }`;

  const legacyQuery = `{
    webhookSubscriptions(first: 1, topics: ${topic}) {
      edges {
        node {
          id
          callbackUrl
        }
      }
    }
  }`;

  return versionSupportsEndpointField() ? query : legacyQuery;
}

function buildQuery(
  topic: string,
  address: string,
  deliveryMethod: DeliveryMethod = DeliveryMethod.Http,
  webhookId?: string,
): string {
  validateDeliveryMethod(deliveryMethod);
  let identifier: string;
  if (webhookId) {
    identifier = `id: "${webhookId}"`;
  } else {
    identifier = `topic: ${topic}`;
  }

  let mutationName: string;
  let webhookSubscriptionArgs: string;
  let pubSubProject: string;
  let pubSubTopic: string;
  switch (deliveryMethod) {
    case DeliveryMethod.Http:
      mutationName = webhookId
        ? 'webhookSubscriptionUpdate'
        : 'webhookSubscriptionCreate';
      webhookSubscriptionArgs = `{callbackUrl: "${address}"}`;
      break;
    case DeliveryMethod.EventBridge:
      mutationName = webhookId
        ? 'eventBridgeWebhookSubscriptionUpdate'
        : 'eventBridgeWebhookSubscriptionCreate';
      webhookSubscriptionArgs = `{arn: "${address}"}`;
      break;
    case DeliveryMethod.PubSub:
      mutationName = webhookId
        ? 'pubSubWebhookSubscriptionUpdate'
        : 'pubSubWebhookSubscriptionCreate';
      [pubSubProject, pubSubTopic] = address
        .replace(/^pubsub:\/\//, '')
        .split(':');
      webhookSubscriptionArgs = `{pubSubProject: "${pubSubProject}",
                                  pubSubTopic: "${pubSubTopic}"}`;
      break;
  }

  return `
    mutation webhookSubscription {
      ${mutationName}(${identifier}, webhookSubscription: ${webhookSubscriptionArgs}) {
        userErrors {
          field
          message
        }
        webhookSubscription {
          id
        }
      }
    }
  `;
}

const WebhooksRegistry: RegistryInterface = {
  webhookRegistry: {},

  addHandler(topic: string, {path, webhookHandler}: WebhookRegistryEntry): void {
    WebhooksRegistry.webhookRegistry[topic] = {path, webhookHandler};
  },

  addHandlers(handlers: AddHandlersProps): void {
    for (const topic in handlers) {
      if ({}.hasOwnProperty.call(handlers, topic)) {
        WebhooksRegistry.addHandler(topic, handlers[topic]);
      }
    }
  },

  getHandler(topic: string): WebhookRegistryEntry | null {
    return topic in WebhooksRegistry.webhookRegistry ? WebhooksRegistry.webhookRegistry[topic] : null;
  },

  getTopics(): string[] {
    return Object.keys(WebhooksRegistry.webhookRegistry);
  },

  async register({
    path,
    topic,
    accessToken,
    shop,
    deliveryMethod = DeliveryMethod.Http,
  }: RegisterOptions): Promise<RegisterReturn> {
    const registerReturn: RegisterReturn = {};
    validateDeliveryMethod(deliveryMethod);
    const client = new GraphqlClient(shop, accessToken);
    const address =
      deliveryMethod === DeliveryMethod.Http
        ? `https://${Context.HOST_NAME}${path}`
        : path;
    const checkResult = (await client.query({
      data: buildCheckQuery(topic),
    })) as {body: WebhookCheckResponse | WebhookCheckResponseLegacy;};
    let webhookId: string | undefined;
    let mustRegister = true;
    if (checkResult.body.data.webhookSubscriptions.edges.length) {
      const {node} = checkResult.body.data.webhookSubscriptions.edges[0];
      let endpointAddress = '';
      if ('endpoint' in node) {
        if (node.endpoint.__typename === 'WebhookHttpEndpoint') {
          endpointAddress = node.endpoint.callbackUrl;
        } else if (node.endpoint.__typename === 'WebhookEventBridgeEndpoint') {
          endpointAddress = node.endpoint.arn;
        }
      } else {
        endpointAddress = node.callbackUrl;
      }
      webhookId = node.id;
      if (endpointAddress === address) {
        mustRegister = false;
      }
    }

    if (mustRegister) {
      const result = await client.query({
        data: buildQuery(topic, address, deliveryMethod, webhookId),
      });
      registerReturn[topic] = {
        success: isSuccess(result.body, deliveryMethod, webhookId),
        result: result.body,
      };
    } else {
      registerReturn[topic] = {
        success: true,
        result: {},
      };
    }
    return registerReturn;
  },

  async registerAll({
    accessToken,
    shop,
    deliveryMethod = DeliveryMethod.Http,
  }: ShortenedRegisterOptions): Promise<RegisterReturn> {
    let registerReturn = {};
    const topics = WebhooksRegistry.getTopics();

    for (const topic of topics) {
      const handler = WebhooksRegistry.getHandler(topic);
      if (handler) {
        const {path} = handler;
        const webhook: RegisterOptions = {
          path,
          topic,
          accessToken,
          shop,
          deliveryMethod,
        };
        const returnedRegister: RegisterReturn = await WebhooksRegistry.register(webhook);
        registerReturn = {...registerReturn, ...returnedRegister};
      }
    }
    return registerReturn;
  },

  async process(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    let reqBody = '';

    const promise: Promise<void> = new Promise((resolve, reject) => {
      request.on('data', (chunk) => {
        reqBody += chunk;
      });

      request.on('end', async () => {
        if (!reqBody.length) {
          response.writeHead(StatusCode.BadRequest);
          response.end();
          return reject(
            new FppErrors.InvalidWebhookError(
              'No body was received when processing webhook',
            ),
          );
        }

        let hmac: string | string[] | undefined;
        let topic: string | string[] | undefined;
        let domain: string | string[] | undefined;
        Object.entries(request.headers).map(([header, value]) => {
          switch (header.toLowerCase()) {
            case FppHeader.Hmac.toLowerCase():
              hmac = value;
              break;
            case FppHeader.Topic.toLowerCase():
              topic = value;
              break;
            case FppHeader.Domain.toLowerCase():
              domain = value;
              break;
          }
        });

        const missingHeaders = [];
        if (!hmac) {
          missingHeaders.push(FppHeader.Hmac);
        }
        if (!topic) {
          missingHeaders.push(FppHeader.Topic);
        }
        if (!domain) {
          missingHeaders.push(FppHeader.Domain);
        }

        if (missingHeaders.length) {
          response.writeHead(StatusCode.BadRequest);
          response.end();
          return reject(
            new FppErrors.InvalidWebhookError(
              `Missing one or more of the required HTTP headers to process webhooks: [${missingHeaders.join(
                ', ',
              )}]`,
            ),
          );
        }

        let statusCode: StatusCode | undefined;
        let responseError: Error | undefined;
        const headers = {};

        const generatedHash = createHmac('sha256', Context.API_SECRET_KEY)
          .update(reqBody, 'utf8')
          .digest('base64');

        if (FppUtilities.safeCompare(generatedHash, hmac as string)) {
          const graphqlTopic = (topic as string).toUpperCase().replace(/\//g, '_');
          const webhookEntry = WebhooksRegistry.getHandler(graphqlTopic);

          if (webhookEntry) {
            try {
              await webhookEntry.webhookHandler(
                graphqlTopic,
                domain as string,
                reqBody,
              );
              statusCode = StatusCode.Ok;
            } catch (error) {
              statusCode = StatusCode.InternalServerError;
              responseError = error;
            }
          } else {
            statusCode = StatusCode.Forbidden;
            responseError = new FppErrors.InvalidWebhookError(
              `No webhook is registered for topic ${topic}`,
            );
          }
        } else {
          statusCode = StatusCode.Forbidden;
          responseError = new FppErrors.InvalidWebhookError(
            `Could not validate request for topic ${topic}`,
          );
        }

        response.writeHead(statusCode, headers);
        response.end();
        if (responseError) {
          return reject(responseError);
        } else {
          return resolve();
        }
      });
    });

    return promise;
  },

  isWebhookPath(path: string): boolean {
    for (const key in WebhooksRegistry.webhookRegistry) {
      if (WebhooksRegistry.webhookRegistry[key].path === path) {
        return true;
      }
    }
    return false;
  },
};

export {WebhooksRegistry, RegistryInterface, buildCheckQuery, buildQuery};
