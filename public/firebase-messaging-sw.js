/**
 * Firebase Cloud Messaging Service Worker
 *
 * Handles background push notifications for Homecast Cloud.
 * Only activated when explicitly registered by cloud-mode code.
 * Community Edition never registers this service worker.
 */

/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/11.6.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.6.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyAT3bG7fS3mdBinMSdXCVt6jr-E7sfZ_B8',
  authDomain: 'homecast-483609.firebaseapp.com',
  projectId: 'homecast-483609',
  messagingSenderId: '510863512358',
  appId: '1:510863512358:web:5bb59c26aeaa37a76aa7e7',
});

const messaging = firebase.messaging();

// Handle background push notifications (when app tab is not focused)
messaging.onBackgroundMessage((payload) => {
  const notification = payload.notification || {};
  const data = payload.data || {};

  const title = notification.title || 'Homecast';
  const options = {
    body: notification.body || 'New notification from Homecast',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: data,
    tag: `homecast-${data.automationId || 'notification'}`,
  };

  // Add action buttons if present in data
  if (data.actions) {
    try {
      options.actions = JSON.parse(data.actions);
    } catch (_) {
      // Ignore parse errors
    }
  }

  self.registration.showNotification(title, options);
});

// Handle notification click (including action buttons)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const action = event.action; // The clicked action button ID (empty string if notification body clicked)
  const data = event.notification.data || {};

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Find an existing Homecast tab
      for (const client of windowClients) {
        if (client.url.includes('homecast.cloud') && 'focus' in client) {
          // Post the action to the existing client for relay forwarding
          if (action) {
            client.postMessage({
              type: 'notification_action',
              action: action,
              data: data,
            });
          }
          return client.focus();
        }
      }
      // No existing tab — open a new one
      return clients.openWindow('/');
    })
  );
});
