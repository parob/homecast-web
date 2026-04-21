import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Cloud, Plus, Home as HomeIcon, Info, X, ChevronRight } from 'lucide-react';
import { HomeDetailView } from './HomeDetailView';
import { CopyButton, CollapsibleHelp } from '@/components/SetupState';
import { getPricing, getRegion } from '@/lib/pricing';
import { isCommunity } from '@/lib/config';
import { regionLabel } from '@/lib/regions';
import { config } from '@/lib/config';
import { GET_MY_ENROLLMENTS } from '@/lib/graphql/queries';
import { CREATE_CLOUD_MANAGED_CHECKOUT, CANCEL_CLOUD_MANAGED_ENROLLMENT, CONFIRM_INVITE_SENT, RESET_INVITE_STATUS } from '@/lib/graphql/mutations';
import type {
  MyCloudManagedEnrollmentsResponse,
  CreateCloudManagedCheckoutResponse,
  CustomerEnrollmentInfo,
  HomeKitHome,
} from '@/lib/graphql/types';
import { toast } from 'sonner';
import { formatLastOnline, formatRelativeAgo } from '@/lib/relay-last-seen';
import { useHomes } from '@/hooks/useHomeKitData';

interface HomesSectionProps {
  homes: HomeKitHome[];
  prefilledHomeName?: string;
  autoOpenEnroll?: boolean;
  accountType: string;
  handleUpgradeToCloud: () => Promise<void>;
  isInMacApp: boolean;
  isInMobileApp: boolean;
  cloudSignupsAvailable?: boolean;
  developerMode?: boolean;
  // When provided, home selection is lifted to the parent (desktop sidebar drives the nav).
  // When absent, HomesSection manages selection internally (mobile drill-down).
  onSelectHome?: (homeId: string) => void;
}

function statusBadge(status: string) {
  switch (status) {
    case 'active':
      return <Badge variant="default" className="text-[10px] px-1.5 py-0 bg-blue-600">Cloud Relay</Badge>;
    case 'pending':
      return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-yellow-500/20 text-yellow-700 dark:text-yellow-400">Pending</Badge>;
    case 'invite_sent':
      return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-blue-500/20 text-blue-700 dark:text-blue-400">Invite Sent</Badge>;
    case 'needs_home_id':
      return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-orange-500/20 text-orange-700 dark:text-orange-400">Action Needed</Badge>;
    case 'awaiting_relay':
      return <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Awaiting Relay</Badge>;
    default:
      return <Badge variant="outline" className="text-[10px] px-1.5 py-0">{status}</Badge>;
  }
}

function EnrollmentCard({ enrollment, onCancel, onConfirmInvite, onResetInvite, developerMode, onClick }: {
  enrollment: CustomerEnrollmentInfo;
  onCancel: () => void;
  onConfirmInvite: () => void;
  onResetInvite: () => void;
  developerMode?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className={`rounded-lg border bg-muted/30 p-3 space-y-1.5 ${onClick ? 'cursor-pointer hover:bg-muted/50 transition-colors' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <HomeIcon className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{enrollment.homeName}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {enrollment.status === 'active' ? (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-500/50 text-blue-600 dark:text-blue-400">
              Cloud Relay
            </Badge>
          ) : statusBadge(enrollment.status)}
          {onClick && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
        </div>
      </div>
      <div className="space-y-0.5">
        <p className="text-xs text-muted-foreground">
          {enrollment.status === 'active' ? (enrollment.inviteEmail ? `Managed by Homecast Cloud · ${enrollment.inviteEmail}` : 'Managed by Homecast Cloud') : enrollment.status === 'pending' ? 'Setting up cloud relay...' : enrollment.status === 'invite_sent' ? 'Waiting for relay to accept' : enrollment.status === 'needs_home_id' ? 'Action needed' : 'Cloud relay · ' + enrollment.status}
        </p>
        {enrollment.status === 'pending' && enrollment.inviteEmail && (
          <div className="space-y-2 mt-1">
            <p className="text-xs text-muted-foreground">Invite to your Apple Home as <strong>Resident</strong>:</p>
            <div className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5">
              <span className="text-xs flex-1 truncate font-mono selectable">{enrollment.inviteEmail}</span>
              <CopyButton text={enrollment.inviteEmail} />
            </div>
            <CollapsibleHelp title="How to invite">
              <div className="flex items-start gap-2"><span className="shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold">1</span><span>Open the <strong>Home</strong> app on your iPhone, iPad, or Mac</span></div>
              <div className="flex items-start gap-2"><span className="shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold">2</span><span>Tap or click the <strong>+</strong> button, then select <strong>Add People</strong></span></div>
              <div className="flex items-start gap-2"><span className="shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold">3</span><span>Choose the <strong>Resident</strong> role (not Guest)</span></div>
              <div className="flex items-start gap-2"><span className="shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold">4</span><span>Enter the relay email address above in the <strong>To</strong> field</span></div>
              <div className="flex items-start gap-2"><span className="shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold">5</span><span>Tap or click <strong>Send Invite</strong></span></div>
            </CollapsibleHelp>
            <Button size="sm" onClick={onConfirmInvite}>
              I've sent the invite
            </Button>
          </div>
        )}
        {enrollment.status === 'invite_sent' && (
          <div className="space-y-1.5 mt-1">
            <p className="text-xs text-muted-foreground">Waiting for the relay to accept — may take up to 24 hours.</p>
            <button
              className="text-xs text-muted-foreground underline hover:text-foreground"
              onClick={onResetInvite}
            >
              Something wrong? Review invite instructions
            </button>
          </div>
        )}
        {enrollment.status === 'needs_home_id' && (
          <p className="text-xs text-muted-foreground">Multiple homes found with this name</p>
        )}
        {developerMode && enrollment.region && (
          <p className="text-[10px] text-muted-foreground">Region: {regionLabel(enrollment.region)}</p>
        )}
      </div>
      {enrollment.status !== 'cancelled' && enrollment.status !== 'active' && (
        <div className="flex justify-end">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 text-xs text-destructive hover:text-destructive">
                Cancel Setup
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent style={{ zIndex: 10050 }}>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel Setup?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will cancel the cloud relay setup for this home.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onCancel} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Cancel Setup
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}

const ROLE_LABELS: Record<string, string> = { owner: 'Owner', admin: 'Admin', control: 'Control', view: 'View' };

function SelfHostedHomeCard({ home, onSwitchToCloud, onClick }: { home: HomeKitHome; onSwitchToCloud?: () => void; onClick?: () => void }) {
  const isCloud = home.isCloudManaged;
  const isOwner = !home.role || home.role === 'owner';
  const isOffline = home.relayConnected === false;
  return (
    <div
      className={`rounded-lg border bg-muted/30 p-3 space-y-1.5 ${onClick ? 'cursor-pointer hover:bg-muted/50 transition-colors' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <HomeIcon className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{home.name}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {!isOwner && home.role && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {ROLE_LABELS[home.role] || home.role}
            </Badge>
          )}
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${isCloud ? 'border-blue-500/50 text-blue-600 dark:text-blue-400' : ''}`}>
            {isCloud ? 'Cloud Relay' : 'Self-hosted Relay'}
          </Badge>
          {onClick && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${isOffline ? 'bg-red-500' : 'bg-green-500'}`} />
        <p className="text-xs text-muted-foreground">
          {isOffline ? formatLastOnline(home.relayLastSeenAt) : `Online · ${formatRelativeAgo(home.relayLastSeenAt)}`}
        </p>
      </div>
      {isOwner ? (
        <p className="text-xs text-muted-foreground">
          {isCloud ? 'Hosted by Homecast — always on' : 'Connected via your Mac'}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Owned by {home.ownerEmail || 'another user'}
        </p>
      )}
      {onSwitchToCloud && !isCloud && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={(e) => { e.stopPropagation(); onSwitchToCloud(); }}>
            Switch to Cloud Relay
          </Button>
        </div>
      )}
    </div>
  );
}

export function HomesSection({ homes: homesProp, prefilledHomeName, autoOpenEnroll, accountType, handleUpgradeToCloud, isInMacApp, isInMobileApp, cloudSignupsAvailable = true, developerMode, onSelectHome }: HomesSectionProps) {
  // Keep the list fresh so each card's online/offline + last-seen reflects the
  // live server state rather than the snapshot captured at dialog-open time.
  const { data: liveHomes, refetch: refetchHomes } = useHomes();
  useEffect(() => {
    const id = setInterval(() => { refetchHomes(); }, 15_000);
    return () => clearInterval(id);
  }, [refetchHomes]);
  const homes = liveHomes ?? homesProp;
  // Tick every second so the "ago" label recomputes between refetches.
  const [, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow(n => n + 1), 1_000);
    return () => clearInterval(id);
  }, []);
  const isCloudPlan = accountType === 'cloud';
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [homeName, setHomeName] = useState(prefilledHomeName || '');
  const [homeNameLocked, setHomeNameLocked] = useState(false);
  const [selectedHome, setSelectedHome] = useState<HomeKitHome | null>(null);
  const [loading, setLoading] = useState(false);
  const handleSelectHome = (home: HomeKitHome) => {
    if (onSelectHome) onSelectHome(home.id);
    else setSelectedHome(home);
  };
  const pricing = getPricing();
  const pricingRegion = getRegion();

  const openExternalUrl = (url: string) => {
    return (e: React.MouseEvent) => {
      const w = window as any;
      if (w.webkit?.messageHandlers?.homecast) {
        e.preventDefault();
        w.webkit.messageHandlers.homecast.postMessage({ action: 'openUrl', url });
      }
    };
  };

  const { data, loading: enrollmentsLoading, refetch } = useQuery<MyCloudManagedEnrollmentsResponse>(GET_MY_ENROLLMENTS, {
    fetchPolicy: 'network-only',
    skip: !isCloudPlan,
  });

  const [createCheckout] = useMutation<CreateCloudManagedCheckoutResponse>(CREATE_CLOUD_MANAGED_CHECKOUT);
  const [cancelEnrollment] = useMutation(CANCEL_CLOUD_MANAGED_ENROLLMENT);
  const [confirmInviteSent] = useMutation(CONFIRM_INVITE_SENT);
  const [resetInviteStatus] = useMutation(RESET_INVITE_STATUS);

  const enrollments = (data?.myCloudManagedEnrollments || []).filter(e => e.status !== 'cancelled');
  const enrolledHomeNames = new Set(enrollments.map(e => e.homeName.toLowerCase()));
  const selfHostedHomes = homes.filter(h => !enrolledHomeNames.has(h.name.toLowerCase()));

  const isOwned = (h: HomeKitHome) => !h.role || h.role === 'owner';
  const ownedHomes = homes.filter(isOwned);
  const sharedHomes = homes.filter(h => !isOwned(h));
  const ownedSelfHostedHomes = selfHostedHomes.filter(isOwned);
  const sharedSelfHostedHomes = selfHostedHomes.filter(h => !isOwned(h));

  useEffect(() => {
    if (autoOpenEnroll && isCloudPlan && enrollments.length === 0) {
      setAddDialogOpen(true);
    }
  }, [autoOpenEnroll, isCloudPlan, enrollments.length]);

  const [cancelledEnrollment, setCancelledEnrollment] = useState<CustomerEnrollmentInfo | null>(null);

  const handleDismissCancelled = useCallback(() => {
    setCancelledEnrollment(null);
    refetch();
  }, [refetch]);

  const handleCancel = useCallback(async (enrollmentId: string) => {
    try {
      const enrollment = enrollments.find(e => e.id === enrollmentId);
      await cancelEnrollment({ variables: { enrollmentId } });
      toast.success('Home removed from cloud relay');
      setCancelledEnrollment(enrollment || { id: enrollmentId, homeName: '', status: 'cancelled', inviteEmail: null, matchedHomeName: null, needsHomeId: false, createdAt: '', matchedAt: null });
    } catch {
      toast.error('Failed to cancel enrollment');
    }
  }, [cancelEnrollment, enrollments]);

  const handleConfirmInvite = useCallback(async (enrollmentId: string) => {
    try {
      await confirmInviteSent({ variables: { enrollmentId } });
      refetch();
    } catch {
      toast.error('Failed to confirm invite');
    }
  }, [confirmInviteSent, refetch]);

  const handleResetInvite = useCallback(async (enrollmentId: string) => {
    try {
      await resetInviteStatus({ variables: { enrollmentId } });
      refetch();
    } catch {
      toast.error('Failed to reset invite status');
    }
  }, [resetInviteStatus, refetch]);

  const handleAdd = useCallback(async () => {
    if (!homeName.trim()) {
      toast.error('Please enter a home name');
      return;
    }
    setLoading(true);
    try {
      const { data: result } = await createCheckout({
        variables: { homeName: homeName.trim(), region: pricingRegion },
      });
      const r = result?.createCloudManagedCheckout;
      if (r?.enrollmentId) {
        toast.success('Home added to cloud relay!');
        setAddDialogOpen(false);
        setHomeName('');
        refetch();
      } else if (r?.error) {
        toast.error(r.error);
      }
    } catch {
      toast.error('Failed to create enrollment');
    } finally {
      setLoading(false);
    }
  }, [homeName, pricingRegion, createCheckout, refetch]);

  // If a home is selected, show its detail view (must be after all hooks)
  if (selectedHome) {
    return <HomeDetailView home={selectedHome} developerMode={developerMode} />;
  }

  if (!isCloudPlan) {
    return (
      <div className="space-y-3">
        {!isCommunity && (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Signup for Cloud Relay</p>
                <p className="text-xs text-muted-foreground">
                  Always-on relay hosted by Homecast — no Mac needed. Available on the Cloud plan ({pricing.cloud.formatted}/mo).
                </p>
              </div>
            </div>
            {!cloudSignupsAvailable ? (
              <p className="text-xs text-muted-foreground text-center">Signups paused — at capacity</p>
            ) : isInMacApp || isInMobileApp ? (
              <p className="text-xs text-muted-foreground text-center">Visit <a href={`${config.webUrl}/subscribe`} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline" onClick={openExternalUrl(`${config.webUrl}/subscribe`)}>{new URL(config.webUrl).host}/subscribe</a> to upgrade to Cloud</p>
            ) : (
              <Button size="sm" className="w-full text-xs" onClick={handleUpgradeToCloud}>
                Upgrade to Cloud — {pricing.cloud.formatted}/mo
              </Button>
            )}
          </div>
        )}

        {ownedHomes.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Your Homes</p>
            {ownedHomes.map((home) => (
              <SelfHostedHomeCard key={home.id} home={home} onClick={() => handleSelectHome(home)} />
            ))}
          </div>
        )}

        {sharedHomes.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Homes shared with you</p>
            {sharedHomes.map((home) => (
              <SelfHostedHomeCard key={home.id} home={home} onClick={() => handleSelectHome(home)} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {enrollmentsLoading ? (
          <p className="text-xs text-muted-foreground py-4 text-center">Loading homes...</p>
        ) : (
          <>
            {enrollments.length === 0 && selfHostedHomes.length === 0 && (
              <p className="text-xs text-muted-foreground py-4 text-center">No homes connected yet.</p>
            )}

            {!isCommunity && enrollments.map((enrollment) => {
              // Find matching HomeKitHome for this enrollment (by name match)
              const matchedHome = homes.find(h => h.name.toLowerCase() === (enrollment.matchedHomeName || enrollment.homeName).toLowerCase());
              return (
              <EnrollmentCard
                key={enrollment.id}
                enrollment={enrollment}
                onCancel={() => handleCancel(enrollment.id)}
                onConfirmInvite={() => handleConfirmInvite(enrollment.id)}
                onResetInvite={() => handleResetInvite(enrollment.id)}
                developerMode={developerMode}
                onClick={matchedHome ? () => handleSelectHome(matchedHome) : undefined}
              />
              );
            })}

            {ownedSelfHostedHomes.map((home) => (
              <SelfHostedHomeCard
                key={home.id}
                home={home}
                onSwitchToCloud={() => { setHomeName(home.name); setHomeNameLocked(true); setAddDialogOpen(true); }}
                onClick={() => handleSelectHome(home)}
              />
            ))}

            {sharedSelfHostedHomes.length > 0 && (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground pt-1">Homes shared with you</p>
                {sharedSelfHostedHomes.map((home) => (
                  <SelfHostedHomeCard key={home.id} home={home} onClick={() => handleSelectHome(home)} />
                ))}
              </>
            )}
          </>
        )}

        {!isCommunity && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => { setHomeName(prefilledHomeName || ''); setHomeNameLocked(false); setAddDialogOpen(true); }}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Home to Cloud Relay
          </Button>
        )}
      </div>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-sm" style={{ zIndex: 10030 }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Cloud className="h-4 w-4" /> Add Home to Cloud Relay
            </DialogTitle>
            <DialogDescription className="sr-only">Add a home to the cloud relay</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-xs font-medium">Apple Home Name</label>
              <Input
                placeholder="My Home"
                value={homeName}
                onChange={(e) => setHomeName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                autoFocus={!homeNameLocked}
                disabled={homeNameLocked}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Enter the exact name of your Apple Home to set up a cloud relay.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setAddDialogOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={handleAdd} disabled={loading || !homeName.trim()}>
                {loading ? 'Loading...' : 'Continue'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {cancelledEnrollment && (
        <div className="fixed inset-0 z-[10060] flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="rounded-xl border bg-background shadow-lg p-6 max-w-xs w-full space-y-4">
            <p className="text-sm font-medium text-center">Home removed from cloud relay</p>
            {cancelledEnrollment.inviteEmail && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  To complete the removal, remove the relay user from your Apple Home:
                </p>
                <div className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5">
                  <span className="text-xs flex-1 truncate font-mono">{cancelledEnrollment.inviteEmail}</span>
                  <CopyButton text={cancelledEnrollment.inviteEmail} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Open the <strong>Home</strong> app, go to <strong>Home Settings</strong>, and remove this person from your home.
                </p>
              </div>
            )}
            <Button className="w-full" size="sm" onClick={handleDismissCancelled}>
              Done
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
