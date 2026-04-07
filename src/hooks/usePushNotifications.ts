/**
 * Push notification hook for Homecast Cloud.
 *
 * Handles:
 * - Permission request flow
 * - FCM token registration via GraphQL
 * - Service worker registration
 * - Notification action forwarding (from SW → server)
 *
 * Only active in cloud mode. Community Edition and WKWebView relay are skipped.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { isCommunity } from '../lib/config';

type PermissionState = NotificationPermission | 'unsupported';

/** Whether the browser supports push notifications */
const isSupported =
  typeof window !== 'undefined' &&
  'Notification' in window &&
  'serviceWorker' in navigator &&
  'PushManager' in window;

/** Whether we're running inside the Mac app's WKWebView */
const isWKWebView = !!(window as any).webkit?.messageHandlers?.homekit;

function getDeviceName(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Chrome')) return `Chrome on ${navigator.platform}`;
  if (ua.includes('Firefox')) return `Firefox on ${navigator.platform}`;
  if (ua.includes('Safari')) return `Safari on ${navigator.platform}`;
  return navigator.platform || 'Unknown device';
}

function getOrCreateFingerprint(): string {
  const key = 'homecast-push-fingerprint';
  let fp = localStorage.getItem(key);
  if (!fp) {
    fp = crypto.randomUUID();
    localStorage.setItem(key, fp);
  }
  return fp;
}

export interface UsePushNotificationsReturn {
  /** Current permission state */
  permission: PermissionState;
  /** Whether push notifications are supported in this context */
  isAvailable: boolean;
  /** Whether a registration is in progress */
  isRegistering: boolean;
  /** Request permission and register FCM token */
  requestPermission: () => Promise<boolean>;
  /** Unregister the current device */
  unregister: () => Promise<boolean>;
}

export function usePushNotifications(
  /** GraphQL mutation to register a push token */
  registerTokenMutation?: (vars: {
    token: string;
    platform: string;
    deviceFingerprint: string;
    deviceName: string;
  }) => Promise<unknown>,
  /** GraphQL mutation to unregister a push token */
  unregisterTokenMutation?: (vars: { deviceFingerprint: string }) => Promise<unknown>,
): UsePushNotificationsReturn {
  const [permission, setPermission] = useState<PermissionState>(
    !isSupported ? 'unsupported' : Notification.permission,
  );
  const [isRegistering, setIsRegistering] = useState(false);
  const swRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);

  // Not available in Community mode, WKWebView, or unsupported browsers
  const isAvailable = isSupported && !isCommunity && !isWKWebView;

  // Listen for notification action messages from the service worker
  useEffect(() => {
    if (!isAvailable) return;

    const handleSWMessage = (event: MessageEvent) => {
      if (event.data?.type === 'notification_action') {
        // Forward the action to the server via WebSocket
        // The WebSocketContext will pick this up and send automation.notification_response
        window.dispatchEvent(
          new CustomEvent('homecast-notification-action', {
            detail: {
              action: event.data.action,
              data: event.data.data,
            },
          }),
        );
      }
    };

    navigator.serviceWorker.addEventListener('message', handleSWMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleSWMessage);
  }, [isAvailable]);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!isAvailable || !registerTokenMutation) return false;

    setIsRegistering(true);
    try {
      // 1. Request browser notification permission
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') return false;

      // 2. Dynamically import Firebase (code-split, not in Community bundle)
      const { FIREBASE_CONFIG, VAPID_KEY } = await import('../lib/firebase');
      const { initializeApp } = await import('firebase/app');
      const { getMessaging, getToken } = await import('firebase/messaging');

      const app = initializeApp(FIREBASE_CONFIG);
      const messaging = getMessaging(app);

      // 3. Register service worker
      const swRegistration = await navigator.serviceWorker.register(
        '/firebase-messaging-sw.js',
      );
      swRegistrationRef.current = swRegistration;

      // 4. Get FCM token
      const token = await getToken(messaging, {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: swRegistration,
      });

      if (!token) {
        console.warn('[Push] Failed to get FCM token');
        return false;
      }

      // 5. Register with server via GraphQL
      const fingerprint = getOrCreateFingerprint();
      await registerTokenMutation({
        token,
        platform: 'web',
        deviceFingerprint: fingerprint,
        deviceName: getDeviceName(),
      });

      console.log('[Push] Registration complete');
      return true;
    } catch (e) {
      console.error('[Push] Registration failed:', e);
      return false;
    } finally {
      setIsRegistering(false);
    }
  }, [isAvailable, registerTokenMutation]);

  const unregister = useCallback(async (): Promise<boolean> => {
    if (!unregisterTokenMutation) return false;

    try {
      const fingerprint = localStorage.getItem('homecast-push-fingerprint');
      if (!fingerprint) return false;

      await unregisterTokenMutation({ deviceFingerprint: fingerprint });

      // Unregister service worker
      if (swRegistrationRef.current) {
        await swRegistrationRef.current.unregister();
        swRegistrationRef.current = null;
      }

      console.log('[Push] Unregistered');
      return true;
    } catch (e) {
      console.error('[Push] Unregister failed:', e);
      return false;
    }
  }, [unregisterTokenMutation]);

  return {
    permission,
    isAvailable,
    isRegistering,
    requestPermission,
    unregister,
  };
}
