/** The landing page's copy, in one place. One sentence per feature; "Apple Home", "accessory". */

export const HERO = {
  title: 'Do more with your smart home.',
  subtitle: 'Control and share your Apple Home from Android, Windows and the web.',
};

export const APP_STORE_URL = 'https://apps.apple.com/gb/app/homecast-app/id6759559232?mt=12';
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=cloud.homecast.app';

export interface Feature {
  /** Keys the working demo in ./demos that stands where a screenshot would. */
  id: string;
  title: string;
  description: string;
}

export const FEATURES: Feature[] = [
  {
    id: 'sharing',
    title: 'Share with anyone',
    description: 'Give family, guests or tenants access to your home with a link, a passcode or an email invite — view-only or full control, a whole home or a single room.',
  },
  {
    id: 'ai',
    title: 'AI assistants',
    description: 'Control your home in plain language from Claude Desktop, Claude Code or ChatGPT — authorised per home over OAuth 2.1, revoked whenever you like.',
  },
  {
    id: 'api',
    title: 'REST, GraphQL & MCP',
    description: 'Scripts, custom dashboards or any other platform, through API tokens scoped to a home.',
  },
  {
    id: 'webhooks',
    title: 'Webhooks',
    description: 'Push state changes to Slack, Home Assistant, Zapier or your own server — HMAC-signed, retried with backoff, filtered by home, room or accessory.',
  },
  {
    id: 'home-assistant',
    title: 'Home Assistant',
    description: 'Install via HACS and your Apple Home accessories appear as native Home Assistant entities, alongside Zigbee, Z-Wave and everything else you run.',
  },
  {
    id: 'automations',
    title: 'Advanced automations',
    description: 'Chain triggers, conditions, delays and actions in a visual editor. It runs on the relay, so it keeps working with your browser closed.',
  },
  {
    id: 'analytics',
    title: 'Home Analytics',
    description: 'Opt-in recording of how your home changes over time, turned into highlights and charts — off by default, and on or off per home.',
  },
  {
    id: 'deals',
    title: 'Smart Deals',
    description: 'Prices tracked for your exact accessory models — deals, drops and all-time lows, right on the dashboard.',
  },
];
