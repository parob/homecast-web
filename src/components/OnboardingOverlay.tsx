import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Monitor, Cloud, Users, ArrowLeft, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { usePricing } from '@/lib/pricing';
import { purchasePlan } from '@/lib/purchase';
import { ACCEPT_HOME_INVITATION, REJECT_HOME_INVITATION } from '@/lib/graphql/mutations';
import { GET_PENDING_INVITATIONS } from '@/lib/graphql/queries';
import type { GetPendingInvitationsResponse, PendingInvitation } from '@/lib/graphql/types';
import { toast } from 'sonner';
import { config, isCommunity, getRelayAddress } from '@/lib/config';
import { probeRelay, type RelayHealth } from '@/lib/relay-probe';
import { isRelayCapable } from '@/native/homekit-bridge';

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
  initialStep?: WizardStep;
  /** The account already has at least one home (owned or shared with them). */
  hasHomes?: boolean;
  /**
   * Close the wizard and open Settings → Homes, which owns the real add-a-home
   * flow (Apple ID + region + the invitation the relay is waiting for). Someone
   * who already pays for Cloud, or already has a home, needs that — not a
   * first-run pitch with a price on it.
   */
  onAddHomeInSettings?: () => void;
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

/**
 * One of the three ways in. Numbered on purpose: people arrive here having been
 * told "download the app and join my home", and a list of similar-looking cards
 * gave them no way to tell which one that was. The number orders them, and the
 * requirement line under each says plainly what you need before it will work.
 */
function OptionCard({ n, icon, title, requirement, children, onClick, disabled }: {
  n: number;
  icon: React.ReactNode;
  title: string;
  /** What you must already have. The single most common reason to rule one out. */
  requirement?: string;
  children?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={() => { if (!disabled) onClick(); }}
      className={`w-full text-left rounded-lg border p-4 space-y-1.5 transition-colors ${disabled ? 'opacity-60 cursor-default' : 'hover:border-primary/50'}`}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
          {n}
        </span>
        {icon}
        <span className="text-sm font-medium">{title}</span>
      </div>
      {children}
      {requirement && <p className="text-xs text-amber-600">{requirement}</p>}
    </button>
  );
}

function IntentStep({ isInMacApp, isInMobileApp, onSelect, onSkip, pricing, cloudSignupsAvailable = true, accountType, hasHomes, onAddHomeInSettings }: {
  isInMacApp: boolean;
  isInMobileApp?: boolean;
  onSelect: (step: WizardStep) => void;
  onSkip: () => void;
  pricing: NonNullable<ReturnType<typeof usePricing>>;
  cloudSignupsAvailable?: boolean;
  accountType?: string;
  hasHomes?: boolean;
  onAddHomeInSettings?: () => void;
}) {
  const hasCloud = accountType === 'cloud' || accountType === 'managed';
  // Nothing left to sell and nothing to decide: adding a further home is a
  // Settings task, so go straight there rather than through a setup step.
  const cloudGoesToSettings = Boolean(onAddHomeInSettings) && (hasCloud || Boolean(hasHomes));
  const macLabel = isInMacApp ? 'Use this Mac as your relay' : 'I have a Mac at home';
  const macDescription = isInMacApp
    ? 'Your Mac needs to stay on for remote access to work.'
    : 'Use your Mac as a HomeKit relay. Your Mac needs to stay on for remote access.';

  return (
    <div className="space-y-3 py-2">
      <p className="text-xs text-muted-foreground">
        Three ways to get started — pick the one that matches your situation.
      </p>

      <OptionCard
        n={1}
        icon={<Monitor className="h-4 w-4 text-muted-foreground" />}
        title={macLabel}
        requirement="Requires a Mac that stays switched on"
        onClick={() => onSelect('mac-setup')}
      >
        <p className="text-xs text-muted-foreground">{macDescription}</p>
        {accountType === 'standard' ? (
          <>
            <p className="text-xs font-medium text-green-600 flex items-center gap-1">
              <Check className="h-3 w-3" />
              Standard plan active · unlimited accessories
            </p>
            <p className="text-xs text-muted-foreground">Free tier · 10 accessories</p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Free · 10 accessories
            <span className="mx-1.5">·</span>
            Standard · {pricing.standard.formatted}/mo · unlimited
          </p>
        )}
      </OptionCard>

      <OptionCard
        n={2}
        icon={<Cloud className="h-4 w-4 text-blue-500" />}
        title={cloudGoesToSettings ? (hasCloud ? 'Register a home on your cloud relay' : 'Add another home') : 'Set up a cloud relay'}
        requirement="Requires an Apple Home Hub (Apple TV or HomePod)"
        onClick={() => (cloudGoesToSettings ? onAddHomeInSettings!() : onSelect('cloud-setup'))}
        disabled={!cloudSignupsAvailable && !hasCloud}
      >
        <p className="text-xs text-muted-foreground">
          {isInMacApp
            ? "Always on \u2014 your Mac doesn't need to stay running."
            : "We run a relay for you \u2014 no Mac needed. Always on, even when your computer is off."}
        </p>
        {/* Somebody already paying for this should be told they have it, not
            quoted the price of it again. */}
        {hasCloud ? (
          <>
            <p className="text-xs font-medium text-green-600 flex items-center gap-1">
              <Check className="h-3 w-3" />
              Cloud plan active · unlimited accessories
            </p>
            {cloudGoesToSettings && (
              <p className="text-xs text-muted-foreground">Nothing to pay — opens Settings to register the home.</p>
            )}
          </>
        ) : cloudGoesToSettings ? (
          <p className="text-xs text-muted-foreground">
            Opens Settings, alongside the homes you already have · {pricing.cloud.formatted}/mo
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {cloudSignupsAvailable ? `${pricing.cloud.formatted}/mo · unlimited accessories` : 'Signups paused — at capacity'}
          </p>
        )}
      </OptionCard>

      <OptionCard
        n={3}
        icon={<Users className="h-4 w-4 text-muted-foreground" />}
        title="I want to join an existing home"
        requirement="Requires an invitation from whoever set the home up"
        onClick={() => onSelect('shared-home')}
      >
        <p className="text-xs text-muted-foreground">
          Someone else has already set Homecast up and shared their home with you.
          Nothing to install or pay for — you just need their invite.
        </p>
      </OptionCard>

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
  pricing: NonNullable<ReturnType<typeof usePricing>>;
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

function CloudSetupStep({ onComplete, onBack, pricing, cloudSignupsAvailable = true, hasCloudPlan, hasHomes, onAddHomeInSettings }: {
  onComplete: (enrollmentId?: string) => void;
  onBack: () => void;
  pricing: NonNullable<ReturnType<typeof usePricing>>;
  cloudSignupsAvailable?: boolean;
  hasCloudPlan?: boolean;
  hasHomes?: boolean;
  onAddHomeInSettings?: () => void;
}) {
  const [homeName, setHomeName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCheckout = useCallback(async () => {
    if (!homeName.trim()) {
      toast.error('Please enter your home name');
      return;
    }
    setLoading(true);
    try {
      const result = await purchasePlan('cloud', { homeName: homeName.trim() });
      if (result.upgraded) {
        toast.success('Cloud relay activated!');
        onComplete();
      } else if (result.redirectUrl) {
        window.location.href = result.redirectUrl;
      } else if (result.error) {
        toast.error(result.error);
      }
    } finally {
      setLoading(false);
    }
  }, [homeName, onComplete]);

  // Already subscribed, or already running homes: this step's job is checkout,
  // and there is nothing to check out. Settings → Homes owns adding a home to
  // an existing plan, so hand over rather than quoting a price again.
  if (onAddHomeInSettings && (hasCloudPlan || hasHomes)) {
    return (
      <div className="space-y-4 py-2">
        {hasCloudPlan && (
          <p className="text-xs font-medium text-green-600 flex items-center gap-1">
            <Check className="h-3 w-3" />
            Cloud plan active · unlimited accessories
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {hasCloudPlan
            ? "You're already subscribed, so there's nothing to buy. Register the home and we'll show you the invitation to send your relay from Apple Home."
            : 'Homes are added in Settings, alongside the ones you already have.'}
        </p>
        <Button size="sm" className="w-full text-xs" onClick={onAddHomeInSettings}>
          {hasCloudPlan ? 'Register a home' : 'Add a home in Settings'}
        </Button>
        <Button variant="ghost" size="sm" className="w-full text-xs" onClick={onBack}>
          <ArrowLeft className="h-3 w-3 mr-1" /> Back
        </Button>
      </div>
    );
  }

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
        {/* No autoFocus: on a phone it throws the keyboard up over the page
            the moment this step opens, so the explanation, the price and the
            hub requirement are all hidden behind it before anyone reads them. */}
        <Input
          placeholder="My Home"
          value={homeName}
          onChange={(e) => setHomeName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCheckout()}
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


/**
 * First run, Community edition.
 *
 * The wizard below this one asks which cloud plan you want and how your Mac
 * should reach the cloud relay. In Community none of that exists: there is no
 * account, no subscription, no accessory limit, and the relay is the machine
 * you are already looking at. Showing someone a price list for something they
 * have already installed for free is worse than showing them nothing.
 *
 * So this says the two things that are actually true and actionable on day
 * one: here is the address your other devices need, and your home currently
 * has no password on it.
 */
function CommunitySetupStep({ onComplete, onOpenSettings }: {
  onComplete: () => void;
  onOpenSettings?: () => void;
}) {
  const onRelay = isRelayCapable();
  const [health, setHealth] = useState<RelayHealth | null>(null);

  useEffect(() => {
    // On the relay the page origin is loopback, which /health answers for —
    // and its `addresses` are the ones another device can actually use.
    const target = getRelayAddress() ?? window.location.origin;
    void probeRelay(target, 4000).then(setHealth);
  }, []);

  const address = health?.addresses?.[0] ?? getRelayAddress() ?? null;
  const unprotected = health?.authEnabled === false;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {onRelay
          ? 'Everything runs on this Mac. No account, no subscription, no limit on accessories.'
          : `You're connected to ${health?.name || 'your relay'}. Everything runs on that Mac — nothing leaves your network.`}
      </p>

      {onRelay && (
        <div className="rounded-lg border p-3 space-y-2">
          <p className="text-sm font-medium">Add your other devices</p>
          <p className="text-xs text-muted-foreground">
            Open Homecast on an iPhone or iPad and pick this Mac from the list — there is
            nothing to type. In a browser, use this address:
          </p>
          {address ? (
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono truncate">{address}</code>
              <CopyButton text={address} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Starting the local server…</p>
          )}
        </div>
      )}

      {unprotected && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
          <p className="text-sm font-medium">Set a password</p>
          <p className="text-xs text-muted-foreground">
            Anyone who can reach {onRelay ? 'this Mac' : 'your relay'} on the network can control
            your home. That is fine at home on your own Wi-Fi, and not fine anywhere else.
          </p>
          {onOpenSettings && (
            <Button variant="outline" size="sm" className="text-xs" onClick={() => { onComplete(); onOpenSettings(); }}>
              Open settings
            </Button>
          )}
        </div>
      )}

      {onRelay && (
        <div className="rounded-lg border p-3 space-y-2">
          <p className="text-sm font-medium">Away from home</p>
          <p className="text-xs text-muted-foreground">
            Run a mesh VPN like Tailscale on this Mac and your phone, and Homecast will find
            its way over it on its own — it learns the address the first time you connect here.
          </p>
        </div>
      )}

      <Button className="w-full" onClick={onComplete}>Done</Button>
    </div>
  );
}

export function OnboardingOverlay({ isInMacApp, isInMobileApp, onComplete, onUpgradeStandard, userEmail, onInvalidateHomes, cloudSignupsAvailable = true, accountType, initialStep = 'intent', hasHomes, onAddHomeInSettings }: OnboardingOverlayProps) {
  const [step, setStep] = useState<WizardStep>(initialStep);
  const pricing = usePricing();
  const hasCloudPlan = accountType === 'cloud' || accountType === 'managed';
  /** Nothing to sell and nothing to name — Settings → Homes takes it from here. */
  const cloudHandsOffToSettings = Boolean(onAddHomeInSettings) && (hasCloudPlan || Boolean(hasHomes));

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

  // Community has no plan to choose and no price to wait for, so it branches
  // out before the pricing gate below — which would otherwise hold this dialog
  // closed forever on a build with no StoreKit prices to load.
  if (isCommunity) {
    return (
      <Dialog open onOpenChange={() => onComplete('skipped')}>
        <DialogContent
          className="sm:max-w-md overflow-y-auto overscroll-contain"
          style={{ zIndex: 10050, ...(isInMacApp ? { marginTop: 33, maxHeight: 'calc(100dvh - 4rem)' } : null) }}
        >
          <DialogHeader>
            <DialogTitle className="text-center text-lg">Homecast Community</DialogTitle>
            <DialogDescription className="text-center text-sm text-muted-foreground">
              Your home, on your own hardware
            </DialogDescription>
          </DialogHeader>
          <CommunitySetupStep
            onComplete={() => onComplete('skipped')}
            onOpenSettings={onAddHomeInSettings}
          />
        </DialogContent>
      </Dialog>
    );
  }

  // Inside the App Store WKWebView, native StoreKit prices haven't loaded yet
  // on first render. Don't show the dialog with web prices baked in.
  if (!pricing) return null;

  return (
    <Dialog open onOpenChange={() => {
      if (step === 'intent') onComplete('skipped');
      else setStep('intent');
    }}>
      <DialogContent
        // No max-h here: this is the tallest dialog in the app, so it takes
        // DialogContent's safe-area-aware cap rather than a plain 100dvh one
        // that slid its header under the iPhone's status bar.
        className="sm:max-w-md overflow-y-auto overscroll-contain"
        // The Mac app's window owns the top 33px for its title bar, and the
        // dialog centres against the whole window — so a tall step slid its
        // header up underneath it. Capping the height keeps it inside, and the
        // offset keeps a full-height one clear of the bar. (Catalyst reports no
        // safe-area insets, so this replaces the cap rather than fighting it.)
        style={{
          zIndex: 10050,
          ...(isInMacApp ? { marginTop: 33, maxHeight: 'calc(100dvh - 4rem)' } : null),
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-center text-lg">
            {step === 'cloud-setup' && cloudHandsOffToSettings ? 'Register a home' : stepTitles[step]}
          </DialogTitle>
          <DialogDescription className="text-center text-sm text-muted-foreground">
            {/* The default description asks for a home name. That step doesn't
                ask for one when there's nothing to buy. */}
            {step === 'cloud-setup' && cloudHandsOffToSettings
              ? (hasCloudPlan ? 'Add a home to your cloud relay' : 'Add a home to your account')
              : stepDescriptions[step]}
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
            accountType={accountType}
            hasHomes={hasHomes}
            onAddHomeInSettings={onAddHomeInSettings}
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
            hasCloudPlan={hasCloudPlan}
            hasHomes={hasHomes}
            onAddHomeInSettings={onAddHomeInSettings}
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
