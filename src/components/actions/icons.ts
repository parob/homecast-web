/**
 * Glyphs for the Actions catalog.
 *
 * Deliberately *not* in `catalog.ts`: that module's header states it stays free
 * of React and lucide so it can remain a pure, unit-testable function of the
 * accessory list. This is the thin lucide layer on top of its `HomeActionIcon`
 * union.
 */

import {
  Blinds, Fan, Lightbulb, Lock, Plug, Power, Shield, Thermometer,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { HomeActionIcon } from './catalog';
import type { HomeActionId } from '@/lib/summary-sections';

/** Matches AccessoryPicker's service-type icons, so a chip looks like its widgets. */
export const ACTION_ICONS: Record<HomeActionIcon, LucideIcon> = {
  lightbulb: Lightbulb,
  blinds: Blinds,
  lock: Lock,
  fan: Fan,
  outlet: Plug,
  thermostat: Thermometer,
  shield: Shield,
  power: Power,
};

/**
 * The icon for a pinned action, keyed by id rather than derived.
 *
 * A pinned tab has to draw itself before — and whether or not — the home's
 * accessories have loaded. Going through `deriveHomeActions` just to read
 * `action.icon` would leave the tab iconless on every cold start and flicker
 * once the list arrived.
 */
export const HOME_ACTION_TAB_ICONS: Record<HomeActionId, LucideIcon> = {
  lights: Lightbulb,
  blinds: Blinds,
  locks: Lock,
  fans: Fan,
  switches: Plug,
  'climate-off': Thermometer,
  security: Shield,
  'everything-off': Power,
};
