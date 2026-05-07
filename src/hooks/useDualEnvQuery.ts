import { useQuery } from "@apollo/client/react";
import type { DocumentNode, OperationVariables } from "@apollo/client/core";
import {
  CURRENT_ENV,
  OTHER_ENV,
  otherEnvClient,
  type HomecastEnv,
} from "@/lib/apollo-other-env";

export interface DualEnvSide<TData> {
  data: TData | undefined;
  loading: boolean;
  error: Error | undefined;
  env: HomecastEnv | null;
  available: boolean;
}

export interface DualEnvQueryResult<TData> {
  current: DualEnvSide<TData>;
  other: DualEnvSide<TData>;
}

/**
 * Run the same GraphQL query against the current env (the one serving this UI)
 * and the "other" env (prod if on staging, or staging if on prod).
 *
 * The "other" side fails soft — if the staging/prod API is unreachable or the
 * token isn't valid there, `other.error` is set but `current` still works.
 * In Community mode there is no "other" env; both sides return empty.
 */
export function useDualEnvQuery<TData = unknown, TVars extends OperationVariables = OperationVariables>(
  query: DocumentNode,
  options?: {
    variables?: TVars;
    skip?: boolean;
    skipOther?: boolean;
    pollInterval?: number;
    fetchPolicy?: "cache-first" | "network-only" | "cache-and-network" | "no-cache";
  }
): DualEnvQueryResult<TData> {
  const skip = options?.skip ?? false;
  const skipOther = options?.skipOther ?? false;

  const currentQ = useQuery<TData, TVars>(query, {
    variables: options?.variables,
    skip,
    pollInterval: options?.pollInterval,
    fetchPolicy: options?.fetchPolicy,
  });

  const otherQ = useQuery<TData, TVars>(query, {
    variables: options?.variables,
    skip: skip || skipOther || !otherEnvClient,
    pollInterval: options?.pollInterval,
    fetchPolicy: options?.fetchPolicy,
    client: otherEnvClient ?? undefined,
    errorPolicy: "all",
  });

  return {
    current: {
      data: currentQ.data,
      loading: currentQ.loading,
      error: currentQ.error,
      env: CURRENT_ENV,
      available: true,
    },
    other: {
      data: otherQ.data,
      loading: otherQ.loading,
      error: otherQ.error,
      env: OTHER_ENV,
      available: !!otherEnvClient,
    },
  };
}
