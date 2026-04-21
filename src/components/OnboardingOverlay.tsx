import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Monitor, Cloud, Users, ArrowLeft, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { getPricing, getRegion } from '@/lib/pricing';
import { CREATE_CHECKOUT_SESSION, ACCEPT_HOME_INVITATION, REJECT_HOME_INVITATION } from '@/lib/graphql/mutations';
import { GET_PENDING_INVITATIONS } from '@/lib/graphql/queries';
import type { CreateCheckoutSessionResponse, GetPendingInvitationsResponse, PendingInvitation } from '@/lib/graphql/types';
import { toast } from 'sonner';
import { config } from '@/lib/config';

export type SetupPath = 'mac-relay' | 'cloud-relay' | 'shared-home' | 'skipped';

type WizardStep = 'intent' | 'mac-setup' | 'cloud-setup' | 'shared-home';

interface OnboardingOverlayProps {
  isInMacApp: boolean;
  isInMobileApp?: boolean;
  onComplete: (setupPath: SetupPath, enrollmentId?: string) => void;
  onUpgradeStandard: () => void;
  userEmail: string;
  onInvalidateHomes?: () => void;
  cloudSignupsAvailable?: boolean;
  accountType?: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    const win = window as Window & { webkit?: { messageHandlers?: { homecast?: { postMessage: (msg: { action: string; text?: string }) => void } } } };
    if (win.webkit?.messageHandlers?.homecast) {
      win.webkit.messageHandlers.homecast.postMessage({ action: 'copy', text });
    } else {
      navigator.clipboard.writeText(text);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);
  return (
    <button onClick={handleCopy} className="text-xs px-2 py-1 rounded hover:bg-muted transition-colors">
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
    </button>
  );
}

function CollapsibleHelp({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border bg-muted/30">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
        {title}
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && <div className="px-3 pb-3 text-xs text-muted-foreground space-y-1">{children}</div>}
    </div>
  );
}

function IntentStep({ isInMacApp, isInMobileApp, onSelect, onSkip, pricing, cloudSignupsAvailable = true }: {
  isInMacApp: boolean;
  isInMobileApp?: boolean;
  onSelect: (step: WizardStep) => void;
  onSkip: () => void;
  pricing: ReturnType<typeof getPricing>;
  cloudSignupsAvailable?: boolean;
}) {
  const macLabel = isInMacApp ? 'Use this Mac as your relay' : 'I have a Mac at home';
  const macDescription = isInMacApp
    ? 'Your Mac needs to stay on for remote access to work.'
    : 'Use your Mac as a HomeKit relay. Your Mac needs to stay on for remote access.';

  return (
    <div className="space-y-3 py-2">
      <button onClick={() => onSelect('mac-setup')} className="w-full text-left rounded-lg border p-4 space-y-1.5 hover:border-primary/50 transition-colors">
        <div className="flex items-center gap-2">
          <Monitor className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{macLabel}</span>
        </div>
        <p className="text-xs text-muted-foreground">{macDescription}</p>
        <p className="text-xs text-muted-foreground">
          Free · 10 accessories
          <span className="mx-1.5">·</span>
          Standard · {pricing.standard.formatted}/mo · unlimited
        </p>
      </button>

      <button
        onClick={() => cloudSignupsAvailable && onSelect('cloud-setup')}
        className={`w-full text-left rounded-lg border p-4 space-y-1.5 transition-colors ${cloudSignupsAvailable ? 'hover:border-primary/50' : 'opacity-60 cursor-default'}`}
      >
        <div className="flex items-center gap-2">
          <Cloud className="h-4 w-4 text-blue-500" />
          <span className="text-sm font-medium">Set up a cloud relay</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {isInMacApp
            ? "Always on \u2014 your Mac doesn't need to stay running."
            : "We run a relay for you \u2014 no Mac needed. Always on, even when your computer is off."}
        </p>
        <p className="text-xs text-muted-foreground">
          {cloudSignupsAvailable ? `${pricing.cloud.formatted}/mo · unlimited accessories` : 'Signups paused — at capacity'}
        </p>
        <p className="text-xs text-amber-600">Requires an Apple Home Hub (Apple TV or HomePod)</p>
      </button>

      <button onClick={() => onSelect('shared-home')} className="w-full text-left rounded-lg border p-4 space-y-1.5 hover:border-primary/50 transition-colors">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Someone shared a home with me</span>
        </div>
        <p className="text-xs text-muted-foreground">Join a home you've been invited to.</p>
      </button>

      {!isInMacApp && (
        <button onClick={onSkip} className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors py-2">
          Skip — I'll explore first
        </button>
      )}
    </div>
  );
}

function MacSetupStep({ isInMacApp, isInMobileApp, onComplete, onUpgradeStandard, onBack, pricing, accountType }: {
  isInMacApp: boolean;
  isInMobileApp?: boolean;
  onComplete: () => void;
  onUpgradeStandard: () => void;
  onBack: () => void;
  pricing: ReturnType<typeof getPricing>;
  accountType?: string;
}) {
  const openAppStore = useCallback(() => {
    const w = window as any;
    if (w.webkit?.messageHandlers?.homecast) {
      w.webkit.messageHandlers.homecast.postMessage({ action: 'openUrl', url: config.appStoreUrl });
    } else {
      window.open(config.appStoreUrl, '_blank');
    }
  }, []);

  return (
    <div className="space-y-4 py-2">
      {!isInMacApp && (
        <>
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={openAppStore} className="gap-2">
              <svg viewBox="0 0 384 512" className="h-4 w-4" fill="currentColor"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5c0 26.2 4.8 53.3 14.4 81.2 12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" /></svg>
              Download on the App Store
            </Button>
          </div>

          <div className="space-y-1.5 text-xs text-muted-foreground">
            <p>1. Download Homecast for Mac from the App Store</p>
            <p>2. Open it and sign in — it connects automatically</p>
            {isInMobileApp
              ? <p>3. Then open this app to control your home remotely</p>
              : <p>3. This page updates when your Mac connects</p>
            }
          </div>

          <div className="border-t" />
        </>
      )}

      {isInMacApp && (
        <p className="text-sm text-center text-muted-foreground">
          Your Mac is connected and ready to relay your HomeKit devices. Keep it running for remote access.
        </p>
      )}

      {accountType === 'standard' ? (
        <div className="rounded-lg border border-primary/50 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Standard</h3>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600">Current plan</span>
          </div>
          <p className="text-xs text-muted-foreground">Unlimited accessories · {pricing.standard.formatted}/mo</p>
          <Button size="sm" className="w-full text-xs" onClick={onComplete}>
            Continue
          </Button>
        </div>
      ) : (
        <>
          <p className="text-xs font-medium text-muted-foreground">Choose your plan:</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border p-3 space-y-2 flex flex-col">
              <h3 className="text-sm font-medium">Basic</h3>
              <p className="text-xs text-muted-foreground flex-1">10 accessories</p>
              <p className="text-sm font-medium">Free</p>
              <Button variant="outline" size="sm" className="w-full text-xs" onClick={onComplete}>
                Get started
              </Button>
            </div>
            <div className="rounded-lg border border-primary/50 p-3 space-y-2 flex flex-col">
              <h3 className="text-sm font-medium">Standard</h3>
              <p className="text-xs text-muted-foreground flex-1">Unlimited accessories</p>
              <p className="text-sm font-medium">{pricing.standard.formatted}/mo</p>
              <Button size="sm" className="w-full text-xs" onClick={() => { onComplete(); onUpgradeStandard(); }}>
                Subscribe
              </Button>
            </div>
          </div>
        </>
      )}

      {!isInMacApp && (
        <p className="text-xs text-muted-foreground text-center">
          Your Mac must stay on for remote access to work.
        </p>
      )}

      <Button variant="ghost" size="sm" className="w-full text-xs" onClick={onBack}>
        <ArrowLeft className="h-3 w-3 mr-1" /> Back
      </Button>
    </div>
  );
}

function CloudSetupStep({ onComplete, onBack, pricing, cloudSignupsAvailable = true }: {
  onComplete: (enrollmentId?: string) => void;
  onBack: () => void;
  pricing: ReturnType<typeof getPricing>;
  cloudSignupsAvailable?: boolean;
}) {
  const [homeName, setHomeName] = useState('');
  const [loading, setLoading] = useState(false);
  const pricingRegion = getRegion();

  const [createCheckout] = useMutation<CreateCheckoutSessionResponse>(CREATE_CHECKOUT_SESSION);

  const handleCheckout = useCallback(async () => {
    if (!homeName.trim()) {
      toast.error('Please enter your home name');
      return;
    }
    setLoading(true);
    try {
      const { data } = await createCheckout({
        variables: { plan: 'cloud', homeName: homeName.trim(), region: pricingRegion },
      });
      const result = data?.createCheckoutSession;
      if (result?.url) {
        window.location.href = result.url;
      } else if (result?.upgraded) {
        toast.success('Cloud relay activated!');
        onComplete();
      } else if (result?.error) {
        toast.error(result.error);
      }
    } catch {
      toast.error('Failed to start checkout');
    } finally {
      setLoading(false);
    }
  }, [homeName, pricingRegion, createCheckout, onComplete]);

  if (!cloudSignupsAvailable) {
    return (
      <div className="space-y-4 py-2">
        <div className="rounded-lg border p-4 space-y-2 text-center">
          <Cloud className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="text-sm font-medium">Cloud relay is at capacity</p>
          <p className="text-xs text-muted-foreground">
            We're currently at capacity for new cloud relay signups. Please check back soon.
          </p>
        </div>
        <Button variant="ghost" size="sm" className="w-full text-xs" onClick={onBack}>
          <ArrowLeft className="h-3 w-3 mr-1" /> Back
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 py-2">
      <p className="text-sm text-muted-foreground">
        We'll run a relay for you so your smart home is always accessible — even when your Mac is off.
      </p>

      <div className="space-y-2">
        <label className="text-xs font-medium">What's your Apple Home called?</label>
        <Input
          placeholder="My Home"
          value={homeName}
          onChange={(e) => setHomeName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCheckout()}
          autoFocus
        />
        <p className="text-xs text-muted-foreground">
          Enter the exact name as it appears in the Apple Home app.
        </p>
      </div>

      <CollapsibleHelp title="How to find your home name">
        <p>1. Open the Home app on your iPhone or iPad</p>
        <p>2. Tap the three dots (...) in the top right</p>
        <p>3. Tap Home Settings</p>
        <p>4. Your home name is at the top</p>
      </CollapsibleHelp>

      <div className="rounded-lg border border-primary/50 p-3 space-y-2 flex flex-col">
        <h3 className="text-sm font-medium">Cloud</h3>
        <p className="text-xs text-muted-foreground flex-1">Unlimited accessories · always on</p>
        <p className="text-sm font-medium">{pricing.cloud.formatted}/mo</p>
        <p className="text-xs text-amber-600">Requires an Apple Home Hub (Apple TV or HomePod)</p>
        <Button size="sm" className="w-full text-xs" onClick={handleCheckout} disabled={loading || !homeName.trim()}>
          {loading ? 'Loading...' : 'Subscribe'}
        </Button>
      </div>

      <Button variant="ghost" size="sm" className="w-full text-xs" onClick={onBack}>
        <ArrowLeft className="h-3 w-3 mr-1" /> Back
      </Button>
    </div>
  );
}

function SharedHomeStep({ userEmail, onComplete, onBack, onInvalidateHomes }: {
  userEmail: string;
  onComplete: () => void;
  onBack: () => void;
  onInvalidateHomes?: () => void;
}) {
  const { data, loading: invitationsLoading, refetch } = useQuery<GetPendingInvitationsResponse>(GET_PENDING_INVITATIONS, {
    fetchPolicy: 'network-only',
  });
  const [acceptInvitation] = useMutation(ACCEPT_HOME_INVITATION);
  const [rejectInvitation] = useMutation(REJECT_HOME_INVITATION);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const invitations = data?.pendingInvitations || [];

  const handleAccept = useCallback(async (invitation: PendingInvitation) => {
    setActionLoading(invitation.id);
    try {
      await acceptInvitation({ variables: { homeId: invitation.homeId } });
      onInvalidateHomes?.();
      toast.success(`Joined ${invitation.homeName}!`);
      onComplete();
    } catch {
      toast.error('Failed to accept invitation');
    } finally {
      setActionLoading(null);
    }
  }, [acceptInvitation, onComplete, onInvalidateHomes]);

  const handleReject = useCallback(async (invitation: PendingInvitation) => {
    setActionLoading(invitation.id);
    try {
      await rejectInvitation({ variables: { homeId: invitation.homeId } });
      toast.success('Invitation declined');
      refetch();
    } catch {
      toast.error('Failed to decline invitation');
    } finally {
      setActionLoading(null);
    }
  }, [rejectInvitation, refetch]);

  if (invitationsLoading) {
    return (
      <div className="flex justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (invitations.length > 0) {
    return (
      <div className="space-y-4 py-2">
        <p className="text-sm text-muted-foreground">You've been invited to:</p>
        <div className="space-y-2">
          {invitations.map((inv) => (
            <div key={inv.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{inv.homeName}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Invited by {inv.inviterName} · Role: {inv.role}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={() => handleAccept(inv)}
                  disabled={actionLoading === inv.id}
                >
                  Accept
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={() => handleReject(inv)}
                  disabled={actionLoading === inv.id}
                >
                  Decline
                </Button>
              </div>
            </div>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="w-full text-xs" onClick={onBack}>
          <ArrowLeft className="h-3 w-3 mr-1" /> Back
        </Button>
      </div>
    );
  }

  // No pending invitations
  return (
    <div className="space-y-4 py-2">
      <p className="text-sm font-medium">No invitations yet</p>
      <p className="text-xs text-muted-foreground">
        Ask the home owner to invite you using your email address:
      </p>
      <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
        <span className="text-sm flex-1 truncate">{userEmail}</span>
        <CopyButton text={userEmail} />
      </div>
      <p className="text-xs text-muted-foreground">
        You'll see the invitation here and in your email once they send it.
      </p>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" className="flex-1 text-xs" onClick={onBack}>
          <ArrowLeft className="h-3 w-3 mr-1" /> Back
        </Button>
        <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={onComplete}>
          Done
        </Button>
      </div>
    </div>
  );
}

const stepTitles: Record<WizardStep, string> = {
  intent: 'Welcome to Homecast',
  'mac-setup': 'Set up your Mac relay',
  'cloud-setup': 'Set up your cloud relay',
  'shared-home': 'Join a shared home',
};

const stepDescriptions: Record<WizardStep, string> = {
  intent: 'How would you like to connect your smart home?',
  'mac-setup': 'Get started with your Mac as a HomeKit relay',
  'cloud-setup': 'Enter your Apple Home name to get started',
  'shared-home': 'Check for home invitations',
};

export function OnboardingOverlay({ isInMacApp, isInMobileApp, onComplete, onUpgradeStandard, userEmail, onInvalidateHomes, cloudSignupsAvailable = true, accountType }: OnboardingOverlayProps) {
  const [step, setStep] = useState<WizardStep>('intent');
  const pricing = getPricing();

  const handleIntentSelect = useCallback((selected: WizardStep) => {
    setStep(selected);
  }, []);

  const handleSkip = useCallback(() => {
    onComplete('skipped');
  }, [onComplete]);

  const handleMacComplete = useCallback(() => {
    onComplete('mac-relay');
  }, [onComplete]);

  const handleCloudComplete = useCallback((enrollmentId?: string) => {
    onComplete('cloud-relay', enrollmentId);
  }, [onComplete]);

  const handleSharedComplete = useCallback(() => {
    onComplete('shared-home');
  }, [onComplete]);

  return (
    <Dialog open onOpenChange={() => {
      if (step === 'intent') onComplete('skipped');
      else setStep('intent');
    }}>
      <DialogContent className="sm:max-w-md" style={{ zIndex: 10050 }}>
        <DialogHeader>
          <DialogTitle className="text-center text-lg">{stepTitles[step]}</DialogTitle>
          <DialogDescription className="text-center text-sm text-muted-foreground">
            {stepDescriptions[step]}
          </DialogDescription>
        </DialogHeader>

        {step === 'intent' && (
          <IntentStep
            isInMacApp={isInMacApp}
            isInMobileApp={isInMobileApp}
            onSelect={handleIntentSelect}
            onSkip={handleSkip}
            pricing={pricing}
            cloudSignupsAvailable={cloudSignupsAvailable}
          />
        )}

        {step === 'mac-setup' && (
          <MacSetupStep
            isInMacApp={isInMacApp}
            isInMobileApp={isInMobileApp}
            onComplete={handleMacComplete}
            onUpgradeStandard={onUpgradeStandard}
            onBack={() => setStep('intent')}
            pricing={pricing}
            accountType={accountType}
          />
        )}

        {step === 'cloud-setup' && (
          <CloudSetupStep
            onComplete={handleCloudComplete}
            onBack={() => setStep('intent')}
            pricing={pricing}
            cloudSignupsAvailable={cloudSignupsAvailable}
          />
        )}

        {step === 'shared-home' && (
          <SharedHomeStep
            userEmail={userEmail}
            onComplete={handleSharedComplete}
            onBack={() => setStep('intent')}
            onInvalidateHomes={onInvalidateHomes}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
