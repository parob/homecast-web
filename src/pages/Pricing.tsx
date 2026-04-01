import { Laptop, Cloud, Check, Monitor, AlertTriangle, Heart, X } from 'lucide-react';
import { FAQ, FAQItem } from '@/components/FAQ';
import MarketingHeader from '@/components/marketing/MarketingHeader';
import MarketingFooter from '@/components/marketing/MarketingFooter';
import { Link } from 'react-router-dom';
import { getPricing } from '@/lib/pricing';

const CheckItem = ({ children }: { children: React.ReactNode }) => (
  <li className="flex items-center gap-2 text-sm">
    <Check className="h-4 w-4 text-green-500 shrink-0" />
    {children}
  </li>
);

type CellValue = boolean | string;

interface FeatureRow {
  label: string;
  community: CellValue;
  basic: CellValue;
  standard: CellValue;
  cloud: CellValue;
}

function FeatureCell({ value }: { value: CellValue }) {
  if (value === true) return <Check className="h-4 w-4 text-green-500 mx-auto" />;
  if (value === false) return <X className="h-4 w-4 text-muted-foreground/30 mx-auto" />;
  if (typeof value === 'string' && (value.startsWith('X ') || value.startsWith('✓ '))) {
    const isCheck = value.startsWith('✓');
    const note = value.slice(2);
    return (
      <span className="relative inline-flex justify-center">
        {isCheck
          ? <Check className="h-4 w-4 text-green-500" />
          : <X className="h-4 w-4 text-muted-foreground/30" />
        }
        <span className="absolute -right-3 -top-1 text-[10px] text-muted-foreground">{note}</span>
      </span>
    );
  }
  return <span className="text-sm text-muted-foreground">{value}</span>;
}

function FeatureMatrix({ pricing }: { pricing: { standard: { formatted: string }; cloud: { formatted: string } } }) {
  const features: FeatureRow[] = [
    { label: 'Price', community: 'Free', basic: 'Free', standard: `${pricing.standard.formatted}/mo`, cloud: `${pricing.cloud.formatted}/mo` },
    { label: 'Accessories', community: 'Unlimited', basic: '10', standard: 'Unlimited', cloud: 'Unlimited' },
    { label: 'Works without a Mac *', community: false, basic: false, standard: false, cloud: true },
    { label: 'Account required', community: false, basic: true, standard: true, cloud: true },
    { label: 'Remote access', community: 'X **', basic: true, standard: true, cloud: true },
    { label: 'Sharing', community: '✓ **', basic: true, standard: true, cloud: true },
    { label: 'REST & GraphQL API', community: '✓ **', basic: true, standard: true, cloud: true },
    { label: 'MCP (AI assistants)', community: '✓ **', basic: true, standard: true, cloud: true },
    { label: 'Webhooks', community: '✓ **', basic: true, standard: true, cloud: true },

    { label: 'Smart Deals', community: false, basic: true, standard: '✓ ***', cloud: '✓ ***' },
    { label: 'Ad-free', community: true, basic: false, standard: true, cloud: true },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="w-[200px]" />
            <th className="px-3" />
            <th colSpan={3} className="px-3 pb-1">
              <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground border border-border/60 border-b-0 rounded-t-lg py-1.5 bg-muted/30">
                <Cloud className="h-3 w-3" />
                Homecast Cloud
              </div>
            </th>
          </tr>
          <tr className="border-b border-border">
            <th className="text-left py-3 pr-4 font-medium text-muted-foreground w-[200px]" />
            <th className="py-3 px-3 font-semibold text-center">Community</th>
            <th className="py-3 px-3 font-semibold text-center border-x border-border/30">Basic</th>
            <th className="py-3 px-3 font-semibold text-center border-r border-border/30">Standard</th>
            <th className="py-3 px-3 font-semibold text-center">Cloud</th>
          </tr>
        </thead>
        <tbody>
          {features.map((row) => (
            <tr key={row.label} className="border-b border-border/50">
              <td className="py-3 pr-4 text-sm font-medium">{row.label}</td>
              <td className="py-3 px-3 text-center"><FeatureCell value={row.community} /></td>
              <td className="py-3 px-3 text-center"><FeatureCell value={row.basic} /></td>
              <td className="py-3 px-3 text-center"><FeatureCell value={row.standard} /></td>
              <td className="py-3 px-3 text-center"><FeatureCell value={row.cloud} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-xs text-muted-foreground mt-4 space-y-1">
        <p>* Community, Basic, and Standard require a Mac running the Homecast Relay app at all times.</p>
        <p>** Community Edition runs on your local network only. Remote access, sharing, API, MCP, and webhooks require Tailscale, Cloudflare Tunnel, or similar tools to work outside your home network.</p>
        <p>*** Smart Deals can be turned off in settings.</p>
      </div>
    </div>
  );
}

const Pricing = () => {
  const pricing = getPricing();

  return (
    <div className="min-h-screen bg-background relative">
      {/* Page-level background for hero - extends above fold for elastic scroll */}
      <div className="absolute inset-x-0 top-0 h-[800px] -mt-[200px] pt-[200px] overflow-hidden">
        <img
          src="/backgrounds/colourful_clouds.png"
          alt=""
          className="w-full h-full object-cover opacity-15 dark:opacity-10"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-transparent to-background" />
      </div>

      <MarketingHeader />

      <main className="pt-16">
        {/* Pricing Section */}
        <section className="w-full py-24 px-6 relative">
          <div className="relative mx-auto max-w-6xl">
            <h1 className="text-center text-4xl font-bold mb-12">Simple, Transparent Pricing</h1>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_3fr] gap-6">
              {/* Community Box — dark themed */}
              <div className="rounded-2xl border border-zinc-700 bg-zinc-900 p-4 sm:p-6">
                <div className="flex items-center gap-2 mb-1">
                  <Monitor className="h-5 w-5 text-zinc-400" />
                  <h3 className="text-lg font-semibold text-zinc-100">Community</h3>
                </div>
                <p className="text-sm text-zinc-400 mb-4 sm:mb-6">Local only</p>

                <div className="relative rounded-xl border border-zinc-700 bg-zinc-800 p-4 sm:p-5 flex flex-col">
                  <div className="mb-3 sm:mb-4">
                    <h4 className="text-base font-semibold text-zinc-100 mb-1">Community</h4>
                    <span className="text-2xl sm:text-3xl font-bold text-zinc-100">Free</span>
                  </div>
                  <ul className="space-y-2 flex-1">
                    <li className="text-sm text-zinc-400"><strong className="text-zinc-300">Unlimited</strong> accessories</li>
                    <li className="text-sm text-zinc-400">Local network access only</li>
                    <li className="text-sm text-zinc-400">No account required</li>
                  </ul>
                  <div className="mt-4 pt-3 border-t border-zinc-700 space-y-3">
                    <p className="text-xs text-zinc-400">
                      Remote access via Tailscale, Cloudflare Tunnel, or similar tools
                    </p>
                    <div className="flex items-start gap-1.5 text-xs text-zinc-400">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>Some technical knowledge required</span>
                    </div>
                    <div className="flex items-start gap-1.5 text-xs text-zinc-400">
                      <Heart className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>Donations welcome if you'd like to support development</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Homecast Cloud Box */}
              <div className="rounded-2xl border border-border bg-background/50 p-4 sm:p-6">
                <div className="flex items-center gap-2 mb-1">
                  <Cloud className="h-5 w-5 text-muted-foreground" />
                  <h3 className="text-lg font-semibold">Homecast Cloud</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-4 sm:mb-6">Remote access, sharing &amp; API &mdash; powered by homecast.cloud</p>

                <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-4">
                  {/* Self-Hosted Relay Sub-box */}
                  <div className="rounded-xl border border-border bg-background/30 p-3 sm:p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Laptop className="h-4 w-4 text-muted-foreground" />
                      <h4 className="text-sm font-semibold">Self-Hosted Relay</h4>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">Run the Homecast Relay on your Mac</p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Basic Tier */}
                      <div className="relative rounded-lg border border-border bg-background p-4 sm:p-5 flex flex-col">
                        <div className="mb-3 sm:mb-4">
                          <h5 className="text-base font-semibold mb-1">Basic</h5>
                          <span className="text-2xl sm:text-3xl font-bold">Free</span>
                        </div>
                        <ul className="space-y-2 flex-1">
                          <li className="text-sm text-muted-foreground">Limited to 10 accessories</li>
                          <li className="text-sm text-muted-foreground">Ad-supported with Smart Deals</li>
                        </ul>
                      </div>

                      {/* Standard Tier */}
                      <div className="relative rounded-lg border border-border bg-background p-4 sm:p-5 flex flex-col">
                        <div className="mb-3 sm:mb-4">
                          <h5 className="text-base font-semibold mb-1">Standard</h5>
                          <div className="flex items-baseline gap-1">
                            <span className="text-2xl sm:text-3xl font-bold">{pricing.standard.formatted}</span>
                            <span className="text-muted-foreground text-sm">/month</span>
                          </div>
                        </div>
                        <ul className="space-y-2 flex-1">
                          <CheckItem><strong>Unlimited</strong> accessories</CheckItem>
                          <CheckItem>Smart Deals optional</CheckItem>
                        </ul>
                      </div>
                    </div>
                  </div>

                  {/* Cloud Relay Sub-box */}
                  <div className="rounded-xl border border-border bg-background/30 p-3 sm:p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Cloud className="h-4 w-4 text-muted-foreground" />
                      <h4 className="text-sm font-semibold">Cloud Relay</h4>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">We run it for you</p>

                    {/* Cloud Tier */}
                    <div className="relative rounded-lg border border-border bg-background p-4 sm:p-5 flex flex-col h-[calc(100%-52px)]">
                      <div className="mb-3 sm:mb-4">
                        <h5 className="text-base font-semibold mb-1">Cloud</h5>
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl sm:text-3xl font-bold">{pricing.cloud.formatted}</span>
                          <span className="text-muted-foreground text-sm">/month</span>
                        </div>
                      </div>
                      <ul className="space-y-2 flex-1">
                        <CheckItem><strong>Unlimited</strong> accessories</CheckItem>
                        <CheckItem>No Mac required</CheckItem>
                        <CheckItem>Smart Deals optional</CheckItem>
                      </ul>
                      <p className="text-xs text-muted-foreground mt-3">Requires an Apple Home Hub (Apple TV or HomePod) on your home network.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Feature Comparison */}
        <section className="w-full py-16 px-6 border-t border-border/50">
          <div className="mx-auto max-w-4xl">
            <h2 className="text-center text-2xl font-bold mb-8">Compare Plans</h2>
            <FeatureMatrix pricing={pricing} />
          </div>
        </section>

        {/* FAQ */}
        <section className="w-full py-16 px-6">
          <div className="mx-auto max-w-3xl">
            <FAQ title="Pricing FAQ">
              <FAQItem question="What counts as an accessory?">
                Each HomeKit device counts as one accessory. A light bulb, thermostat, lock, or sensor each count as one.
                Bridges (like Hue Bridge) don't count—only the devices connected to them.
                Service groups count as a single accessory regardless of how many devices they contain.
              </FAQItem>
              <FAQItem question="What am I paying for with Standard if the app runs on my Mac?">
                Your Mac connects to Homecast Cloud, which provides secure remote access from anywhere,
                routes API requests, handles authentication, delivers real-time updates via WebSocket,
                and powers features like sharing and webhooks. You're also supporting ongoing development,
                new features, and platform maintenance.
              </FAQItem>
              <FAQItem question="Do shared users need a subscription?">
                No. Only the account running the Homecast relay app needs a subscription.
                Users you invite via Home Sharing can view and control your devices for free.
              </FAQItem>
              <FAQItem question="Will the Basic plan have ads?">
                The Basic plan is ad-supported and includes Smart Deals — personalised deal badges on your device widgets.
                Upgrading to Standard removes ads and lets you disable Smart Deals entirely.
              </FAQItem>
              <FAQItem question="Can I switch plans later?">
                Yes, upgrade or downgrade anytime. Changes take effect on your next billing cycle.
              </FAQItem>
              <FAQItem question="Why does Cloud cost more than Standard?">
                With Standard, your Mac runs the relay — we just provide the cloud infrastructure for remote access.
                With Cloud, we run the relay for you on real Apple hardware (Apple's HomeKit framework requires macOS).
                The difference in price reflects the cost of that dedicated hardware and maintenance.
              </FAQItem>
              <FAQItem question="Do I need a Mac for the Cloud plan?">
                No Mac required. With Cloud, we run the Homecast Relay for you. You just invite our
                service to your Apple Home and we handle the rest. You will need an Apple Home Hub (Apple TV or
                HomePod) in your home.
              </FAQItem>

              {/* Community Edition FAQs */}
              <FAQItem question="What is the Community Edition?">
                The Community Edition is free and runs entirely on your local network.
                It gives you unlimited accessories with no account or subscription required.
                The trade-off is that it only works on your home network — for remote access,
                you'll need to set up Tailscale, Cloudflare Tunnel, or similar.
              </FAQItem>
              <FAQItem question="Why does the Community Edition need to be installed from the App Store?">
                Apple restricts access to the HomeKit framework to apps distributed through the App Store.
                This is an Apple platform requirement, not a Homecast limitation — HomeKit entitlements
                are only granted to App Store builds, so there's no way to distribute a HomeKit-capable
                Mac app outside the App Store.
              </FAQItem>
              <FAQItem question="How do I access the Community Edition remotely?">
                The Community Edition only exposes a local HTTP server on your home network.
                To access it remotely, you'll need to set up a tunnel. Popular options
                include Tailscale (free for personal use) and Cloudflare Tunnel (free).
                These create a secure connection from the internet to your local Homecast
                instance without opening ports on your router.
              </FAQItem>
              <FAQItem question="What's the difference between Community and the cloud plans?">
                Community runs entirely on your local network with no Homecast servers involved.
                You get unlimited accessories and full control, but you're responsible for
                networking, uptime, and security. The cloud plans (Basic, Standard, Cloud) connect
                through homecast.cloud, which handles remote access, authentication, real-time
                syncing, home sharing, webhooks, and API access out of the box.
              </FAQItem>
              <FAQItem question="Can I donate to support Homecast?">
                Yes! The Community Edition is free and always will be. If you find it useful
                and want to support ongoing development, donations are welcome via
                GitHub Sponsors on the Homecast repository.
              </FAQItem>
            </FAQ>
            <div className="mt-10 text-center">
              <p className="text-sm text-muted-foreground mb-4">Have more questions?</p>
              <Link
                to="/how-it-works"
                className="text-sm font-medium text-primary hover:underline"
              >
                Learn how Homecast works →
              </Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
};

export default Pricing;
