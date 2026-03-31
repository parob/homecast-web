import { ApolloClient, InMemoryCache, createHttpLink, ApolloLink, Observable } from "@apollo/client/core";
import { SetContextLink } from "@apollo/client/link/context";
import { generateTraceId, getClientType } from "./tracing";
import { config, isCommunity } from "./config";
import { browserLogger } from "./browser-logger";
import { isRelayCapable } from "../native/homekit-bridge";

const httpLink = createHttpLink({
  uri: config.graphqlUrl,
});

// Auth link - adds authorization header
const authLink = new SetContextLink((prevContext) => {
  const token = localStorage.getItem("homecast-token");
  const existingHeaders = prevContext?.headers || {};
  return {
    headers: {
      ...existingHeaders,
      authorization: token ? `Bearer ${token}` : "",
    },
  };
});

// Trace link - adds trace headers to mutations for distributed tracing
const traceLink = new ApolloLink((operation, forward) => {
  // Check if this is a mutation by looking at the operation definition
  const definition = operation.query.definitions[0];
  const isMutation = definition && 'operation' in definition && definition.operation === 'mutation';

  if (isMutation) {
    const traceId = generateTraceId();
    operation.setContext(({ headers = {} }: { headers?: Record<string, string> }) => ({
      headers: {
        ...headers,
        'X-Trace-ID': traceId,
        'X-Client-Timestamp': new Date().toISOString(),
        'X-Client-Type': getClientType(),
      },
    }));
  }

  return forward(operation);
});

// Logging link - captures GraphQL operations for the browser logs tab
const loggingLink = new ApolloLink((operation, forward) => {
  const def = operation.query.definitions[0];
  const opType = def && 'operation' in def ? def.operation : 'query';
  browserLogger.logGql(`${opType}:${operation.operationName}`);
  return new Observable(observer => {
    forward(operation).subscribe({
      next(result) {
        if (result.errors?.length) {
          browserLogger.logGql(
            `${opType}:${operation.operationName} error`,
            result.errors.map(e => e.message).join('; '),
            'error'
          );
        }
        observer.next(result);
      },
      error: observer.error.bind(observer),
      complete: observer.complete.bind(observer),
    });
  });
});

// Community mode on relay Mac: handle GraphQL locally (no HTTP round-trip).
// This avoids the circular request issue where WKWebView → HTTP → Swift → JS → same WKWebView.
const communityLocalLink = new ApolloLink((operation, forward) => {
  if (!(isCommunity && isRelayCapable())) {
    return forward(operation);
  }

  return new Observable(observer => {
    // Lazy import to avoid circular dependency at module load time
    import('../server/local-graphql').then(({ handleGraphQL }) => {
      handleGraphQL({
        operationName: operation.operationName,
        variables: operation.variables,
      }).then(result => {
        observer.next(result as any);
        observer.complete();
      }).catch(error => {
        observer.error(error);
      });
    });
  });
});

export const apolloClient = new ApolloClient({
  link: ApolloLink.from([communityLocalLink, authLink, traceLink, loggingLink, httpLink]),
  cache: new InMemoryCache(),
});
