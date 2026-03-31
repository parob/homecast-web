import React from 'react';
import { Link } from 'react-router-dom';
import { Home, Lightbulb, Lock, Speaker, Smartphone, Cloud, Globe, ArrowRight, Bell, Laptop, Thermometer, DoorOpen } from 'lucide-react';
import { FAQ, FAQItem } from '@/components/FAQ';
import MarketingHeader from '@/components/marketing/MarketingHeader';
import MarketingFooter from '@/components/marketing/MarketingFooter';
// GraphQL Logo
const GraphQLLogo = () => (
  <svg className="h-6 w-6" viewBox="0 0 100 100" fill="none">
    <path d="M50 5L87.5 27.5V72.5L50 95L12.5 72.5V27.5L50 5Z" stroke="#E535AB" strokeWidth="4" fill="none"/>
    <circle cx="50" cy="5" r="5" fill="#E535AB"/>
    <circle cx="87.5" cy="27.5" r="5" fill="#E535AB"/>
    <circle cx="87.5" cy="72.5" r="5" fill="#E535AB"/>
    <circle cx="50" cy="95" r="5" fill="#E535AB"/>
    <circle cx="12.5" cy="72.5" r="5" fill="#E535AB"/>
    <circle cx="12.5" cy="27.5" r="5" fill="#E535AB"/>
  </svg>
);

// REST API Icon
const RestLogo = () => (
  <div className="flex h-6 w-6 items-center justify-center rounded bg-emerald-500 text-[8px] font-bold text-white">
    REST
  </div>
);

// MCP Logo
const MCPLogo = () => (
  <svg className="h-6 w-6" viewBox="0 0 100 100" fill="none">
    <rect x="10" y="25" width="25" height="50" rx="4" fill="#6366F1"/>
    <rect x="40" y="15" width="20" height="70" rx="4" fill="#8B5CF6"/>
    <rect x="65" y="25" width="25" height="50" rx="4" fill="#A855F7"/>
    <path d="M35 50H40M60 50H65" stroke="#C4B5FD" strokeWidth="3" strokeLinecap="round"/>
  </svg>
);

// Apple TV icon
const AppleTVIcon = () => (
  <svg className="h-6 w-6 text-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="13" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </svg>
);

// Mac mini icon
const MacMiniIcon = () => (
  <svg className="h-6 w-6 text-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="8" width="18" height="8" rx="2" />
    <circle cx="17" cy="12" r="1" fill="currentColor" stroke="none" />
    <line x1="6" y1="12" x2="10" y2="12" />
  </svg>
);

// Architecture Diagram Component
const ArchitectureDiagram = () => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const icon1Ref = React.useRef<HTMLDivElement>(null);
  const icon2Ref = React.useRef<HTMLDivElement>(null);
  const icon3Ref = React.useRef<HTMLDivElement>(null);
  const icon6Ref = React.useRef<HTMLDivElement>(null);
  const selfHostedRef = React.useRef<HTMLDivElement>(null);
  const cloudManagedRef = React.useRef<HTMLDivElement>(null);
  const card1Ref = React.useRef<HTMLDivElement>(null);
  const card2Ref = React.useRef<HTMLDivElement>(null);

  const [arrows, setArrows] = React.useState<Array<{ path: string; head: string }>>([]);
  const [relayArrows, setRelayArrows] = React.useState<Array<{ path: string; head: string }>>([]);

  React.useEffect(() => {
    const updatePaths = () => {
      if (!containerRef.current || !icon1Ref.current || !icon2Ref.current ||
          !icon3Ref.current || !icon6Ref.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const icons = [icon1Ref, icon2Ref, icon3Ref, icon6Ref].map(ref =>
        ref.current!.getBoundingClientRect()
      );

      const newArrows: Array<{ path: string; head: string }> = [];
      for (let i = 0; i < icons.length - 1; i++) {
        const from = icons[i];
        const to = icons[i + 1];
        const x1 = from.right - containerRect.left;
        const x2 = to.left - containerRect.left;
        // Always use the source icon's vertical center for a straight horizontal arrow
        const y = from.top - containerRect.top + from.height / 2;
        const finalPath = `M ${x1} ${y} L ${x2 - 8} ${y}`;
        const head = `${x2},${y} ${x2 - 8},${y - 5} ${x2 - 8},${y + 5}`;
        newArrows.push({ path: finalPath, head });
      }
      setArrows(newArrows);

      // Relay connecting arrows: selfHosted icons → card1, cloudManaged icon → card2
      if (selfHostedRef.current && cloudManagedRef.current && card1Ref.current && card2Ref.current) {
        const r = 10;

        // Arrow from Mac mini/MacBook area → Self-Hosted card
        const sh = selfHostedRef.current.getBoundingClientRect();
        const c1 = card1Ref.current.getBoundingClientRect();
        const startX1 = sh.left - containerRect.left + sh.width / 2;
        const startY1 = sh.bottom - containerRect.top;
        const endX1 = c1.left - containerRect.left + c1.width / 2;
        const endY1 = c1.top - containerRect.top;
        const midY1 = startY1 + (endY1 - startY1) / 2;
        const dir1 = endX1 < startX1 ? -1 : 1;
        const dx1 = Math.abs(endX1 - startX1);
        const path1 = dx1 < r * 2
          ? `M ${startX1} ${startY1} L ${startX1} ${endY1}`
          : `M ${startX1} ${startY1} L ${startX1} ${midY1 - r} Q ${startX1} ${midY1}, ${startX1 + dir1 * r} ${midY1} L ${endX1 - dir1 * r} ${midY1} Q ${endX1} ${midY1}, ${endX1} ${midY1 + r} L ${endX1} ${endY1}`;

        // Arrow from homecast.cloud icon → Cloud Managed card
        const cm = cloudManagedRef.current.getBoundingClientRect();
        const c2 = card2Ref.current.getBoundingClientRect();
        const startX2 = cm.left - containerRect.left + cm.width / 2;
        const startY2 = cm.bottom - containerRect.top;
        const endX2 = c2.left - containerRect.left + c2.width / 2;
        const endY2 = c2.top - containerRect.top;
        const midY2 = startY2 + (endY2 - startY2) / 2;
        const dir2 = endX2 < startX2 ? -1 : 1;
        const dx2 = Math.abs(endX2 - startX2);
        const path2 = dx2 < r * 2
          ? `M ${startX2} ${startY2} L ${startX2} ${endY2}`
          : `M ${startX2} ${startY2} L ${startX2} ${midY2 - r} Q ${startX2} ${midY2}, ${startX2 + dir2 * r} ${midY2} L ${endX2 - dir2 * r} ${midY2} Q ${endX2} ${midY2}, ${endX2} ${midY2 + r} L ${endX2} ${endY2}`;

        // Downward-pointing arrowheads at the end of each path
        const head1 = `${endX1},${endY1} ${endX1 - 5},${endY1 - 8} ${endX1 + 5},${endY1 - 8}`;
        const head2 = `${endX2},${endY2} ${endX2 - 5},${endY2 - 8} ${endX2 + 5},${endY2 - 8}`;
        setRelayArrows([{ path: path1, head: head1 }, { path: path2, head: head2 }]);
      }
    };

    updatePaths();
    window.addEventListener('resize', updatePaths);
    return () => window.removeEventListener('resize', updatePaths);
  }, []);

  return (
    <div className="p-8 pr-12">
      {/* Desktop layout */}
      <div ref={containerRef} className="hidden lg:block relative">
        <svg className="absolute inset-0 pointer-events-none overflow-visible" style={{ width: '100%', height: '100%' }}>
          {arrows.map((arrow, i) => (
            <g key={i}>
              <path d={arrow.path} stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" className="text-muted-foreground/50" fill="none" />
              <polygon className="text-muted-foreground/50" fill="currentColor" points={arrow.head} />
            </g>
          ))}
          {relayArrows.map((arrow, i) => (
            <g key={`relay-${i}`}>
              <path d={arrow.path} stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" className="text-muted-foreground/50" fill="none" />
              <polygon className="text-muted-foreground/50" fill="currentColor" points={arrow.head} />
            </g>
          ))}
        </svg>

        <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr 1.5fr 1fr' }}>
          <div className="flex flex-col items-center">
            <div className="flex h-[72px] items-center justify-center">
              <div className="relative w-[56px] h-[60px] flex items-center justify-center">
                <div ref={icon1Ref} className="absolute inset-0" />
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 72 80" fill="none">
                  <path d="M36 4 L68 28 C70 29.5 71 31 71 33 L71 70 C71 74 68 77 64 77 L8 77 C4 77 1 74 1 70 L1 33 C1 31 2 29.5 4 28 L36 4Z" className="fill-background stroke-border" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
                <div className="relative flex flex-col items-center mt-1">
                  <div className="mb-0.5"><Lightbulb className="h-3.5 w-3.5 text-amber-500" /></div>
                  <div className="flex gap-2 mb-0.5">
                    <Lock className="h-3.5 w-3.5 text-green-500" />
                    <Thermometer className="h-3.5 w-3.5 text-blue-500" />
                  </div>
                  <div className="flex gap-2">
                    <DoorOpen className="h-3.5 w-3.5 text-orange-500" />
                    <Speaker className="h-3.5 w-3.5 text-violet-500" />
                  </div>
                </div>
              </div>
            </div>
            <span className="text-sm font-medium mt-3">Your Smart Devices</span>
          </div>

          <div className="flex flex-col items-center">
            <div className="flex h-[72px] items-center justify-center">
              <div ref={icon2Ref} className="flex h-12 w-12 items-center justify-center rounded-xl bg-background border border-border p-2">
                <img src="/homekit_logo.png" alt="HomeKit" className="h-8 w-8" />
              </div>
            </div>
            <span className="text-sm font-medium mt-3 whitespace-nowrap">Apple Home Hub</span>
            <span className="text-xs text-muted-foreground text-center leading-relaxed max-w-[180px]">Required only if the Relay is running outside of your home network</span>
            <div className="flex gap-3 mt-2">
              <div className="flex flex-col items-center">
                <AppleTVIcon />
                <span className="text-[9px] text-muted-foreground">Apple TV</span>
              </div>
              <div className="flex flex-col items-center">
                <svg className="h-6 w-6 text-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 2C8.5 2 6 5 6 9v6c0 4 2.5 7 6 7s6-3 6-7V9c0-4-2.5-7-6-7z" />
                  <ellipse cx="12" cy="8" rx="2.5" ry="1.5" fill="currentColor" stroke="none" opacity="0.5" />
                </svg>
                <span className="text-[9px] text-muted-foreground">HomePod</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-center">
            <div className="flex h-[72px] items-center justify-center">
              <div ref={icon3Ref} className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/80 shadow-md shadow-primary/25">
                <Home className="h-6 w-6 text-primary-foreground" />
              </div>
            </div>
            <span className="text-base font-medium mt-3 whitespace-nowrap">Homecast Relay</span>
            <p className="text-[11px] text-muted-foreground text-center mt-1">Run on your own Mac or let us host it for you.</p>
            <div className="flex w-full justify-evenly mt-2">
              <div ref={selfHostedRef} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <MacMiniIcon />
                  <span className="text-[9px] text-muted-foreground">Mac mini</span>
                </div>
                <div className="flex flex-col items-center">
                  <Laptop className="h-6 w-6 text-foreground" />
                  <span className="text-[9px] text-muted-foreground">MacBook</span>
                </div>
              </div>
              <div ref={cloudManagedRef} className="flex flex-col items-center">
                <Cloud className="h-6 w-6 text-foreground" />
                <span className="text-[9px] text-muted-foreground">homecast.cloud</span>
              </div>
            </div>
          </div>

          {/* Protocols/Clients */}
          <div className="flex flex-col items-center">
            <div ref={icon6Ref} className="flex flex-col gap-2 p-3 rounded-2xl bg-background border border-border">
              <div className="flex items-center gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded bg-gradient-to-br from-primary to-primary/80">
                  <Home className="h-3 w-3 text-primary-foreground" />
                </div>
                <span className="text-[10px] font-medium">Homecast App</span>
              </div>
              <div className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-blue-500" />
                <span className="text-[10px] font-medium">Web</span>
              </div>
              <div className="flex items-center gap-2">
                <Smartphone className="h-5 w-5 text-green-500" />
                <span className="text-[10px] font-medium">iOS / Android</span>
              </div>
              <div className="flex items-center gap-2">
                <GraphQLLogo />
                <span className="text-[10px] font-medium">GraphQL</span>
              </div>
              <div className="flex items-center gap-2">
                <RestLogo />
                <span className="text-[10px] font-medium">REST API</span>
              </div>
              <div className="flex items-center gap-2">
                <MCPLogo />
                <span className="text-[10px] font-medium">MCP</span>
              </div>
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-amber-500" />
                <span className="text-[10px] font-medium">Webhooks</span>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Mobile layout */}
      <div className="flex lg:hidden flex-col items-center gap-4">
        <div className="flex flex-col items-center gap-2 max-w-[200px]">
          <div className="relative w-[72px] h-[80px] flex items-center justify-center">
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 72 80" fill="none">
              <path d="M36 4 L68 28 C70 29.5 71 31 71 33 L71 70 C71 74 68 77 64 77 L8 77 C4 77 1 74 1 70 L1 33 C1 31 2 29.5 4 28 L36 4Z" className="fill-background stroke-border" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            <div className="relative flex flex-col items-center mt-2">
              <div className="mb-0.5"><Lightbulb className="h-4 w-4 text-amber-500" /></div>
              <div className="flex gap-3 mb-0.5">
                <Lock className="h-4 w-4 text-green-500" />
                <Thermometer className="h-4 w-4 text-blue-500" />
              </div>
              <div className="flex gap-3">
                <DoorOpen className="h-4 w-4 text-orange-500" />
                <Speaker className="h-4 w-4 text-violet-500" />
              </div>
            </div>
          </div>
          <span className="text-base font-medium">Your Smart Devices</span>
        </div>

        <ArrowRight className="h-5 w-5 text-muted-foreground rotate-90" />

        <div className="flex flex-col items-center gap-2">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-background border border-border p-2">
            <img src="/homekit_logo.png" alt="HomeKit" className="h-10 w-10" />
          </div>
          <span className="text-base font-medium whitespace-nowrap">Apple Home Hub</span>
          <span className="text-xs text-muted-foreground text-center leading-relaxed">Required only if the Relay is running outside of your home network</span>
        </div>

        <ArrowRight className="h-5 w-5 text-muted-foreground rotate-90" />

        <div className="flex flex-col items-center gap-2">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/80 shadow-md shadow-primary/25">
            <Home className="h-6 w-6 text-primary-foreground" />
          </div>
          <span className="text-base font-medium whitespace-nowrap">Homecast Relay</span>
          <p className="text-[11px] text-muted-foreground text-center">Run on your own Mac or let us host it for you.</p>
        </div>

        <ArrowRight className="h-5 w-5 text-muted-foreground rotate-90" />

        {/* Access Methods */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex flex-col gap-2 p-3 rounded-2xl bg-background border border-border">
            <div className="flex items-center gap-2">
              <div className="flex h-5 w-5 items-center justify-center rounded bg-gradient-to-br from-primary to-primary/80">
                <Home className="h-3 w-3 text-primary-foreground" />
              </div>
              <span className="text-[10px] font-medium">Homecast App</span>
            </div>
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-blue-500" />
              <span className="text-[10px] font-medium">Web</span>
            </div>
            <div className="flex items-center gap-2">
              <Smartphone className="h-5 w-5 text-green-500" />
              <span className="text-[10px] font-medium">iOS / Android</span>
            </div>
            <div className="flex items-center gap-2">
              <GraphQLLogo />
              <span className="text-[10px] font-medium">GraphQL</span>
            </div>
            <div className="flex items-center gap-2">
              <RestLogo />
              <span className="text-[10px] font-medium">REST API</span>
            </div>
            <div className="flex items-center gap-2">
              <MCPLogo />
              <span className="text-[10px] font-medium">MCP</span>
            </div>
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-amber-500" />
              <span className="text-[10px] font-medium">Webhooks</span>
            </div>
          </div>
        </div>
      </div>

      {/* Relay option cards — visible on all screen sizes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-12 lg:mt-24 px-8">
        <div ref={card1Ref} className="p-6 rounded-2xl border border-border bg-background border-t-2 border-t-primary">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <Laptop className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Self-Hosted Relay</h3>
                <p className="text-sm text-muted-foreground">Run on your own Mac</p>
              </div>
            </div>
            <span className="bg-primary/10 text-primary text-xs font-medium px-2.5 py-0.5 rounded-full">Option 1</span>
          </div>
          <div className="space-y-3 mb-4">
            <div className="flex gap-3">
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold">1</div>
              <p className="text-sm">Install the Homecast Mac app</p>
            </div>
            <div className="flex gap-3">
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold">2</div>
              <p className="text-sm">Keep your Mac awake with the app running</p>
            </div>
          </div>
          <div className="border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">Best for: always-on Mac mini or MacBook</p>
          </div>
        </div>

        <div ref={card2Ref} className="p-6 rounded-2xl border border-border bg-background border-t-2 border-t-blue-500">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
                <Cloud className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Cloud Managed Relay</h3>
                <p className="text-sm text-muted-foreground">We run it for you</p>
              </div>
            </div>
            <span className="bg-blue-500/10 text-blue-500 text-xs font-medium px-2.5 py-0.5 rounded-full">Option 2</span>
          </div>
          <div className="space-y-3 mb-4">
            <div className="flex gap-3">
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white text-[10px] font-bold">1</div>
              <p className="text-sm">Sign up for Cloud Managed</p>
            </div>
            <div className="flex gap-3">
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white text-[10px] font-bold">2</div>
              <p className="text-sm">Invite Homecast to your Apple Home</p>
            </div>
          </div>
          <div className="border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">Best for: no Mac available · Apple Home Hub required</p>
          </div>
        </div>
      </div>
    </div>
  );
};

const HowItWorks = () => {
  return (
    <div className="min-h-screen bg-background relative">
      {/* Page-level background for hero - extends above fold for elastic scroll */}
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
        {/* Hero + Architecture Section */}
        <section className="w-full pt-16 md:pt-24 pb-24 px-6 relative">

          {/* Hero Content */}
          <div className="relative mx-auto max-w-4xl text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-bold mb-6">How Homecast Works</h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              The Homecast Relay connects to Apple Home and sends your device data to homecast.cloud — giving you control from any browser, phone, API, or AI assistant. Run the relay on your own Mac, or let us host it for you.
            </p>
          </div>

          {/* Architecture Diagram */}
          <div className="relative mx-auto max-w-5xl">
            <ArchitectureDiagram />
          </div>
        </section>

        {/* OLD Relay Options - kept for mobile only */}
        <section className="w-full py-16 px-6 border-t border-border/50 hidden">
          <div className="mx-auto max-w-5xl">

            <div className="grid md:grid-cols-2 gap-8">
              {/* Self-Hosted Path */}
              <div className="p-6 rounded-2xl border border-border bg-background border-t-2 border-t-primary transition-all duration-200 hover:border-primary/30 hover:shadow-lg dark:hover:shadow-primary/5">
                <div className="flex items-center gap-3 mb-6">
                  <span className="bg-primary/10 text-primary text-xs font-medium px-2.5 py-0.5 rounded-full">Option 1</span>
                </div>
                <div className="flex items-center gap-3 mb-6">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                    <Laptop className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold">Self-Hosted Relay</h3>
                    <p className="text-sm text-muted-foreground">Run on your own Mac</p>
                  </div>
                </div>

                <div className="space-y-4 mb-6">
                  <div className="flex gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">1</div>
                    <div>
                      <p className="text-sm font-medium">Install the Homecast Mac app</p>
                      <p className="text-xs text-muted-foreground">Uses Apple's native HomeKit framework</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">2</div>
                    <div>
                      <p className="text-sm font-medium">Keep your Mac awake with the app running</p>
                      <p className="text-xs text-muted-foreground">The app runs in the background as a menu bar item</p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="text-xs text-muted-foreground mb-3">Best for:</p>
                  <ul className="space-y-1.5 text-sm">
                    <li className="flex items-center gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
                      <span>Always-on Mac mini or MacBook</span>
                    </li>
                  </ul>
                </div>

                {/* Self-Hosted Diagram */}
                <div className="flex flex-col items-center gap-0 mt-6 pt-6 border-t border-border">
                  {/* Devices */}
                  <div className="flex flex-col items-center">
                    <div className="relative w-[56px] h-[64px] flex items-center justify-center">
                      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 56 64" fill="none">
                        <path d="M28 3 L53 22 C54.5 23.2 55 24.5 55 26 L55 56 C55 59 53 61 50 61 L6 61 C3 61 1 59 1 56 L1 26 C1 24.5 1.5 23.2 3 22 L28 3Z" className="fill-background stroke-border" strokeWidth="1.5" strokeLinejoin="round" />
                      </svg>
                      <div className="relative flex flex-col items-center mt-1.5">
                        <Lightbulb className="h-3.5 w-3.5 text-amber-500 mb-0.5" />
                        <div className="flex gap-2">
                          <Lock className="h-3.5 w-3.5 text-green-500" />
                          <Thermometer className="h-3.5 w-3.5 text-blue-500" />
                        </div>
                      </div>
                    </div>
                    <span className="text-xs font-medium mt-1.5">Your Smart Devices</span>
                  </div>

                  {/* Connector */}
                  <div className="flex flex-col items-center">
                    <div className="w-px h-6 border-l border-dashed border-muted-foreground/40" />
                    <ArrowRight className="h-3 w-3 text-muted-foreground/50 rotate-90" />
                  </div>

                  {/* HomeKit on Mac */}
                  <div className="flex flex-col items-center">
                    {/* Laptop frame */}
                    <div className="relative">
                      <svg className="w-[120px] h-[88px]" viewBox="0 0 120 88" fill="none">
                        {/* Screen */}
                        <rect x="16" y="4" width="88" height="58" rx="4" className="fill-background stroke-border" strokeWidth="1.5" />
                        {/* Base */}
                        <path d="M8 66 L112 66 L116 78 C116.5 79.5 115.5 81 114 81 L6 81 C4.5 81 3.5 79.5 4 78 L8 66Z" className="fill-muted stroke-border" strokeWidth="1.5" strokeLinejoin="round" />
                        {/* Trackpad notch */}
                        <rect x="50" y="65" width="20" height="3" rx="1.5" className="fill-border" />
                      </svg>
                      {/* Content inside screen */}
                      <div className="absolute top-[10px] left-0 right-0 flex items-center justify-center gap-1">
                        <img src="/homekit_logo.png" alt="HomeKit" className="h-7 w-7" />
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-primary to-primary/80 shadow-sm shadow-primary/25">
                          <Home className="h-3.5 w-3.5 text-primary-foreground" />
                        </div>
                      </div>
                    </div>
                    <span className="text-xs font-medium mt-1">Homecast Relay</span>
                    <span className="text-[10px] text-muted-foreground">running on your Mac</span>
                  </div>

                  {/* Connector */}
                  <div className="flex flex-col items-center">
                    <div className="w-px h-4 border-l border-dashed border-muted-foreground/40" />
                    <span className="text-[9px] text-muted-foreground/60 font-medium">WebSocket</span>
                    <div className="w-px h-4 border-l border-dashed border-muted-foreground/40" />
                    <ArrowRight className="h-3 w-3 text-muted-foreground/50 rotate-90" />
                  </div>

                  {/* Homecast Cloud */}
                  <div className="flex flex-col items-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-sm shadow-blue-500/25">
                      <Cloud className="h-5 w-5 text-white" />
                    </div>
                    <span className="text-xs font-medium mt-1.5">homecast.cloud</span>
                  </div>

                  {/* Connector */}
                  <div className="flex flex-col items-center">
                    <div className="w-px h-6 border-l border-dashed border-muted-foreground/40" />
                    <ArrowRight className="h-3 w-3 text-muted-foreground/50 rotate-90" />
                  </div>

                  {/* Access Methods */}
                  <div className="flex flex-col items-center">
                    <div className="flex gap-3 p-2.5 rounded-xl bg-background border border-border">
                      <Globe className="h-4 w-4 text-blue-500" />
                      <Smartphone className="h-4 w-4 text-green-500" />
                      <Bell className="h-4 w-4 text-amber-500" />
                      <div className="flex h-4 w-4 items-center justify-center rounded bg-gradient-to-br from-primary to-primary/80">
                        <Home className="h-2.5 w-2.5 text-primary-foreground" />
                      </div>
                    </div>
                    <span className="text-xs font-medium mt-1.5">Access your Devices, Anywhere</span>
                  </div>
                </div>
              </div>

              {/* Cloud Managed Path */}
              <div className="p-6 rounded-2xl border border-border bg-background border-t-2 border-t-blue-500 transition-all duration-200 hover:border-blue-500/30 hover:shadow-lg dark:hover:shadow-blue-500/5">
                <div className="flex items-center gap-3 mb-6">
                  <span className="bg-blue-500/10 text-blue-500 text-xs font-medium px-2.5 py-0.5 rounded-full">Option 2</span>
                </div>
                <div className="flex items-center gap-3 mb-6">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10">
                    <Cloud className="h-6 w-6 text-blue-500" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold">Cloud Managed Relay</h3>
                    <p className="text-sm text-muted-foreground">We run it for you</p>
                  </div>
                </div>

                <div className="space-y-4 mb-6">
                  <div className="flex gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white text-xs font-bold">1</div>
                    <div>
                      <p className="text-sm font-medium">Sign up for Cloud Managed</p>
                      <p className="text-xs text-muted-foreground">We provision a dedicated relay for you</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white text-xs font-bold">2</div>
                    <div>
                      <p className="text-sm font-medium">Invite Homecast to your Apple Home</p>
                      <p className="text-xs text-muted-foreground">Add our user to your existing Home via the Apple Home app</p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="text-xs text-muted-foreground mb-3">Best for:</p>
                  <ul className="space-y-1.5 text-sm">
                    <li className="flex items-center gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                      <span>No Mac available 24/7</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                      <span>Apple Home Hub required</span>
                    </li>
                  </ul>
                </div>

                {/* Cloud Managed Diagram */}
                <div className="flex flex-col items-center gap-0 mt-6 pt-6 border-t border-border">
                  {/* Devices */}
                  <div className="flex flex-col items-center">
                    <div className="relative w-[56px] h-[64px] flex items-center justify-center">
                      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 56 64" fill="none">
                        <path d="M28 3 L53 22 C54.5 23.2 55 24.5 55 26 L55 56 C55 59 53 61 50 61 L6 61 C3 61 1 59 1 56 L1 26 C1 24.5 1.5 23.2 3 22 L28 3Z" className="fill-background stroke-border" strokeWidth="1.5" strokeLinejoin="round" />
                      </svg>
                      <div className="relative flex flex-col items-center mt-1.5">
                        <Lightbulb className="h-3.5 w-3.5 text-amber-500 mb-0.5" />
                        <div className="flex gap-2">
                          <Lock className="h-3.5 w-3.5 text-green-500" />
                          <Thermometer className="h-3.5 w-3.5 text-blue-500" />
                        </div>
                      </div>
                    </div>
                    <span className="text-xs font-medium mt-1.5">Your Smart Devices</span>
                  </div>

                  {/* Connector */}
                  <div className="flex flex-col items-center">
                    <div className="w-px h-6 border-l border-dashed border-muted-foreground/40" />
                    <ArrowRight className="h-3 w-3 text-muted-foreground/50 rotate-90" />
                  </div>

                  {/* Apple Home Hub */}
                  <div className="flex flex-col items-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-background border border-border p-1.5">
                      <img src="/homekit_logo.png" alt="HomeKit" className="h-7 w-7" />
                    </div>
                    <span className="text-xs font-medium mt-1.5">Apple Home Hub</span>
                    <span className="text-[10px] text-muted-foreground">Apple TV or HomePod</span>
                  </div>

                  {/* Connector */}
                  <div className="flex flex-col items-center">
                    <div className="w-px h-4 border-l border-dashed border-muted-foreground/40" />
                    <span className="text-[9px] text-muted-foreground/60 font-medium">iCloud</span>
                    <div className="w-px h-4 border-l border-dashed border-muted-foreground/40" />
                    <ArrowRight className="h-3 w-3 text-muted-foreground/50 rotate-90" />
                  </div>

                  {/* Homecast App (Relay Mode) - cloud managed */}
                  <div className="flex flex-col items-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 shadow-sm shadow-primary/25">
                      <Home className="h-5 w-5 text-primary-foreground" />
                    </div>
                    <span className="text-xs font-medium mt-1.5">Homecast Relay</span>
                    <span className="text-[10px] text-muted-foreground">Hosted by Homecast</span>
                  </div>

                  {/* Connector */}
                  <div className="flex flex-col items-center">
                    <div className="w-px h-6 border-l border-dashed border-muted-foreground/40" />
                    <ArrowRight className="h-3 w-3 text-muted-foreground/50 rotate-90" />
                  </div>

                  {/* Homecast Cloud */}
                  <div className="flex flex-col items-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-sm shadow-blue-500/25">
                      <Cloud className="h-5 w-5 text-white" />
                    </div>
                    <span className="text-xs font-medium mt-1.5">homecast.cloud</span>
                  </div>

                  {/* Connector */}
                  <div className="flex flex-col items-center">
                    <div className="w-px h-6 border-l border-dashed border-muted-foreground/40" />
                    <ArrowRight className="h-3 w-3 text-muted-foreground/50 rotate-90" />
                  </div>

                  {/* Access Methods */}
                  <div className="flex flex-col items-center">
                    <div className="flex gap-3 p-2.5 rounded-xl bg-background border border-border">
                      <Globe className="h-4 w-4 text-blue-500" />
                      <Smartphone className="h-4 w-4 text-green-500" />
                      <Bell className="h-4 w-4 text-amber-500" />
                      <div className="flex h-4 w-4 items-center justify-center rounded bg-gradient-to-br from-primary to-primary/80">
                        <Home className="h-2.5 w-2.5 text-primary-foreground" />
                      </div>
                    </div>
                    <span className="text-xs font-medium mt-1.5">Access your Devices, Anywhere</span>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </section>

        {/* FAQ Section */}
        <section className="w-full pt-20 pb-16 px-6 bg-muted/30 border-t border-border/50">
          <div className="mx-auto max-w-3xl">
            <FAQ title="Frequently Asked Questions" collapsibleThreshold={100}>
              {/* Getting Started */}
              <div className="mt-2 mb-4">
                <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Getting Started</span>
              </div>

              <FAQItem question="Do I need an Apple Home Hub (Apple TV or HomePod)?">
                <p>
                  <strong>Cloud Managed:</strong> Yes — a Home Hub (Apple TV or HomePod) is required, since the
                  Relay runs remotely and needs iCloud to reach your devices.
                </p>
                <p className="mt-2">
                  <strong>Self-Hosted:</strong> Only if your Mac isn't on the same network as your devices.
                  If the Mac is on the same network, no Home Hub is needed.
                </p>
              </FAQItem>

              <FAQItem question="Will this affect my existing Apple Home setup?">
                <p>
                  No. Homecast is a read-only bridge to your HomeKit setup—it doesn't modify your Home configuration,
                  rooms, or scenes. You can continue using the Apple Home app, Siri, and all your existing automations
                  exactly as before.
                </p>
                <p className="mt-2">
                  Think of Homecast as an additional window into your smart home, not a replacement for Apple Home.
                </p>
              </FAQItem>

              <FAQItem question="Does my Mac need to be on all the time?">
                <p>
                  For the self-hosted option, yes—your Mac needs to be running and connected to your network for
                  Homecast to relay commands. A Mac mini is ideal for this since it's designed to run 24/7 with
                  minimal power consumption.
                </p>
                <p className="mt-2">
                  If you don't want to keep a Mac running, our Cloud Managed option handles everything for you
                  without requiring any hardware on your end.
                </p>
              </FAQItem>

              <FAQItem question="How do I get started?">
                <p>
                  Getting started is easy:
                </p>
                <ol className="mt-2 space-y-1 list-decimal list-inside">
                  <li>Create a free Homecast account</li>
                  <li>Download the Homecast app for Mac (or choose cloud-managed)</li>
                  <li>Sign in and grant HomeKit access</li>
                  <li>Start controlling your home from any device!</li>
                </ol>
                <p className="mt-2">
                  The free tier supports up to 10 accessories, so you can try everything before upgrading.
                </p>
              </FAQItem>

              <FAQItem question="What are the system requirements?">
                <p>
                  <strong>For the Mac app:</strong> macOS 13.0 (Ventura) or later
                </p>
                <p className="mt-2">
                  <strong>For web access:</strong> Any modern browser (Chrome, Firefox, Safari, Edge)
                </p>
                <p className="mt-2">
                  <strong>For iOS:</strong> iOS 16.0 or later
                </p>
                <p className="mt-2">
                  <strong>For Android:</strong> Android 8.0 or later (Coming soon)
                </p>
              </FAQItem>

              {/* Features & Compatibility */}
              <div className="mt-8 mb-4">
                <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Features & Compatibility</span>
              </div>

              <FAQItem question="How is this different from Homebridge?">
                <p>
                  Homebridge and Homecast solve different problems:
                </p>
                <ul className="mt-2 space-y-2">
                  <li><strong>Homebridge</strong> brings non-HomeKit devices INTO HomeKit (e.g., adding Nest cameras to Apple Home).</li>
                  <li><strong>Homecast</strong> brings HomeKit devices OUT to other platforms (e.g., controlling HomeKit from Android or a web browser).</li>
                </ul>
                <p className="mt-2">
                  They can work together—if you use Homebridge to add devices to HomeKit, Homecast can then
                  expose those devices to non-Apple platforms.
                </p>
              </FAQItem>

              <FAQItem question="Can I use this with multiple homes?">
                <p>
                  Yes! A single Homecast relay handles all the HomeKit homes your Apple ID has access to.
                  If you have a primary residence and a vacation home, one relay covers both—no need for
                  separate instances.
                </p>
              </FAQItem>

              <FAQItem question="What about HomeKit Secure Video?">
                <p>
                  HomeKit Secure Video cameras appear as accessories in Homecast, but video streaming is not
                  available through Homecast. Video recording and analysis continues to work through iCloud
                  and Apple Home as usual—Homecast doesn't interfere with that functionality.
                </p>
              </FAQItem>

              <FAQItem question="Can I share access with someone who doesn't have Homecast?">
                <p>
                  Yes! Share links work in any web browser—the recipient doesn't need to create an account
                  or install anything. They can view and control shared devices directly from the link.
                </p>
                <p className="mt-2">
                  For more control, you can require a passcode, set an expiration date, or limit sharing
                  to view-only mode.
                </p>
              </FAQItem>

              <FAQItem question="What devices work with Homecast?">
                <p>
                  Homecast works with <strong>any accessory you've already added to Apple Home</strong>. If it shows up in the Home app, it works with Homecast.
                </p>
                <p className="mt-2">
                  This includes: lights, switches, outlets, locks, thermostats, sensors, cameras, garage doors, blinds, fans,
                  speakers, air purifiers, humidifiers, irrigation systems, and more.
                </p>
                <p className="mt-2">
                  If you use Homebridge to add non-HomeKit devices to Apple Home, those will work with Homecast too.
                </p>
              </FAQItem>

              <FAQItem question="What APIs and protocols are supported?">
                <ul className="space-y-2">
                  <li><strong>GraphQL API:</strong> Query exactly the data you need for custom dashboards and apps</li>
                  <li><strong>REST API:</strong> Simple HTTP endpoints for scripts, Shortcuts, and quick integrations</li>

                  <li><strong>Webhooks:</strong> Get notified when devices change (HTTPS POST with HMAC-SHA256 signatures)</li>
                  <li><strong>MCP:</strong> Model Context Protocol for AI assistants like Claude</li>
                </ul>
                <p className="mt-3 text-sm"><strong>Webhook use cases:</strong> Log events to spreadsheets, send Slack/SMS alerts, connect to Zapier/Make/n8n, update Home Assistant or Grafana dashboards.</p>
                <div className="bg-muted rounded-lg p-3 mt-3">
                  <pre className="text-[10px] overflow-x-auto">
{`{
  "event": "characteristic.updated",
  "accessory": { "name": "Living Room Light" },
  "characteristic": { "type": "brightness", "value": 75 }
}`}
                  </pre>
                </div>
              </FAQItem>

              <FAQItem question="What's the latency and performance like?">
                <ul className="space-y-2">
                  <li><strong>Command latency:</strong> Less than 200ms typical</li>
                  <li><strong>Real-time updates:</strong> Less than 100ms propagation</li>
                  <li><strong>Heartbeat interval:</strong> 30 seconds</li>
                  <li><strong>Request timeout:</strong> 30 seconds</li>
                  <li><strong>Reconnection:</strong> Automatic with exponential backoff</li>
                </ul>
                <p className="mt-2">
                  Performance depends on your network conditions and distance from our servers.
                </p>
              </FAQItem>

              {/* Security & Reliability */}
              <div className="mt-8 mb-4">
                <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Security & Reliability</span>
              </div>

              <FAQItem question="Is my data secure?">
                <p>
                  Yes. Security is a top priority:
                </p>
                <ul className="mt-2 space-y-1">
                  <li>• All connections use TLS 1.3 encryption</li>
                  <li>• Authentication uses secure, revocable tokens</li>
                  <li>• Homecast Cloud routes commands but doesn't store your home data</li>
                  <li>• Shared links can be protected with passcodes and expiration dates</li>
                  <li>• You can see and revoke all active sessions at any time</li>
                </ul>
              </FAQItem>

              <FAQItem question="What happens if Homecast Cloud goes down?">
                <p>
                  If Homecast Cloud is unavailable, all Homecast functionality (web dashboard, API access,
                  remote control) will be temporarily unavailable. However, your Apple Home app and Siri
                  will continue to work normally since they don't depend on Homecast.
                </p>
              </FAQItem>

              <FAQItem question="How is the connection secured?">
                <ul className="space-y-2">
                  <li><strong>Transport:</strong> TLS 1.3 encryption for all connections</li>
                  <li><strong>Authentication:</strong> Bearer tokens (JWT) with configurable expiration</li>
                  <li><strong>Passcode hashing:</strong> PBKDF2 with 100,000 iterations</li>
                  <li><strong>Webhook signatures:</strong> HMAC-SHA256 for payload verification</li>
                </ul>
                <p className="mt-2">
                  Your HomeKit data is never transmitted in plain text, and we don't store your device states on our servers.
                </p>
              </FAQItem>
            </FAQ>
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="w-full py-20 px-6 border-t border-border/50">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold mb-4">Ready to get started?</h2>
            <p className="text-muted-foreground mb-8">
              Create a free account and extend your Apple Home setup to every platform.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Link
                to="/signup"
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Create Account
              </Link>
              <a
                href="https://docs.homecast.cloud"
                className="inline-flex items-center gap-2 rounded-lg border border-border px-6 py-2.5 text-sm font-medium hover:bg-muted transition-colors"
              >
                Read the Docs
              </a>
            </div>
          </div>
        </section>

      </main>

      <MarketingFooter />
    </div>
  );
};

export default HowItWorks;
