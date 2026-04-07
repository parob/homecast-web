import { useState, useCallback, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Home, Lightbulb, LayoutGrid, Play, Share2, Settings, Sparkles, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { AccessoryWidget } from '@/components/widgets';
import type { HomeKitAccessory } from '@/lib/graphql/types';

const DOCS_BASE = 'https://docs.homecast.cloud';

function openDocLink(path: string) {
  const url = `${DOCS_BASE}${path}`;
  const w = window as Window & { webkit?: { messageHandlers?: { homecast?: { postMessage: (msg: { action: string; url?: string }) => void } } } };
  if (w.webkit?.messageHandlers?.homecast) {
    w.webkit.messageHandlers.homecast.postMessage({ action: 'openUrl', url });
  } else {
    window.open(url, '_blank');
  }
}

// Demo accessories for the tutorial — inline subset of screenshots/fixtures.ts
function ch(type: string, value: string | number | boolean | null, opts: { writable?: boolean; min?: number; max?: number; step?: number; validValues?: string[] } = {}) {
  return { id: `tut-${type}-${Math.random().toString(36).slice(2, 8)}`, characteristicType: type, value: value != null ? String(value) : null, isReadable: true, isWritable: opts.writable ?? true, minValue: opts.min, maxValue: opts.max, minStep: opts.step, validValues: opts.validValues, __typename: 'HomeKitCharacteristic' as const };
}
function svc(name: string, type: string, chars: ReturnType<typeof ch>[]) {
  return { id: `tut-svc-${Math.random().toString(36).slice(2, 8)}`, name, serviceType: type, characteristics: chars, __typename: 'HomeKitService' as const };
}

const DEMO_ACCESSORIES_BASE: HomeKitAccessory[] = [
  { id: 'tut-light', name: 'Ceiling Light', category: 'Lightbulb', isReachable: true, roomId: 'tut-room', roomName: 'Living Room', services: [svc('Ceiling Light', 'lightbulb', [ch('power_state', true), ch('brightness', 80, { min: 0, max: 100, step: 1 })])], __typename: 'HomeKitAccessory' },
  { id: 'tut-lock', name: 'Front Door', category: 'Door Lock', isReachable: true, roomId: 'tut-room2', roomName: 'Front Door', services: [svc('Front Door', 'lock_mechanism', [ch('lock_current_state', 1, { writable: false }), ch('lock_target_state', 1, { min: 0, max: 1 })])], __typename: 'HomeKitAccessory' },
  { id: 'tut-thermo', name: 'Thermostat', category: 'Thermostat', isReachable: true, roomId: 'tut-room', roomName: 'Living Room', services: [svc('Thermostat', 'thermostat', [ch('current_temperature', 20.5, { writable: false }), ch('target_temperature', 21, { min: 10, max: 30, step: 0.5 }), ch('heating_cooling_current', 1, { writable: false }), ch('heating_cooling_target', 1, { min: 0, max: 3, validValues: ['0', '1', '2', '3'] })])], __typename: 'HomeKitAccessory' },
] as any;

interface TutorialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

const TOTAL_STEPS = 7;

export function TutorialDialog({ open, onOpenChange, onComplete }: TutorialDialogProps) {
  const [step, setStep] = useState(0);

  // Local state for interactive demo widgets
  const [demoOverrides, setDemoOverrides] = useState<Record<string, Record<string, string>>>({});

  const demoAccessories = useMemo(() => {
    return DEMO_ACCESSORIES_BASE.map(acc => {
      const overrides = demoOverrides[acc.id];
      if (!overrides) return acc;
      return {
        ...acc,
        services: acc.services.map(svc => ({
          ...svc,
          characteristics: svc.characteristics.map(ch => {
            const ov = overrides[ch.characteristicType];
            return ov !== undefined ? { ...ch, value: ov } : ch;
          }),
        })),
      };
    });
  }, [demoOverrides]);

  const handleDemoToggle = useCallback((accessoryId: string, characteristicType: string, currentValue: boolean) => {
    setDemoOverrides(prev => ({
      ...prev,
      [accessoryId]: {
        ...(prev[accessoryId] || {}),
        [characteristicType]: String(!currentValue),
        // Sync lock display state
        ...(characteristicType === 'lock_target_state'
          ? { lock_current_state: String(currentValue ? 1 : 0) }
          : {}),
      },
    }));
  }, []);

  const handleDemoSlider = useCallback((accessoryId: string, characteristicType: string, value: number) => {
    setDemoOverrides(prev => ({
      ...prev,
      [accessoryId]: {
        ...(prev[accessoryId] || {}),
        [characteristicType]: String(value),
      },
    }));
  }, []);

  const getEffectiveValue = useCallback((_accessoryId: string, _charType: string, serverValue: any) => {
    return serverValue;
  }, []);

  const handleNext = useCallback(() => {
    if (step < TOTAL_STEPS - 1) {
      setStep(s => s + 1);
    } else {
      onComplete();
    }
  }, [step, onComplete]);

  const handleBack = useCallback(() => {
    setStep(s => Math.max(0, s - 1));
  }, []);

  const handleSkip = useCallback(() => {
    onComplete();
  }, [onComplete]);

  const handleClose = useCallback((isOpen: boolean) => {
    if (!isOpen) onComplete();
    onOpenChange(isOpen);
  }, [onComplete, onOpenChange]);

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <div className="flex flex-col items-center text-center space-y-4 py-4">
            <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-7 w-7 text-primary" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">Welcome to Homecast</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Let's take a quick tour of how to control your smart home. This will only take a minute.
              </p>
            </div>
          </div>
        );

      case 1:
        return (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Home className="h-5 w-5 text-primary" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold">Your Dashboard</h3>
                <p className="text-sm text-muted-foreground">
                  Your homes and rooms are in the sidebar. Select a home to see its rooms, then pick a room to see its devices.
                </p>
              </div>
            </div>
            {/* Mini sidebar mockup */}
            <div className="rounded-xl border bg-muted/30 p-3 space-y-1.5 text-sm max-w-[280px] mx-auto">
              <div className="font-medium text-xs text-muted-foreground uppercase tracking-wider px-1">Homes</div>
              <div className="rounded-lg bg-primary/10 border border-primary/20 px-3 py-2 font-medium flex items-center gap-2">
                <Home className="h-3.5 w-3.5 text-primary" />
                My Home
              </div>
              <div className="pl-4 space-y-0.5">
                <div className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted/50 flex items-center gap-2">
                  <span className="text-xs">Living Room</span>
                  <span className="text-[10px] text-muted-foreground/60 ml-auto">4</span>
                </div>
                <div className="rounded-md px-3 py-1.5 bg-muted/50 font-medium flex items-center gap-2">
                  <span className="text-xs">Bedroom</span>
                  <span className="text-[10px] text-muted-foreground/60 ml-auto">3</span>
                </div>
                <div className="rounded-md px-3 py-1.5 text-muted-foreground flex items-center gap-2">
                  <span className="text-xs">Kitchen</span>
                  <span className="text-[10px] text-muted-foreground/60 ml-auto">2</span>
                </div>
              </div>
            </div>
            <DocLink path="/getting-started/dashboard" />
          </div>
        );

      case 2:
        return (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Lightbulb className="h-5 w-5 text-primary" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold">Control Your Devices</h3>
                <p className="text-sm text-muted-foreground">
                  Each device appears as a widget. Try it — tap the toggle or drag the slider.
                </p>
              </div>
            </div>
            {/* Live interactive widgets */}
            <div className="grid grid-cols-3 gap-2">
              {demoAccessories.map(acc => (
                <AccessoryWidget
                  key={acc.id}
                  accessory={acc}
                  onToggle={handleDemoToggle}
                  onSlider={handleDemoSlider}
                  getEffectiveValue={getEffectiveValue}
                  compact
                />
              ))}
            </div>
            <DocLink path="/getting-started/dashboard" />
          </div>
        );

      case 3:
        return (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <LayoutGrid className="h-5 w-5 text-primary" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold">Collections</h3>
                <p className="text-sm text-muted-foreground">
                  Group devices from different rooms into custom views. Create an "All Lights" collection, a "Bedtime" shortcut, or anything you like.
                </p>
              </div>
            </div>
            {/* Collection illustration */}
            <div className="rounded-xl border bg-muted/30 p-3 space-y-2 max-w-[300px] mx-auto">
              <div className="font-medium text-xs text-muted-foreground uppercase tracking-wider px-1">Collections</div>
              {[
                { name: 'All Lights', count: 8, icon: '💡' },
                { name: 'Bedtime', count: 4, icon: '🌙' },
                { name: 'Away Mode', count: 6, icon: '🔒' },
              ].map(c => (
                <div key={c.name} className="rounded-lg border bg-background/60 px-3 py-2 flex items-center gap-2 text-sm">
                  <span>{c.icon}</span>
                  <span className="font-medium">{c.name}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">{c.count} devices</span>
                </div>
              ))}
            </div>
            <DocLink path="/guides/collections" />
          </div>
        );

      case 4:
        return (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Play className="h-5 w-5 text-primary" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold">Scenes</h3>
                <p className="text-sm text-muted-foreground">
                  Scenes control multiple devices at once. They sync automatically from your Apple Home app — just tap to run them.
                </p>
              </div>
            </div>
            {/* Scene cards illustration */}
            <div className="grid grid-cols-2 gap-2 max-w-[300px] mx-auto">
              {[
                { name: 'Good Morning', icon: '☀️' },
                { name: 'Good Night', icon: '🌙' },
                { name: 'Movie Time', icon: '🎬' },
                { name: 'Away', icon: '🏠' },
              ].map(s => (
                <div key={s.name} className="rounded-lg border bg-muted/30 px-3 py-2.5 flex items-center gap-2 text-sm hover:bg-muted/50 transition-colors cursor-default">
                  <span>{s.icon}</span>
                  <span className="font-medium text-xs">{s.name}</span>
                </div>
              ))}
            </div>
            <DocLink path="/getting-started/dashboard" />
          </div>
        );

      case 5:
        return (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Share2 className="h-5 w-5 text-primary" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold">Share Your Home</h3>
                <p className="text-sm text-muted-foreground">
                  Invite family members, create shareable links, or grant per-device access to guests. You control who sees and controls what.
                </p>
              </div>
            </div>
            {/* Sharing options illustration */}
            <div className="rounded-xl border bg-muted/30 p-3 space-y-2 max-w-[300px] mx-auto">
              {[
                { label: 'Invite members', desc: 'Full or view-only access', icon: '👤' },
                { label: 'Share link', desc: 'Anyone with the link', icon: '🔗' },
                { label: 'Passcode link', desc: 'Protected with a code', icon: '🔑' },
              ].map(o => (
                <div key={o.label} className="rounded-lg border bg-background/60 px-3 py-2 flex items-center gap-3 text-sm">
                  <span className="text-base">{o.icon}</span>
                  <div className="min-w-0">
                    <div className="font-medium text-xs">{o.label}</div>
                    <div className="text-[10px] text-muted-foreground">{o.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <DocLink path="/guides/sharing" />
          </div>
        );

      case 6:
        return (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Settings className="h-5 w-5 text-primary" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold">Make It Yours</h3>
                <p className="text-sm text-muted-foreground">
                  Customise your layout, choose background images, adjust icon styles, and more in Settings.
                </p>
              </div>
            </div>
            {/* Settings options illustration */}
            <div className="rounded-xl border bg-muted/30 p-3 space-y-1.5 text-sm max-w-[300px] mx-auto">
              {[
                { label: 'Layout', value: 'Grid / Masonry' },
                { label: 'Backgrounds', value: 'Per home or room' },
                { label: 'Icon style', value: 'Standard / Colourful' },
                { label: 'Compact mode', value: 'Smaller widgets' },
              ].map(s => (
                <div key={s.label} className="flex items-center justify-between px-2 py-1.5 rounded-md">
                  <span className="text-xs font-medium">{s.label}</span>
                  <span className="text-[10px] text-muted-foreground">{s.value}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground text-center">
              You can replay this tutorial anytime from Settings → Account.
            </p>
            <DocLink path="/getting-started/account" />
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="sm:max-w-md max-h-[85vh] overflow-y-auto"
        style={{ zIndex: 10050 }}
      >
        <DialogHeader>
          <DialogTitle className="sr-only">Homecast Tutorial</DialogTitle>
          <DialogDescription className="sr-only">Learn how to use Homecast</DialogDescription>
        </DialogHeader>

        <div className="py-1">
          {renderStep()}
        </div>

        {/* Footer: skip / dots / back+next */}
        <div className="flex items-center justify-between pt-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSkip}
            className="text-xs text-muted-foreground"
          >
            Skip
          </Button>

          {/* Step dots */}
          <div className="flex gap-1.5">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-200 ${
                  i === step ? 'w-4 bg-primary' : 'w-1.5 bg-muted-foreground/30'
                }`}
              />
            ))}
          </div>

          <div className="flex gap-1.5">
            {step > 0 && (
              <Button variant="ghost" size="sm" onClick={handleBack}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <Button size="sm" onClick={handleNext}>
              {step === TOTAL_STEPS - 1 ? 'Done' : (
                <>
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DocLink({ path }: { path: string }) {
  return (
    <button
      onClick={() => openDocLink(path)}
      className="flex items-center gap-1.5 text-xs text-primary hover:underline mx-auto"
    >
      Learn more
      <ExternalLink className="h-3 w-3" />
    </button>
  );
}
