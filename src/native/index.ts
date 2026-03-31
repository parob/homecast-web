/**
 * Native module exports
 */

export { HomeKit, isRelayCapable } from './homekit-bridge';
export type {
  HomeKitHome,
  HomeKitRoom,
  HomeKitZone,
  HomeKitServiceGroup,
  HomeKitAccessory,
  HomeKitService,
  HomeKitCharacteristic,
  HomeKitScene,
  HomeKitEvent,
  HomeKitError,
} from './homekit-bridge';

export { setupMenuBarBridge } from './menu-bar-bridge';
export type { MenuBarControlAPI, MenuBarSettings } from './menu-bar-bridge';

// Auto-initialize menu bar bridge when running in Mac app
import { isRelayCapable } from './homekit-bridge';
import { setupMenuBarBridge } from './menu-bar-bridge';

if (isRelayCapable()) {
  // Initialize after a short delay to ensure serverConnection is ready
  setTimeout(() => {
    setupMenuBarBridge();
  }, 100);
}
