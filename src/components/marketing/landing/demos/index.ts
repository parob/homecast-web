/** Feature id → its working, basic version of the screenshot. */
import type { ComponentType } from 'react';
import { ShareDemo } from './ShareDemo';
import { ConsentDemo } from './ConsentDemo';
import { ApiAccessDemo } from './ApiAccessDemo';
import { WebhooksDemo } from './WebhooksDemo';
import { HomeAssistantDemo } from './HomeAssistantDemo';
import { AutomationDemo } from './AutomationDemo';
import { AnalyticsDemo } from './AnalyticsDemo';
import { DealsDemo } from './DealsDemo';

export { DashboardDemo } from './DashboardDemo';
export { MobileDashboardDemo } from './MobileDashboardDemo';
export { useHomeState } from './home-state';

export const DEMOS: Record<string, ComponentType> = {
  sharing: ShareDemo,
  ai: ConsentDemo,
  api: ApiAccessDemo,
  webhooks: WebhooksDemo,
  'home-assistant': HomeAssistantDemo,
  automations: AutomationDemo,
  analytics: AnalyticsDemo,
  deals: DealsDemo,
};
