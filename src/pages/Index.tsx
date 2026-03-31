import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Home, Apple, Loader2, Lightbulb, Lock, Speaker, Volume2, Play, Monitor, Server, Cloud, Globe, ArrowRight, ArrowDown, Bell, Laptop, Tv, Thermometer, DoorOpen, DoorClosed, Blinds, Sun, Flame, ChevronUp, ChevronDown, Activity, X } from 'lucide-react';
import MarketingHeader from '@/components/marketing/MarketingHeader';
import MarketingFooter from '@/components/marketing/MarketingFooter';

// Diagram components for each API type
const GraphQLDiagram = () => (
  <svg className="w-full h-16" viewBox="0 0 200 60" fill="none">
    {/* Query box */}
    <rect x="5" y="15" width="50" height="30" rx="4" className="fill-pink-100 dark:fill-pink-900/50 stroke-pink-300 dark:stroke-pink-700" strokeWidth="1.5"/>
    <text x="30" y="34" textAnchor="middle" className="fill-pink-600 dark:fill-pink-400 text-[8px] font-medium">query</text>
    {/* Arrow */}
    <path d="M60 30 L85 30" className="stroke-pink-400" strokeWidth="2" strokeDasharray="3 2"/>
    <polygon points="85,30 80,26 80,34" className="fill-pink-400"/>
    {/* All devices (faded) */}
    <g className="opacity-30">
      <rect x="95" y="5" width="16" height="16" rx="3" className="fill-amber-200 dark:fill-amber-900"/>
      <rect x="95" y="22" width="16" height="16" rx="3" className="fill-zinc-200 dark:fill-zinc-800"/>
      <rect x="95" y="39" width="16" height="16" rx="3" className="fill-orange-200 dark:fill-orange-900"/>
    </g>
    {/* Arrow to selected */}
    <path d="M116 30 L135 30" className="stroke-pink-400" strokeWidth="2"/>
    <polygon points="135,30 130,26 130,34" className="fill-pink-400"/>
    {/* Selected device only (bright) */}
    <rect x="145" y="17" width="26" height="26" rx="4" className="fill-amber-100 dark:fill-amber-950/80 stroke-amber-400" strokeWidth="1.5"/>
    <circle cx="158" cy="30" r="6" className="fill-amber-400"/>
    {/* Checkmark */}
    <path d="M155 30 L157 33 L162 27" className="stroke-white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    {/* Label */}
    <text x="158" y="52" textAnchor="middle" className="fill-muted-foreground text-[6px]">exact data</text>
  </svg>
);

const RESTDiagram = () => (
  <svg className="w-full h-16" viewBox="0 0 200 60" fill="none">
    {/* Shortcuts icon */}
    <rect x="10" y="12" width="36" height="36" rx="8" className="fill-background stroke-border" strokeWidth="1.5"/>
    <rect x="18" y="20" width="8" height="8" rx="2" className="fill-red-400"/>
    <rect x="28" y="20" width="8" height="8" rx="2" className="fill-emerald-400"/>
    <rect x="18" y="30" width="8" height="8" rx="2" className="fill-blue-400"/>
    <rect x="28" y="30" width="8" height="8" rx="2" className="fill-amber-400"/>
    {/* POST request */}
    <rect x="55" y="22" width="32" height="16" rx="3" className="fill-emerald-500"/>
    <text x="71" y="33" textAnchor="middle" className="fill-white text-[7px] font-bold">POST</text>
    {/* Arrow */}
    <path d="M92 30 L115 30" className="stroke-emerald-400" strokeWidth="2"/>
    <polygon points="115,30 110,26 110,34" className="fill-emerald-400"/>
    {/* Homecast */}
    <rect x="120" y="18" width="24" height="24" rx="6" className="fill-primary"/>
    <path d="M132 25 L132 35 M127 30 L137 30" className="stroke-primary-foreground" strokeWidth="2" strokeLinecap="round"/>
    {/* Arrow to device */}
    <path d="M149 30 L165 30" className="stroke-emerald-400" strokeWidth="2"/>
    <polygon points="165,30 160,26 160,34" className="fill-emerald-400"/>
    {/* Light turns on */}
    <circle cx="180" cy="30" r="12" className="fill-amber-100 dark:fill-amber-950/80 stroke-amber-400" strokeWidth="1.5"/>
    <circle cx="180" cy="30" r="5" className="fill-amber-400"/>
    {/* Rays */}
    <g className="stroke-amber-400" strokeWidth="1" strokeLinecap="round">
      <line x1="180" y1="15" x2="180" y2="12"/>
      <line x1="180" y1="45" x2="180" y2="48"/>
      <line x1="165" y1="30" x2="162" y2="30"/>
      <line x1="195" y1="30" x2="198" y2="30"/>
    </g>
  </svg>
);

const MCPDiagram = () => (
  <svg className="w-full h-16" viewBox="0 0 200 60" fill="none">
    {/* AI Agent - purple gradient box with robot face */}
    <defs>
      <linearGradient id="aiGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#a855f7"/>
        <stop offset="100%" stopColor="#9333ea"/>
      </linearGradient>
    </defs>
    <rect x="10" y="10" width="36" height="36" rx="8" fill="url(#aiGradient)"/>
    <circle cx="22" cy="24" r="4" className="fill-white"/>
    <circle cx="34" cy="24" r="4" className="fill-white"/>
    <path d="M20 34 L36 34" className="stroke-white" strokeWidth="2" strokeLinecap="round"/>
    <rect x="18" y="48" width="20" height="8" rx="4" className="fill-purple-100 dark:fill-purple-900"/>
    <text x="28" y="54" textAnchor="middle" className="fill-purple-600 dark:fill-purple-400 text-[6px] font-bold">AI</text>

    {/* Connection line to MCP */}
    <path d="M50 28 L72 28" className="stroke-purple-400" strokeWidth="2"/>

    {/* MCP Icon in center */}
    <g transform="translate(75, 14)">
      <rect x="0" y="5" width="12" height="24" rx="2" className="fill-purple-500"/>
      <rect x="14" y="0" width="10" height="34" rx="2" className="fill-purple-500" fillOpacity="0.7"/>
      <rect x="26" y="5" width="12" height="24" rx="2" className="fill-purple-500" fillOpacity="0.5"/>
    </g>
    <text x="94" y="54" textAnchor="middle" className="fill-purple-500 text-[6px] font-bold">MCP</text>

    {/* Connection line to Home */}
    <path d="M116 28 L138 28" className="stroke-purple-400" strokeWidth="2"/>

    {/* Smart Home - dashed border with Homecast + devices */}
    <rect x="142" y="8" width="48" height="44" rx="6" className="fill-background stroke-border" strokeWidth="1.5" strokeDasharray="3 2"/>
    {/* Homecast logo */}
    <rect x="156" y="14" width="20" height="20" rx="5" className="fill-primary"/>
    <path d="M166 20 L166 28 M162 24 L170 24" className="stroke-primary-foreground" strokeWidth="2" strokeLinecap="round"/>
    {/* Device icons */}
    <circle cx="156" cy="42" r="5" className="fill-amber-100 dark:fill-amber-950/80"/>
    <circle cx="156" cy="42" r="2" className="fill-amber-400"/>
    <rect x="165" y="38" width="10" height="8" rx="2" className="fill-zinc-100 dark:fill-zinc-900"/>
    <circle cx="170" cy="42" r="1.5" className="fill-zinc-500"/>
  </svg>
);

const WebhookDiagram = () => (
  <svg className="w-full h-16" viewBox="0 0 200 60" fill="none">
    {/* Door with motion lines */}
    <rect x="10" y="10" width="30" height="40" rx="3" className="fill-zinc-100 dark:fill-zinc-900 stroke-zinc-400" strokeWidth="1.5"/>
    <circle cx="33" cy="30" r="2" className="fill-zinc-500"/>
    {/* Motion/event indicator */}
    <circle cx="25" cy="30" r="8" className="fill-amber-400 animate-ping opacity-30"/>
    <circle cx="25" cy="30" r="4" className="fill-amber-500"/>
    {/* Outgoing arrows fanning out */}
    <path d="M45 30 L65 30" className="stroke-amber-400" strokeWidth="2"/>
    <g className="stroke-amber-400" strokeWidth="1.5">
      <path d="M65 30 L90 15"/>
      <path d="M65 30 L90 30"/>
      <path d="M65 30 L90 45"/>
    </g>
    {/* Bell/notification hub */}
    <circle cx="65" cy="30" r="8" className="fill-amber-100 dark:fill-amber-950/80 stroke-amber-400" strokeWidth="1.5"/>
    <path d="M65 25 L65 32 M65 35 L65 35.5" className="stroke-amber-500" strokeWidth="1.5" strokeLinecap="round"/>
    {/* Destinations */}
    {/* Phone */}
    <rect x="95" y="8" width="14" height="22" rx="2" className="fill-background stroke-border" strokeWidth="1"/>
    <circle cx="102" cy="26" r="1.5" className="fill-muted-foreground"/>
    {/* Server */}
    <rect x="95" y="23" width="20" height="14" rx="2" className="fill-background stroke-border" strokeWidth="1"/>
    <line x1="98" y1="27" x2="112" y2="27" className="stroke-muted-foreground" strokeWidth="1"/>
    <line x1="98" y1="30" x2="108" y2="30" className="stroke-muted-foreground" strokeWidth="1"/>
    <circle cx="112" cy="33" r="1.5" className="fill-emerald-400"/>
    {/* Slack/chat */}
    <rect x="95" y="40" width="18" height="14" rx="3" className="fill-background stroke-border" strokeWidth="1"/>
    <circle cx="100" cy="47" r="2" className="fill-blue-400"/>
    <rect x="104" y="45" width="6" height="2" rx="1" className="fill-muted-foreground"/>
    <rect x="104" y="49" width="4" height="2" rx="1" className="fill-muted-foreground"/>
    {/* Instant label */}
    <text x="150" y="32" textAnchor="middle" className="fill-amber-500 text-[8px] font-semibold">instant</text>
    <text x="150" y="42" textAnchor="middle" className="fill-muted-foreground text-[6px]">push alerts</text>
  </svg>
);

const PortalDiagram = () => (
  <svg className="w-full h-16" viewBox="0 0 200 60" fill="none">
    {/* Globe */}
    <circle cx="25" cy="30" r="18" className="fill-blue-100 dark:fill-blue-950/50 stroke-blue-300 dark:stroke-blue-700" strokeWidth="1.5"/>
    <ellipse cx="25" cy="30" rx="8" ry="18" className="stroke-blue-300 dark:stroke-blue-700 fill-none" strokeWidth="1"/>
    <line x1="7" y1="30" x2="43" y2="30" className="stroke-blue-300 dark:stroke-blue-700" strokeWidth="1"/>
    <text x="25" y="53" textAnchor="middle" className="fill-muted-foreground text-[6px]">anywhere</text>
    {/* Secure connection */}
    <path d="M48 30 L68 30" className="stroke-blue-400" strokeWidth="2" strokeDasharray="3 2"/>
    <rect x="56" y="25" width="10" height="10" rx="2" className="fill-blue-500"/>
    <path d="M59 28 L59 32 M63 28 L63 32" className="stroke-white" strokeWidth="1.5" strokeLinecap="round"/>
    {/* Homecast */}
    <rect x="75" y="18" width="24" height="24" rx="6" className="fill-primary"/>
    <path d="M87 24 L87 34 M82 29 L92 29" className="stroke-primary-foreground" strokeWidth="2" strokeLinecap="round"/>
    {/* Sharing split */}
    <g className="stroke-blue-400" strokeWidth="1.5">
      <path d="M104 30 L120 30"/>
      <path d="M120 30 L140 15"/>
      <path d="M120 30 L140 30"/>
      <path d="M120 30 L140 45"/>
    </g>
    {/* Share node */}
    <circle cx="120" cy="30" r="5" className="fill-blue-500"/>
    <text x="120" y="32" textAnchor="middle" className="fill-white text-[6px] font-bold">S</text>
    {/* Different users */}
    {/* Family */}
    <circle cx="150" cy="15" r="8" className="fill-blue-100 dark:fill-blue-950/80 stroke-blue-300 dark:stroke-blue-700" strokeWidth="1"/>
    <circle cx="150" cy="13" r="3" className="fill-blue-400"/>
    <path d="M145 20 Q150 17 155 20" className="stroke-blue-400 fill-none" strokeWidth="1.5"/>
    {/* Guest */}
    <circle cx="155" cy="30" r="8" className="fill-emerald-100 dark:fill-emerald-950/80 stroke-emerald-300 dark:stroke-emerald-700" strokeWidth="1"/>
    <circle cx="155" cy="28" r="3" className="fill-emerald-400"/>
    <path d="M150 35 Q155 32 160 35" className="stroke-emerald-400 fill-none" strokeWidth="1.5"/>
    {/* Service */}
    <rect x="142" y="40" width="16" height="12" rx="2" className="fill-amber-100 dark:fill-amber-950/80 stroke-amber-300 dark:stroke-amber-700" strokeWidth="1"/>
    <circle cx="154" cy="46" r="2" className="fill-emerald-400"/>
    {/* Labels */}
    <text x="175" y="17" className="fill-muted-foreground text-[5px]">family</text>
    <text x="175" y="32" className="fill-muted-foreground text-[5px]">guests</text>
    <text x="175" y="48" className="fill-muted-foreground text-[5px]">services</text>
  </svg>
);

// API standard badge with logo, attached below widget with arrow - expands on hover
const ApiStandard = ({ type }: { type: 'graphql' | 'rest' | 'mcp' | 'webhook' | 'portal' }) => {
  const logos = {
    graphql: (
      <svg className="h-6 w-6" viewBox="0 0 100 100" fill="none">
        <path d="M50 5L87.5 27.5V72.5L50 95L12.5 72.5V27.5L50 5Z" stroke="currentColor" strokeWidth="6" fill="none"/>
        <circle cx="50" cy="5" r="6" fill="currentColor"/>
        <circle cx="87.5" cy="27.5" r="6" fill="currentColor"/>
        <circle cx="87.5" cy="72.5" r="6" fill="currentColor"/>
        <circle cx="50" cy="95" r="6" fill="currentColor"/>
        <circle cx="12.5" cy="72.5" r="6" fill="currentColor"/>
        <circle cx="12.5" cy="27.5" r="6" fill="currentColor"/>
      </svg>
    ),
    rest: (
      <div className="flex h-6 w-10 items-center justify-center rounded bg-current text-[8px] font-bold">
        <span className="text-white">REST</span>
      </div>
    ),
    mcp: (
      <svg className="h-6 w-6" viewBox="0 0 100 100" fill="none">
        <rect x="10" y="25" width="25" height="50" rx="4" fill="currentColor"/>
        <rect x="40" y="15" width="20" height="70" rx="4" fill="currentColor" fillOpacity="0.7"/>
        <rect x="65" y="25" width="25" height="50" rx="4" fill="currentColor" fillOpacity="0.5"/>
      </svg>
    ),
    webhook: <Bell className="h-6 w-6" />,
    portal: <Globe className="h-6 w-6" />,
  };

  const diagrams = {
    graphql: <GraphQLDiagram />,
    rest: <RESTDiagram />,
    mcp: <MCPDiagram />,
    webhook: <WebhookDiagram />,
    portal: <PortalDiagram />,
  };

  const configs = {
    graphql: {
      label: 'GraphQL',
      color: 'text-pink-500',
      bgColor: 'bg-pink-50 dark:bg-pink-950/50 border-pink-200 dark:border-pink-800',
      tagline: 'Request exactly what you need'
    },
    rest: {
      label: 'REST API',
      color: 'text-emerald-500',
      bgColor: 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800',
      tagline: 'Works with any app or script'
    },
    mcp: {
      label: 'MCP',
      color: 'text-purple-500',
      bgColor: 'bg-purple-50 dark:bg-purple-950/50 border-purple-200 dark:border-purple-800',
      tagline: 'AI controls your home naturally'
    },
    webhook: {
      label: 'Webhooks',
      color: 'text-amber-500',
      bgColor: 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800',
      tagline: 'Instant alerts when things change'
    },
    portal: {
      label: 'Homecast.cloud',
      color: 'text-blue-500',
      bgColor: 'bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800',
      tagline: 'Access anywhere, share securely'
    },
  };
  const config = configs[type];

  return (
    <div className="flex flex-col items-center mt-1">
      <ArrowDown className="h-5 w-5 text-muted-foreground/50 transition-transform duration-300 group-hover:scale-110" />
      <div className="relative mt-1">
        {/* Collapsed view */}
        <div className={`${config.color} flex flex-col items-center gap-1 transition-all duration-300 ease-out group-hover:opacity-0 group-hover:scale-75`}>
          {logos[type]}
          <span className="text-[10px] font-medium">{config.label}</span>
        </div>
        {/* Expanded view on hover */}
        <div className={`absolute top-0 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 p-4 rounded-xl border ${config.bgColor} w-[260px] transition-all duration-300 ease-out opacity-0 scale-50 origin-top group-hover:opacity-100 group-hover:scale-100`}>
          <div className={`${config.color} flex items-center gap-2`}>
            {logos[type]}
            <span className="text-sm font-semibold">{config.label}</span>
          </div>
          {/* Diagram */}
          <div className="w-full">
            {diagrams[type]}
          </div>
          {/* Short tagline */}
          <p className="text-[11px] text-muted-foreground text-center font-medium">{config.tagline}</p>
        </div>
      </div>
    </div>
  );
};

// Demo Light Widget - Full expanded view with slider (matches real LightbulbWidget)
const DemoLightWidget = ({ delay, position, className = "", apiType }: { delay: string; position: string; className?: string; apiType?: 'graphql' | 'rest' | 'mcp' | 'webhook' | 'portal' }) => (
  <div className={`group absolute ${position} animate-fade-in ${className} transition-all duration-300 hover:blur-none hover:opacity-100 hover:scale-105 hover:z-50`} style={{ animationDelay: delay }}>
    <div className="relative rounded-xl overflow-hidden bg-yellow-100/80 dark:bg-yellow-950/50 w-[min(260px,90vw)]">
      {/* Header */}
      <div className="p-4 pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="shrink-0 flex h-9 w-9 items-center justify-center rounded-2xl bg-yellow-400 text-yellow-900 shadow-sm">
              <Lightbulb className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium leading-tight truncate">Living Room</div>
              <div className="text-xs text-muted-foreground mt-0.5">75% brightness</div>
            </div>
          </div>
          <div className="h-5 w-9 rounded-full bg-yellow-400 relative">
            <div className="absolute right-0.5 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-white shadow-sm" />
          </div>
        </div>
      </div>
      {/* Content - Brightness slider */}
      <div className="px-4 pb-4 pt-2 space-y-4">
        <div className="flex items-center gap-3">
          <Sun className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex-1 h-2 rounded-full bg-yellow-200 dark:bg-yellow-900 overflow-hidden">
            <div className="h-full rounded-full bg-yellow-500" style={{ width: '75%' }} />
          </div>
          <span className="text-sm font-medium w-10 text-right">75%</span>
        </div>
      </div>
    </div>
    {apiType && <ApiStandard type={apiType} />}
  </div>
);

// Demo Lock Widget - Compact with standard toggle
const DemoLockWidget = ({ delay, position, isLocked = true, className = "", apiType }: { delay: string; position: string; isLocked?: boolean; className?: string; apiType?: 'graphql' | 'rest' | 'mcp' | 'webhook' | 'portal' }) => (
  <div className={`group absolute ${position} animate-fade-in ${className} transition-all duration-300 hover:blur-none hover:opacity-100 hover:scale-105 hover:z-50`} style={{ animationDelay: delay }}>
    <div className={`relative rounded-xl overflow-hidden ${isLocked ? 'bg-zinc-100/80 dark:bg-zinc-900/50' : 'bg-muted/30'}`}>
      <div className="p-2.5">
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <div className={`shrink-0 flex h-6 w-6 items-center justify-center rounded-lg ${isLocked ? 'bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900' : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'} shadow-sm`}>
              <Lock className="h-3 w-3" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-medium leading-tight truncate">Front Door</div>
            </div>
          </div>
          {/* Standard toggle */}
          <div className={`h-4 w-7 rounded-full ${isLocked ? 'bg-zinc-800 dark:bg-zinc-200' : 'bg-muted'} relative`}>
            <div className={`absolute ${isLocked ? 'right-0.5' : 'left-0.5'} top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-white shadow-sm`} />
          </div>
        </div>
      </div>
    </div>
    {apiType && <ApiStandard type={apiType} />}
  </div>
);

// Demo Thermostat Widget - Expanded with circular dial overlay (matches real ThermostatWidget)
const DemoThermostatWidget = ({ delay, position, className = "", apiType }: { delay: string; position: string; className?: string; apiType?: 'graphql' | 'rest' | 'mcp' | 'webhook' | 'portal' }) => (
  <div className={`group absolute ${position} animate-fade-in ${className} transition-all duration-300 hover:blur-none hover:opacity-100 hover:scale-105 hover:z-50`} style={{ animationDelay: delay }}>
    <div className="relative box-border rounded-xl overflow-hidden bg-orange-100/80 dark:bg-orange-950/50 w-[min(280px,90vw)] pr-[100px]">
      {/* Header */}
      <div className="p-4 pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="shrink-0 flex h-9 w-9 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-sm">
              <Flame className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium leading-tight truncate">Bedroom</div>
              <div className="text-xs text-muted-foreground mt-0.5">Current 19.5°C</div>
            </div>
          </div>
        </div>
      </div>
      {/* Content - Mode buttons */}
      <div className="px-4 pb-4 pt-2">
        <div className="flex gap-1">
          <button className="flex-1 h-7 px-3 text-xs rounded-md border border-transparent bg-orange-200 dark:bg-orange-900 flex items-center justify-center gap-1">
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            Off
          </button>
          <button className="flex-1 h-7 px-3 text-xs rounded-md border border-transparent bg-orange-500 text-white flex items-center justify-center gap-1">
            <Flame className="h-3 w-3" />
            Heat
          </button>
        </div>
      </div>
      {/* Circular dial - positioned as overlay on right */}
      <div className="absolute right-0 top-1/2 -translate-y-1/2 z-20">
        <div className="relative h-[120px] w-[120px]">
          <svg className="h-full w-full -rotate-90" viewBox="0 0 48 48">
            <circle cx="24" cy="24" r="18" fill="none" stroke="hsl(var(--muted))" strokeWidth="4" />
            <circle cx="24" cy="24" r="18" fill="none" stroke="#f97316" strokeWidth="4" strokeLinecap="round" strokeDasharray="113" strokeDashoffset="35" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold">21.0°</span>
            <span className="text-[9px] text-muted-foreground">Heat to</span>
          </div>
        </div>
      </div>
    </div>
    {apiType && <ApiStandard type={apiType} />}
  </div>
);

// Demo Blinds Widget - Expanded with visual slider overlay (matches real WindowCoveringWidget)
const DemoBlindsWidget = ({ delay, position, className = "", apiType }: { delay: string; position: string; className?: string; apiType?: 'graphql' | 'rest' | 'mcp' | 'webhook' | 'portal' }) => (
  <div className={`group absolute ${position} animate-fade-in ${className} transition-all duration-300 hover:blur-none hover:opacity-100 hover:scale-105 hover:z-50`} style={{ animationDelay: delay }}>
    <div className="relative box-border rounded-xl overflow-hidden bg-violet-100/80 dark:bg-violet-950/50 w-[min(350px,92vw)] pr-[150px]">
      {/* Header */}
      <div className="p-4 pb-2">
        <div className="flex items-center gap-2.5">
          <div className="shrink-0 flex h-9 w-9 items-center justify-center rounded-2xl bg-violet-500 text-white shadow-sm">
            <Blinds className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium leading-tight truncate">Office Blinds</div>
          </div>
        </div>
      </div>
      {/* Content - Status bubble */}
      <div className="px-4 pb-4 pt-2 flex items-center justify-center gap-2">
        <div className="px-3 py-1 rounded-full bg-muted text-sm font-medium">65% Open</div>
      </div>
      {/* Blind visual with buttons - positioned as overlay on right */}
      <div className="absolute right-3 top-1/2 -translate-y-1/2 z-20 flex items-center gap-2">
        {/* Curtain visual */}
        <div className="relative w-[100px] h-[80px] rounded-lg overflow-hidden" style={{ backgroundColor: '#ddd6fe' }}>
          {/* Window frame */}
          <div className="absolute inset-1 border-2 border-foreground/20 rounded" />
          {/* Window panes */}
          <div className="absolute inset-1 flex flex-col">
            <div className="flex-1 border-b border-foreground/10" />
            <div className="flex-1" />
          </div>
          <div className="absolute inset-1 flex">
            <div className="flex-1 border-r border-foreground/10" />
            <div className="flex-1" />
          </div>
          {/* Curtain/blind - drops from top */}
          <div className="absolute top-1 left-1 right-1 rounded-t" style={{ height: '35%', background: '#8b5cf6', minHeight: '4px' }}>
            <div className="absolute inset-0 flex flex-col justify-evenly opacity-30">
              {[0,1,2].map(i => <div key={i} className="h-px bg-black/30" />)}
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/10 rounded-b" />
          </div>
          {/* Position indicator */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-sm font-bold text-foreground/80 drop-shadow-sm">65%</span>
          </div>
        </div>
        {/* Up/down buttons */}
        <div className="flex flex-col gap-0.5">
          <button className="h-6 w-6 rounded border border-transparent bg-violet-200 dark:bg-violet-900 flex items-center justify-center">
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button className="h-6 w-6 rounded border border-transparent bg-violet-500 text-white flex items-center justify-center">
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
    {apiType && <ApiStandard type={apiType} />}
  </div>
);

// Demo Sensor Widget - Compact
const DemoSensorWidget = ({ delay, position, name, value, iconBg, cardBg, className = "" }: {
  delay: string;
  position: string;
  name: string;
  value: string;
  iconBg: string;
  cardBg: string;
  className?: string;
}) => (
  <div className={`absolute ${position} animate-fade-in ${className}`} style={{ animationDelay: delay }}>
    <div className={`relative rounded-xl overflow-hidden ${cardBg}`}>
      <div className="p-2.5">
        <div className="flex items-center gap-1.5">
          <div className={`shrink-0 flex h-6 w-6 items-center justify-center rounded-lg ${iconBg} text-white shadow-sm`}>
            <Thermometer className="h-3 w-3" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-medium leading-tight truncate">{name}</div>
          </div>
          <div className="ml-auto text-sm font-semibold">{value}</div>
        </div>
      </div>
    </div>
  </div>
);

// Demo Motion Sensor Widget - Compact
const DemoMotionSensorWidget = ({ delay, position, name, detected = false, className = "", apiType }: {
  delay: string;
  position: string;
  name: string;
  detected?: boolean;
  className?: string;
  apiType?: 'graphql' | 'rest' | 'mcp' | 'webhook' | 'portal';
}) => (
  <div className={`group absolute ${position} animate-fade-in ${className} transition-all duration-300 hover:blur-none hover:opacity-100 hover:scale-105 hover:z-50`} style={{ animationDelay: delay }}>
    <div className={`relative rounded-xl overflow-hidden ${detected ? 'bg-emerald-100/80 dark:bg-emerald-950/50' : 'bg-muted/50'}`}>
      <div className="p-2.5">
        <div className="flex items-center gap-1.5">
          <div className={`shrink-0 flex h-6 w-6 items-center justify-center rounded-lg ${detected ? 'bg-emerald-500' : 'bg-muted'} text-white shadow-sm`}>
            <Activity className="h-3 w-3" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-medium leading-tight truncate">{name}</div>
          </div>
          <div className={`ml-auto text-xs font-medium ${detected ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
            {detected ? 'Motion' : 'No motion'}
          </div>
        </div>
      </div>
    </div>
    {apiType && <ApiStandard type={apiType} />}
  </div>
);

// Demo Speaker Widget - Compact
const DemoSpeakerWidget = ({ delay, position, className = "" }: { delay: string; position: string; className?: string }) => (
  <div className={`absolute ${position} animate-fade-in ${className}`} style={{ animationDelay: delay }}>
    <div className="relative rounded-xl overflow-hidden bg-purple-100/80 dark:bg-purple-950/50">
      <div className="p-2.5">
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <div className="shrink-0 flex h-6 w-6 items-center justify-center rounded-lg bg-purple-500 text-white shadow-sm">
              <Speaker className="h-3 w-3" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-medium leading-tight truncate">HomePod</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Volume2 className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] font-medium">45%</span>
          </div>
        </div>
      </div>
    </div>
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

const Index = () => {
  const { isAuthenticated, isLoading } = useAuth();
  const [showAndroidModal, setShowAndroidModal] = React.useState(false);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }


  return (
    <div className="min-h-screen bg-background overflow-x-hidden max-w-[100vw]">
      {/* Android App Modal */}
      {showAndroidModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowAndroidModal(false)} />
          <div className="relative bg-background rounded-2xl border border-border shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-200">
            <button
              onClick={() => setShowAndroidModal(false)}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-500/10">
                <svg className="h-7 w-7 text-green-500" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 18c0 .55.45 1 1 1h1v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h2v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h1c.55 0 1-.45 1-1V8H6v10zM3.5 8C2.67 8 2 8.67 2 9.5v7c0 .83.67 1.5 1.5 1.5S5 17.33 5 16.5v-7C5 8.67 4.33 8 3.5 8zm17 0c-.83 0-1.5.67-1.5 1.5v7c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm-4.97-5.84l1.3-1.3c.2-.2.2-.51 0-.71-.2-.2-.51-.2-.71 0l-1.48 1.48A5.84 5.84 0 0012 1c-.96 0-1.86.23-2.66.63L7.85.15c-.2-.2-.51-.2-.71 0-.2.2-.2.51 0 .71l1.31 1.31A5.983 5.983 0 006 7h12c0-1.99-.97-3.75-2.47-4.84zM10 5H9V4h1v1zm5 0h-1V4h1v1z"/>
                </svg>
              </div>
              <h3 className="text-3xl font-bold">Android App</h3>
            </div>
            <p className="text-muted-foreground mb-4">
              The Homecast Android app requires either the <strong className="text-foreground">Homecast macOS app</strong> running as a relay or a <strong className="text-foreground">Cloud plan</strong> to work.
            </p>
            <p className="text-sm text-muted-foreground mb-6">
              The Android app is coming soon and we're looking for testers! Email <a href="mailto:rob@homecast.cloud" className="text-foreground underline">rob@homecast.cloud</a> for an invite.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setShowAndroidModal(false)} className="flex-1">
                Cancel
              </Button>
              <Button asChild className="flex-1 bg-green-600 hover:bg-green-700">
                <a href="mailto:rob@homecast.cloud" onClick={() => setShowAndroidModal(false)}>
                  Request Invite
                </a>
              </Button>
            </div>
          </div>
        </div>
      )}

      <MarketingHeader />

      {/* Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 h-64 w-64 rounded-full bg-violet-500/10 blur-3xl" />
        <div className="absolute top-1/2 left-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-orange-500/5 blur-3xl" />
      </div>

      {/* Hero — screenshots top, text + CTAs below */}
      <div className="relative mx-auto max-w-4xl px-6 pt-24 pb-12 lg:pt-32 lg:pb-16">
        {/* Screenshots */}
        <div className="grid gap-3 max-w-3xl mx-auto mb-10" style={{ gridTemplateColumns: '1fr 0.289fr' }}>
          <div className="rounded-xl border border-border/50 overflow-hidden bg-muted/50">
            <img src="/images/features/dashboard.png" alt="Homecast dashboard on desktop" className="w-full h-auto block" />
          </div>
          <div className="rounded-2xl border border-border/50 overflow-hidden bg-muted/50">
            <img src="/images/features/dashboard-mobile.png" alt="Homecast dashboard on mobile" className="w-full h-auto block" />
          </div>
        </div>

        {/* Text + CTAs */}
        <div className="text-center">
          <h1
            className="mb-4 font-bold tracking-tight text-3xl sm:text-5xl lg:text-6xl"
            style={{ fontFamily: "'Outfit', sans-serif" }}
          >
            Do more with your smart home.
          </h1>

          <p className="mb-8 text-lg text-muted-foreground max-w-lg mx-auto">
            Control and share your Apple Home devices from Android, Windows, or web browsers.
          </p>

          <div className="flex flex-wrap gap-3 items-center justify-center">
            {!isAuthenticated && (
              <Link to="/signup" className="inline-flex items-center gap-2 h-10 px-5 text-sm font-medium rounded-lg bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 transition-colors">
                <Home className="h-4 w-4" />
                Sign Up
              </Link>
            )}
            <a href="https://apps.apple.com/gb/app/homecast-app/id6759559232?mt=12" target="_blank" rel="noopener noreferrer" className="inline-block">
              <img src="/download_app_store.svg" alt="Download on the App Store" className="h-10 w-auto max-w-[44vw] sm:max-w-none" />
            </a>
            <button onClick={() => setShowAndroidModal(true)} className="inline-block">
              <img src="/download_google_play.svg" alt="Get it on Google Play" className="h-10 w-auto max-w-[44vw] sm:max-w-none" />
            </button>
          </div>
        </div>
      </div>

      {/* Features — alternating rows */}
      <section className="w-full px-6 border-t border-border/50">
        <div className="mx-auto max-w-4xl">
          {[
            {
              title: 'Share With Anyone',
              description: 'Give family, guests, or tenants access to your home — no Apple device or account required.',
              details: [
                'Public links, passcode-protected links, or email invites',
                'Role-based access: view-only or full control',
                'Share entire homes, specific rooms, or custom collections',
              ],
              image: '/images/features/sharing.png', imageAlt: 'Share dialog', reversed: false,
            },
            {
              title: 'Access via REST, GraphQL & MCP APIs',
              description: 'Full programmatic access to your smart home. Build scripts, custom dashboards, or integrate with any platform.',
              details: [
                'REST for quick scripts, GraphQL for precise queries',
                'Scoped API tokens with per-home permissions',
                'MCP endpoint for AI assistants like Claude and ChatGPT',
              ],
              image: '/images/features/api-access.png', imageAlt: 'API Access dialog', reversed: true,
            },
            {
              title: 'AI Assistant Integration',
              description: 'Control your home with natural language. Ask Claude to dim the lights, check the temperature, or run a scene.',
              details: [
                'Works with Claude Desktop, Claude Code, and ChatGPT',
                'Standard OAuth 2.1 — authorize per home, revoke anytime',
                'Three tools: get state, set state, run scene',
              ],
              image: '/images/features/ai-assistants.png', imageAlt: 'OAuth consent page', reversed: false,
            },
            {
              title: 'Real-Time Webhooks',
              description: 'Get notified instantly when devices change state. Push events to Slack, Home Assistant, Zapier, or your own server.',
              details: [
                'HMAC-SHA256 signed payloads for security',
                'Automatic retry with exponential backoff',
                'Filter by home, room, device, or event type',
              ],
              image: '/images/features/webhooks.png', imageAlt: 'Webhooks management', reversed: true,
            },
            {
              title: 'Smart Deals',
              description: 'Automatic price tracking matched to your exact devices. See deals, price drops, and all-time lows right on your dashboard.',
              details: [
                'Matched by manufacturer and model — no manual setup',
                'Price history charts with deal quality tiers',
                'Free with the free plan, optional on paid plans',
              ],
              image: '/images/features/smart-deals.png', imageAlt: 'Smart Deal popover', reversed: false,
            },
            {
              title: 'Advanced Automations',
              description: 'Build complex automations with a visual flow editor. Chain triggers, conditions, delays, and actions together.',
              details: [
                'Templates for common patterns like motion lights and schedules',
                'Supports device triggers, time-based schedules, and sun events',
                'Runs on the relay — works even when your browser is closed',
              ],
              image: '/images/features/automations.png', imageAlt: 'Automation flow editor', reversed: true,
            },
            {
              title: 'Home Assistant Integration',
              description: 'Bridge Apple Home and Home Assistant. Your HomeKit devices appear as native HA entities — ready for dashboards, automations, and voice assistants.',
              details: [
                'Install via HACS — no manual OAuth setup needed',
                'Lights, switches, thermostats, locks, blinds, sensors, and more',
                'Combine HomeKit devices with Zigbee, Z-Wave, and other HA integrations',
              ],
              image: '/images/features/home-assistant.png', imageAlt: 'Home Assistant dashboard showing Homecast devices', reversed: false, imageClass: 'max-w-[200px]',
            },
          ].map((feature) => (
            <div key={feature.title} className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 py-12 lg:py-16 items-center">
              <div className={`flex justify-center ${feature.reversed ? 'lg:order-2' : 'lg:order-1'}`}>
                <img src={feature.image} alt={feature.imageAlt} className="max-w-xs w-full h-auto rounded-lg bg-muted/50 border border-border/50" loading="lazy" />
              </div>
              <div className={`text-center lg:text-left ${feature.reversed ? 'lg:order-1' : 'lg:order-2'}`}>
                <h2 className="text-2xl font-bold mb-3">{feature.title}</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">{feature.description}</p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {feature.details.map((detail, i) => (
                    <li key={i} className="flex items-start gap-2 text-left">
                      <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                      <span>{detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
};

export default Index;
