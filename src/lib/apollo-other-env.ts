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

const OTHER_API_BASE = OTHER_ENV === "production" ? PROD_API : OTHER_ENV === "staging" ? STAGING_API : null;

export const OTHER_WEB_BASE: string | null =
  OTHER_ENV === "production" ? PROD_WEB : OTHER_ENV === "staging" ? STAGING_WEB : null;

const OTHER_REQUEST_TIMEOUT_MS = 15_000;

const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OTHER_REQUEST_TIMEOUT_MS);
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

function buildClient(): ApolloClient | null {
  if (!OTHER_API_BASE) return null;
  const httpLink = createHttpLink({
    uri: `${OTHER_API_BASE}/`,
    fetch: fetchWithTimeout,
  });
  return new ApolloClient({
    link: ApolloLink.from([authLink, retryLink, httpLink]),
    cache: new InMemoryCache(),
  });
}

export const otherEnvClient: ApolloClient | null = buildClient();
