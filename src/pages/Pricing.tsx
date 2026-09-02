import { FAQ, FAQItem } from '@/components/FAQ';
import MarketingHeader from '@/components/marketing/MarketingHeader';
import MarketingFooter from '@/components/marketing/MarketingFooter';
import { PlanSection } from '@/components/marketing/pricing/PlanSection';
import { Link } from 'react-router-dom';
import { usePricing } from '@/lib/pricing';

// True inside the App Store build (WKWebView host injects the flag); false
// in a regular browser. Used to swap external donation/sponsor links for
// neutral repo links — Apple Review flagged the former as 3.1.1 tipping.
const isInAppStoreBuild = typeof window !== 'undefined' && !!(window as any).isHomecastApp;

const Pricing = () => {
  const pricing = usePricing();

  // While native (StoreKit) prices are loading inside the App Store WKWebView,
  // render nothing rather than fall back to web prices. Anti-steering: don't
  // show the lower web price even momentarily inside the App Store build.
  if (!pricing) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading pricing…</div>
      </div>
    );
  }

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
        <section className="w-full pt-10 pb-24 px-6 relative">
          <div className="relative mx-auto max-w-6xl">
            <h1 className="text-center text-4xl font-bold mb-12">Simple Pricing</h1>

            <PlanSection pricing={pricing} />
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
                Users you invite via Home Sharing can view and control your accessories for free.
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
              <FAQItem question="Where can I find the source code?">
                Homecast Community is open source under the MIT licence. View the source,
                file issues, and follow development on{' '}
                <a href="https://github.com/parob/homecast" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">GitHub</a>.
              </FAQItem>
              {!isInAppStoreBuild && (
                <FAQItem question="Can I donate to support Homecast?">
                  Yes! The Community Edition is free and always will be. If you find it useful
                  and want to support ongoing development, you can{' '}
                  <a href="https://github.com/sponsors/parob" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">sponsor us on GitHub</a>.
                </FAQItem>
              )}
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
