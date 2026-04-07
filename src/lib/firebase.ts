/**
 * Firebase configuration for Homecast Cloud push notifications.
 *
 * These are public Firebase Web SDK values (not secrets).
 * They identify the Firebase project and are safe to include in client code.
 *
 */

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAT3bG7fS3mdBinMSdXCVt6jr-E7sfZ_B8',
  authDomain: 'homecast-483609.firebaseapp.com',
  projectId: 'homecast-483609',
  messagingSenderId: '510863512358',
  appId: '1:510863512358:web:5bb59c26aeaa37a76aa7e7',
};

/**
 * VAPID key for Web Push.
 *
 * Generated in Firebase Console > Cloud Messaging > Web configuration > Web Push certificates
 *
 */
export const VAPID_KEY = 'BMLU7FyZiDNJbbYirJdOaRdGMZhXGfB_XNQhI9hSaKhxyugJIR3WiZPiuU9a1gvphmXUG3Jq3y8Xq7z2fUf8x1g';
