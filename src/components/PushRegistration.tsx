/**
 * Registers this device's push token, on whichever platform it is running.
 *
 * Renders nothing. It lives beside the router rather than inside a page because
 * registration must not depend on which route the app happens to be showing —
 * the Mac relay registration this replaced ran off the WebSocket, so a Mac
 * parked on /analytics or /diagnostics still registered. Mounting it in a page
 * would quietly reintroduce that gap.
 *
 * Gated on being signed in: registration needs the JWT, and an unauthenticated
 * visitor should never see a notification permission prompt.
 */
import { useAuth } from '@/contexts/AuthContext';
import { useAndroidPush } from '@/hooks/useAndroidPush';
import { useApplePush } from '@/hooks/useApplePush';

const PushRegistrar = () => {
  useApplePush();
  useAndroidPush();
  return null;
};

export const PushRegistration = () => {
  const { user } = useAuth();
  if (!user) return null;
  return <PushRegistrar />;
};
