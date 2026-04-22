import { useQuery } from "@apollo/client/react";
import type { DocumentNode, OperationVariables } from "@apollo/client/core";
import { ENV_CLIENTS, type HomecastEnv } from "@/lib/apollo-other-env";
import { useAdminEnvToggle } from "@/hooks/useAdminEnvToggle";

export interface PairedEnvSide<TData> {
  env: HomecastEnv;
  data: TData | undefined;
  loading: boolean;
  error: Error | undefined;
  /** False when the toggle is off or the env's client isn't available. */
  active: boolean;
  refetch: () => void;
}

export interface PairedEnvQueryResult<TData> {
  prod: PairedEnvSide<TData>;
  staging: PairedEnvSide<TData>;
}

/**
 * Query prod and staging symmetrically. Returns `{prod, staging}` labelled by
 * env regardless of which URL the admin panel is loaded from.
 *
 * The sidebar toggle gates each side via `useAdminEnvToggle`; a toggled-off
 * env's useQuery is `skip: true`, so the hook does no fetch and returns
 * `active: false, data: undefined`.
 *
 * Callers that want to force-skip one side (e.g. Community mode, prod-only
 * resource) can pass `skipProd` / `skipStaging` explicitly.
 */
export function usePairedEnvQuery<TData = unknown, TVars extends OperationVariables = OperationVariables>(
  query: DocumentNode,
  options?: {
    variables?: TVars;
    skipProd?: boolean;
    skipStaging?: boolean;
    pollInterval?: number;
    fetchPolicy?: "cache-first" | "network-only" | "cache-and-network" | "no-cache";
  },
): PairedEnvQueryResult<TData> {
  const envToggle = useAdminEnvToggle();

  const prodActive = !options?.skipProd && envToggle.showProduction && !!ENV_CLIENTS.production;
  const stagingActive = !options?.skipStaging && envToggle.showStaging && !!ENV_CLIENTS.staging;

  const prodQ = useQuery<TData, TVars>(query, {
    variables: options?.variables,
    skip: !prodActive,
    pollInterval: options?.pollInterval,
    fetchPolicy: options?.fetchPolicy,
    client: ENV_CLIENTS.production ?? undefined,
    errorPolicy: "all",
  });

  const stagingQ = useQuery<TData, TVars>(query, {
    variables: options?.variables,
    skip: !stagingActive,
    pollInterval: options?.pollInterval,
    fetchPolicy: options?.fetchPolicy,
    client: ENV_CLIENTS.staging ?? undefined,
    errorPolicy: "all",
  });

  return {
    prod: {
      env: "production",
      data: prodQ.data,
      loading: prodQ.loading,
      error: prodQ.error,
      active: prodActive,
      refetch: () => { prodQ.refetch(); },
    },
    staging: {
      env: "staging",
      data: stagingQ.data,
      loading: stagingQ.loading,
      error: stagingQ.error,
      active: stagingActive,
      refetch: () => { stagingQ.refetch(); },
    },
  };
}
