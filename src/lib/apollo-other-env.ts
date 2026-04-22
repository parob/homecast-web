import { ApolloClient, InMemoryCache, createHttpLink, ApolloLink } from "@apollo/client/core";
import { SetContextLink } from "@apollo/client/link/context";
import { RetryLink } from "@apollo/client/link/retry";
import { config, isCommunity } from "./config";

export type HomecastEnv = "production" | "staging";

const PROD_API = "https://api.homecast.cloud";
const STAGING_API = "https://staging.api.homecast.cloud";
const PROD_WEB = "https://homecast.cloud";
const STAGING_WEB = "https://staging.homecast.cloud";

function currentEnvFromConfig(): HomecastEnv | null {
  if (isCommunity) return null;
  if (config.apiUrl.startsWith(STAGING_API)) return "staging";
  if (config.apiUrl.startsWith(PROD_API)) return "production";
  return null;
}

export const CURRENT_ENV: HomecastEnv | null = currentEnvFromConfig();
export const OTHER_ENV: HomecastEnv | null =
  CURRENT_ENV === "production" ? "staging" : CURRENT_ENV === "staging" ? "production" : null;

export const ENV_API: Record<HomecastEnv, string> = {
  production: PROD_API,
  staging: STAGING_API,
};

export const ENV_WEB: Record<HomecastEnv, string> = {
  production: PROD_WEB,
  staging: STAGING_WEB,
};

export const OTHER_WEB_BASE: string | null = OTHER_ENV ? ENV_WEB[OTHER_ENV] : null;

const REQUEST_TIMEOUT_MS = 15_000;

const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const upstream = init?.signal;
  if (upstream) {
    if (upstream.aborted) controller.abort();
    else upstream.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};

const authLink = new SetContextLink((prev) => {
  const token = localStorage.getItem("homecast-token");
  return {
    headers: {
      ...(prev?.headers || {}),
      authorization: token ? `Bearer ${token}` : "",
    },
  };
});

const retryLink = new RetryLink({
  delay: { initial: 300, max: 2_000, jitter: true },
  attempts: {
    max: 2,
    retryIf: (error) => {
      const msg = String((error as any)?.message || "");
      if (/aborted|timeout|NetworkError|Failed to fetch/i.test(msg)) return true;
      const status = (error as unknown as { statusCode?: number }).statusCode;
      return !!(status && status >= 500);
    },
  },
});

function buildClient(apiBase: string): ApolloClient {
  const httpLink = createHttpLink({
    uri: `${apiBase}/`,
    fetch: fetchWithTimeout,
  });
  return new ApolloClient({
    link: ApolloLink.from([authLink, retryLink, httpLink]),
    cache: new InMemoryCache(),
  });
}

/**
 * Env-named Apollo clients for admin pages.
 *
 * Each is pinned to its environment's GraphQL endpoint, regardless of which
 * URL is hosting the admin panel. Both clients share the same auth link
 * (reading the JWT from localStorage) — this works because prod and staging
 * are configured with the same JWT_SECRET, so a token issued by either env
 * validates on the other.
 *
 * Community mode has no cloud endpoints; both are null. Admin pages should
 * never render in Community mode, but callers should still guard defensively.
 */
export const prodClient: ApolloClient | null = isCommunity ? null : buildClient(PROD_API);
export const stagingClient: ApolloClient | null = isCommunity ? null : buildClient(STAGING_API);

export const ENV_CLIENTS: Record<HomecastEnv, ApolloClient | null> = {
  production: prodClient,
  staging: stagingClient,
};

/**
 * @deprecated Prefer `prodClient` / `stagingClient` + `usePairedEnvQuery`.
 * Retained so existing call sites keep compiling during the symmetry refactor.
 */
export const otherEnvClient: ApolloClient | null = OTHER_ENV ? ENV_CLIENTS[OTHER_ENV] : null;
