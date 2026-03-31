import MarketingHeader from '@/components/marketing/MarketingHeader';
import MarketingFooter from '@/components/marketing/MarketingFooter';

interface Feature {
  title: string;
  description: string;
  image: string;
  imageAlt: string;
}

const FEATURES: Feature[] = [
  {
    title: 'Share With Anyone',
    description: 'Share via link, passcode, or email invite — no Apple device required.',
    image: '/images/features/sharing.png',
    imageAlt: 'Share dialog with link, passcode, and member options',
  },
  {
    title: 'REST, GraphQL & MCP APIs',
    description: 'Full programmatic access. Build scripts, integrations, and connect AI assistants.',
    image: '/images/features/api-access.png',
    imageAlt: 'API Access dialog showing MCP, GraphQL, and REST endpoints',
  },
  {
    title: 'AI Assistant Integration',
    description: 'Authorize Claude, ChatGPT, or any MCP agent to control your home via OAuth.',
    image: '/images/features/ai-assistants.png',
    imageAlt: 'OAuth consent page for Claude requesting home access',
  },
  {
    title: 'Real-Time Webhooks',
    description: 'Push signed events to any URL when devices change. Built-in retry and delivery tracking.',
    image: '/images/features/webhooks.png',
    imageAlt: 'Webhooks management with delivery stats',
  },
  {
    title: 'Smart Deals',
    description: 'Automatic price tracking matched to your devices. See deals and price history on your widgets.',
    image: '/images/features/smart-deals.png',
    imageAlt: 'Smart Deal popover with price history chart',
  },
  {
    title: 'Home Assistant',
    description: 'Bridge Apple Home and Home Assistant. Use HomeKit devices in HA dashboards, automations, and voice assistants.',
    image: '/images/features/home-assistant.png',
    imageAlt: 'Home Assistant dashboard showing Homecast devices by room',
  },
];

const Features = () => {
  return (
    <div className="min-h-screen bg-background relative">
      {/* Page-level background for hero */}
      <div className="absolute inset-x-0 top-0 h-[800px] -mt-[200px] pt-[200px] overflow-hidden">
        <img
          src="/backgrounds/abstract_mountains.png"
          alt=""
          className="w-full h-full object-cover opacity-15 dark:opacity-10"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-transparent to-background" />
      </div>

      <MarketingHeader />

      <main className="pt-16">
        {/* Hero */}
        <section className="w-full pt-16 md:pt-24 pb-8 px-6 relative">
          <div className="relative mx-auto max-w-4xl text-center">
            <h1 className="text-4xl md:text-5xl font-bold mb-6">Features</h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Everything you need to control your Apple Home devices from any platform.
            </p>
          </div>
        </section>

        {/* Dashboard hero screenshot */}
        <section className="w-full px-6 pb-12 relative">
          <div className="mx-auto max-w-5xl">
            <div className="rounded-xl border border-border/50 overflow-hidden bg-muted/50">
              <img
                src="/images/features/dashboard.png"
                alt="Homecast dashboard showing rooms with device widgets"
                className="w-full h-auto block"
              />
            </div>
            <p className="text-center text-sm text-muted-foreground mt-4">
              See and control every device from any browser, phone, or desktop.
            </p>
          </div>
        </section>

        {/* Feature grid with screenshots */}
        <section className="w-full py-12 px-6 bg-muted/30 border-t border-border/50">
          <div className="mx-auto max-w-5xl">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {FEATURES.map((feature) => (
                <div key={feature.title} className="rounded-xl border border-border bg-background overflow-hidden">
                  <div className="p-3 flex items-center justify-center bg-muted/30">
                    <img
                      src={feature.image}
                      alt={feature.imageAlt}
                      className="max-h-[180px] w-auto rounded-lg"
                      loading="lazy"
                    />
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold mb-1">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
};

export default Features;
