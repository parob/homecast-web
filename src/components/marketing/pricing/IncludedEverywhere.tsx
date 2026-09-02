/**
 * What every plan has, so no plan tile has to repeat it — and so the page can
 * state the differences alone. This replaced a full comparison matrix.
 */
import { Check } from 'lucide-react';

const CheckItem = ({ children }: { children: React.ReactNode }) => (
  <li className="flex items-center gap-2 text-sm">
    <Check className="h-4 w-4 text-green-500 shrink-0" />
    {children}
  </li>
);

const INCLUDED_EVERYWHERE = [
  'Automations',
  'Virtual Accessories',
  'Sharing',
  'REST & GraphQL API',
  'MCP (AI assistants)',
  'Webhooks',
  'Custom MQTT broker',
  'Home Assistant',
];

export function IncludedEverywhere() {
  return (
    <div className="rounded-2xl border border-border bg-muted/20 p-6 mt-10">
      <h3 className="text-base font-semibold mb-4">Every plan includes</h3>
      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2.5">
        {INCLUDED_EVERYWHERE.map((label) => (
          <CheckItem key={label}>{label}</CheckItem>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground mt-4">
        Community Edition: these work on your local network only — remote use requires Tailscale, Cloudflare Tunnel, or similar.
      </p>
    </div>
  );
}
