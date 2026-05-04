/**
 * Purchase routing — picks StoreKit (App Store builds) or Stripe (web).
 *
 * The Mac/iOS app injects `window.isHomecastNativePurchaseAvailable = true`
 * and exposes `webkit.messageHandlers.homecast` for bridge calls. When that
 * flag is set, all upgrade flows route through Apple IAP. Otherwise they
 * use the existing Stripe checkout path.
 *
 * Anti-steering: this module never compares Apple and Stripe pricing or
 * mentions external checkout when `isNativePurchaseAvailable()` is true.
 */

import { apolloClient } from './apollo';
import { VALIDATE_APPLE_PURCHASE, RESTORE_APPLE_PURCHASES, CREATE_CHECKOUT_SESSION } from './graphql/mutations';
import { GET_ME } from './graphql/queries';
import { isNativePurchaseAvailable } from './platform';

/** Read the current Homecast user's UUID from Apollo's cached GET_ME
 *  response. Used to bind StoreKit transactions via appAccountToken so
 *  the server can verify the JWS belongs to the JWT-authenticated user. */
function currentUserId(): string | null {
  try {
    const data = apolloClient.readQuery<{ me: { id: string } }>({ query: GET_ME });
    return data?.me?.id ?? null;
  } catch {
    return null;
  }
}

export type PlanId = 'standard' | 'cloud';

export interface NativeProduct {
  productId: string;
  displayPrice: string;   // Apple-localized (e.g. "$10.99", "£9.99")
  price: number;
  currencyCode: string;
  period: 'month' | 'year';
}

export interface PurchaseResult {
  success: boolean;
  upgraded?: boolean;
  /** account_type the server actually applied — may differ from the
   *  requested plan if StoreKit re-emitted a different unfinished
   *  transaction. Use this for toast/UI text instead of the requested plan. */
  accountType?: string;
  redirectUrl?: string;   // Stripe checkout URL (web path only)
  error?: string;
}

const NATIVE_PRODUCT_IDS: Record<PlanId, string> = {
  standard: 'cloud.homecast.app.standard.monthly',
  cloud: 'cloud.homecast.app.cloud.monthly',
};

interface PendingCallback<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

const pendingPurchaseCallbacks = new Map<string, PendingCallback<any>>();

if (typeof window !== 'undefined') {
  (window as any).__purchase_callback = (response: { callbackId: string; result?: any; error?: string }) => {
    const cb = pendingPurchaseCallbacks.get(response.callbackId);
    if (!cb) return;
    pendingPurchaseCallbacks.delete(response.callbackId);
    if (response.error) cb.reject(new Error(response.error));
    else cb.resolve(response.result);
  };

  // Background transaction updates from StoreKit (renewals, family-sharing,
  // unfinished transactions completing after server-side validation issues).
  // PurchaseManager.start() emits these via the native bridge — we forward
  // them to the server so account_type stays in sync without user action.
  (window as any).__purchase_event = async (event: { type?: string; jws?: string }) => {
    if (event?.type !== 'transactionUpdate' || !event.jws) return;
    try {
      await apolloClient.mutate({
        mutation: VALIDATE_APPLE_PURCHASE,
        variables: { jwsTransaction: event.jws, productId: '' },
      });
      // Refetch account so the UI updates without a page reload.
      await apolloClient.refetchQueries({ include: ['GetAccount', 'GetMe'] });
    } catch (err) {
      console.warn('[purchase] background transaction validation failed', err);
    }
  };
}

function callNativePurchase<T = any>(method: string, payload: Record<string, unknown> = {}, timeoutMs = 120_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const callbackId = `purchase_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const handlers = (window as any).webkit?.messageHandlers?.homecast;
    if (!handlers) {
      reject(new Error('Native purchase bridge not available'));
      return;
    }

    const timer = setTimeout(() => {
      if (pendingPurchaseCallbacks.has(callbackId)) {
        pendingPurchaseCallbacks.delete(callbackId);
        reject(new Error('Native purchase request timed out'));
      }
    }, timeoutMs);

    pendingPurchaseCallbacks.set(callbackId, {
      resolve: (v: T) => { clearTimeout(timer); resolve(v); },
      reject: (e: Error) => { clearTimeout(timer); reject(e); },
    });

    try {
      handlers.postMessage({ action: 'purchase', method, payload, callbackId });
    } catch (err) {
      pendingPurchaseCallbacks.delete(callbackId);
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

let _cachedProducts: Record<PlanId, NativeProduct> | null = null;

/** Fetch live prices from StoreKit (cached). Returns null on web or when
 *  StoreKit returns no products (which means the config isn't loaded or
 *  the app isn't approved for IAP yet). Callers should treat null as
 *  "pricing unknown" and show a placeholder. */
export async function getNativeProducts(): Promise<Record<PlanId, NativeProduct> | null> {
  if (!isNativePurchaseAvailable()) return null;
  if (_cachedProducts) return _cachedProducts;
  try {
    const products = await callNativePurchase<NativeProduct[]>('getProducts', {
      productIds: Object.values(NATIVE_PRODUCT_IDS),
    });
    if (!Array.isArray(products) || products.length === 0) {
      console.warn('[purchase] StoreKit returned no products');
      return null;
    }
    const byPlan: Record<PlanId, NativeProduct> = {} as any;
    for (const p of products) {
      const plan = (Object.entries(NATIVE_PRODUCT_IDS).find(([, id]) => id === p.productId) || [])[0] as PlanId | undefined;
      if (plan) byPlan[plan] = p;
    }
    if (!byPlan.standard && !byPlan.cloud) {
      console.warn('[purchase] StoreKit returned products but none matched expected IDs', products);
      return null;
    }
    _cachedProducts = byPlan;
    return byPlan;
  } catch (err) {
    console.warn('[purchase] failed to load native products', err);
    return null;
  }
}

/**
 * Trigger purchase for a plan. On App Store builds this opens StoreKit;
 * on web this returns a Stripe checkout URL the caller must navigate to.
 */
export async function purchasePlan(
  plan: PlanId,
  options: { homeName?: string } = {},
): Promise<PurchaseResult> {
  if (isNativePurchaseAvailable()) {
    const productId = NATIVE_PRODUCT_IDS[plan];
    const userId = currentUserId();  // bind transaction to this Homecast user via appAccountToken
    try {
      const native = await callNativePurchase<{ jws: string; cancelled?: boolean }>('buy', { productId, userId });
      if (native.cancelled) return { success: false };

      const { data } = await apolloClient.mutate({
        mutation: VALIDATE_APPLE_PURCHASE,
        variables: { jwsTransaction: native.jws, productId, homeName: options.homeName },
      });
      const result = data?.validateApplePurchase;
      if (result?.error) return { success: false, error: result.error };
      return { success: true, upgraded: true, accountType: result?.accountType };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Purchase failed';
      return { success: false, error: message };
    }
  }

  // Web / Stripe path
  try {
    const { data } = await client.mutate({
      mutation: CREATE_CHECKOUT_SESSION,
      variables: { plan, homeName: options.homeName },
    });
    const result = data?.createCheckoutSession;
    if (result?.error) return { success: false, error: result.error };
    if (result?.upgraded) return { success: true, upgraded: true };
    if (result?.url) return { success: true, redirectUrl: result.url };
    return { success: false, error: 'Checkout returned no URL' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to start checkout';
    return { success: false, error: message };
  }
}

/** App Store builds only: re-validate owned StoreKit transactions. */
export async function restorePurchases(): Promise<PurchaseResult> {
  if (!isNativePurchaseAvailable()) {
    return { success: false, error: 'Restore is only available in the App Store build' };
  }
  try {
    const native = await callNativePurchase<{ jwsTransactions: string[] }>('restore', {});
    if (!native.jwsTransactions?.length) {
      return { success: false, error: 'No purchases to restore' };
    }
    const { data } = await client.mutate({
      mutation: RESTORE_APPLE_PURCHASES,
      variables: { jwsTransactions: native.jwsTransactions },
    });
    const result = data?.restoreApplePurchases;
    if (result?.error) return { success: false, error: result.error };
    return { success: !!result?.restored, upgraded: !!result?.restored };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Restore failed';
    return { success: false, error: message };
  }
}

/** App Store builds only: open Apple's manage-subscriptions sheet/URL. */
export function openManageSubscriptions(): void {
  if (!isNativePurchaseAvailable()) return;
  callNativePurchase('openManageSubscriptions', {}).catch(() => { /* noop */ });
}

