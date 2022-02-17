import {RestClient as Rest} from './rest';
import {GraphqlClient as Graphql} from './graphql';
import {StorefrontClient as Storefront} from './graphql/storefront_client';

const FppClients = {
  Rest,
  Graphql,
  Storefront,
};

export default FppClients;
export {FppClients};
