import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Monitor, Cloud, Loader2, Copy, Check, ChevronDown, ChevronUp, AlertCircle, Users, ArrowRight } from 'lucide-react';
import { config } from '@/lib/config';
import { getPricing } from '@/lib/pricing';
import { GET_MY_ENROLLMENTS } from '@/lib/graphql/queries';
import { CONFIRM_INVITE_SENT, RESET_INVITE_STATUS } from '@/lib/graphql/mutations';
import type { MyCloudManagedEnrollmentsResponse, CustomerEnrollmentInfo, HomeKitHome } from '@/lib/graphql/types';
import type { SetupPath } from '@/components/OnboardingOverlay';
import { isRelayCapable, isRelayEnabled } from '@/native/homekit-bridge';
import { serverConnection } from '@/server/connection';
import { formatLastOnline } from '@/lib/relay-last-seen';

function openExternalUrl(url: string) {
  const w = window as Window & { webkit?: { messageHandlers?: { homecast?: { postMessage: (msg: { action: string; url?: string }) => void } } } };
  if (w.webkit?.messageHandlers?.homecast) {
    w.webkit.messageHandlers.homecast.postMessage({ action: 'openUrl', url });
  } else {
    window.open(url, '_blank');
  }
}

function enableRelayHere() {
  localStorage.removeItem('homecast-relay-disabled');
  serverConnection.reconnect();
}

function mostRecentLastSeen(homes: HomeKitHome[]): string | null {
  let best: number | null = null;
  for (const h of homes) {
    if (!h.relayLastSeenAt) continue;
    const t = Date.parse(h.relayLastSeenAt);
    if (Number.isFinite(t) && (best == null || t > best)) best = t;
  }
  return best == null ? null : new Date(best).toISOString();
}

function EnableRelayHereBanner({ isDarkBackground }: { isDarkBackground: boolean }) {
  if (!isRelayCapable() || isRelayEnabled()) return null;
  return (
    <div className={`w-full max-w-lg mx-auto mb-4 rounded-lg border p-3 flex items-start gap-3 ${isDarkBackground ? 'border-amber-500/30 bg-amber-500/10' : 'border-amber-200 bg-amber-50'}`}>
      <Monitor className={`h-4 w-4 mt-0.5 shrink-0 ${isDarkBackground ? 'text-amber-400' : 'text-amber-600'}`} />
      <div className="flex-1 space-y-2">
        <p className={`text-sm font-medium ${isDarkBackground ? 'text-amber-300' : 'text-amber-800'}`}>
          You're on a Mac relay
        </p>
        <p className={`text-xs ${isDarkBackground ? 'text-amber-300/80' : 'text-amber-700'}`}>
          The relay on this Mac is turned off. Turn it on to use this Mac to bridge your Apple Home devices.
        </p>
        <Button size="sm" variant="outline" onClick={() => enableRelayHere()}>
          Enable relay on this Mac
        </Button>
      </div>
    </div>
  );
}

interface SetupStateProps {
  setupPath?: SetupPath;
  homes: HomeKitHome[];
  isDarkBackground: boolean;
  userEmail?: string;
  isInMacApp: boolean;
  isInMobileApp?: boolean;
  onSetupCloud?: () => void;
  onSetupMac?: () => void;
  accountType?: string;
  pendingEnrollmentId?: string;
  cloudSignupsAvailable?: boolean;
}

export function CopyButton({ text }: { text: string }) {
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
    <button onClick={handleCopy} className="text-xs px-2 py-1 rounded hover:bg-muted/50 transition-colors">
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
    </button>
  );
}

export function CollapsibleHelp({ title, children }: { title: string; children: React.ReactNode }) {
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

function WaitingForMac({ isDarkBackground, onSetupCloud, accountType, cloudSignupsAvailable = true }: {
  isDarkBackground: boolean;
  onSetupCloud?: () => void;
  accountType?: string;
  cloudSignupsAvailable?: boolean;
}) {
  return (
    <Card className={isDarkBackground ? 'bg-black/30 border-white/20' : ''}>
      <CardContent className={`flex flex-col items-center py-12 ${isDarkBackground ? 'text-white' : ''}`}>
        <div className="relative mb-4">
          <Monitor className={`h-12 w-12 ${isDarkBackground ? 'text-white/60' : 'text-muted-foreground'}`} />
          <Loader2 className="absolute -bottom-2 -right-2 h-5 w-5 animate-spin text-primary rounded-full bg-background p-0.5" />
        </div>
        <h3 className="mb-2 text-lg font-semibold">Waiting for your Mac...</h3>
        <p className={`text-center text-sm mb-6 max-w-sm ${isDarkBackground ? 'text-white/70' : 'text-muted-foreground'}`}>
          Your dashboard will update automatically when your Mac connects.
        </p>

        {(accountType === 'standard' || accountType === 'cloud') && (
          <div className={`flex items-center gap-2 mb-6 text-xs ${isDarkBackground ? 'text-green-400' : 'text-green-600'}`}>
            <Check className="h-3.5 w-3.5" />
            <span>{accountType === 'cloud' ? 'Cloud' : 'Standard'} plan active · Unlimited accessories</span>
          </div>
        )}

        <div className={`w-full max-w-sm border-t pt-6 space-y-4 ${isDarkBackground ? 'border-white/20' : ''}`}>
          <p className={`text-sm font-medium ${isDarkBackground ? 'text-white/80' : ''}`}>Haven't downloaded yet?</p>
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              className={isDarkBackground ? 'bg-white/10 border-white/30 text-white hover:bg-white/20' : ''}
              onClick={() => openExternalUrl(config.appStoreUrl)}
            >
              <svg viewBox="0 0 384 512" className="h-3.5 w-3.5 mr-2" fill="currentColor"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5c0 26.2 4.8 53.3 14.4 81.2 12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" /></svg>
              Download on the App Store
            </Button>
          </div>
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>1. Download Homecast for Mac</p>
            <p>2. Open it and sign in</p>
            <p>3. It connects automatically</p>
          </div>
        </div>

        {onSetupCloud && (
          <div className={`w-full max-w-sm border-t pt-4 mt-4 ${isDarkBackground ? 'border-white/20' : ''}`}>
            <p className={`text-xs ${isDarkBackground ? 'text-white/60' : 'text-muted-foreground'}`}>
              {cloudSignupsAvailable ? (
                <>
                  Changed your mind?{' '}
                  <button onClick={onSetupCloud} className="text-primary hover:underline">
                    Set up a cloud relay instead
                  </button>
                </>
              ) : (
                'Cloud relay · signups paused — at capacity'
              )}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EnrollmentTracker({ isDarkBackground, pendingEnrollmentId }: {
  isDarkBackground: boolean;
  pendingEnrollmentId?: string;
}) {
  const { data, loading, stopPolling } = useQuery<MyCloudManagedEnrollmentsResponse>(GET_MY_ENROLLMENTS, {
    fetchPolicy: 'network-only',
    pollInterval: 15000,
  });

  const enrollments = data?.myCloudManagedEnrollments || [];
  // Find the specific enrollment or show the most recent pending one
  const enrollment = pendingEnrollmentId
    ? enrollments.find(e => e.id === pendingEnrollmentId) || enrollments[0]
    : enrollments.find(e => e.status !== 'active') || enrollments[0];

  // Stop polling once enrollment is active — homes.list via WebSocket will
  // populate the dashboard naturally without needing a page reload.
  useEffect(() => {
    if (enrollment?.status === 'active') {
      stopPolling();
    }
  }, [enrollment?.status, stopPolling]);

  if (loading && !enrollment) {
    return (
      <Card className={isDarkBackground ? 'bg-black/30 border-white/20' : ''}>
        <CardContent className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (!enrollment) {
    return (
      <Card className={isDarkBackground ? 'bg-black/30 border-white/20' : ''}>
        <CardContent className={`flex flex-col items-center py-12 ${isDarkBackground ? 'text-white' : ''}`}>
          <Cloud className={`mb-4 h-12 w-12 ${isDarkBackground ? 'text-white/60' : 'text-muted-foreground'}`} />
          <h3 className="mb-2 text-lg font-semibold">Setting up cloud relay</h3>
          <p className={`text-sm ${isDarkBackground ? 'text-white/70' : 'text-muted-foreground'}`}>
            Complete payment to start the setup process.
          </p>
        </CardContent>
      </Card>
    );
  }

  return <EnrollmentTrackerCard enrollment={enrollment} isDarkBackground={isDarkBackground} />;
}

export function EnrollmentTrackerCard({ enrollment, isDarkBackground }: {
  enrollment: CustomerEnrollmentInfo;
  isDarkBackground: boolean;
}) {
  const [confirmInviteSent] = useMutation(CONFIRM_INVITE_SENT, {
    refetchQueries: [{ query: GET_MY_ENROLLMENTS }],
  });
  const [resetInviteStatus] = useMutation(RESET_INVITE_STATUS, {
    refetchQueries: [{ query: GET_MY_ENROLLMENTS }],
  });

  const steps = [
    { label: 'Subscribed to Cloud', done: true },
    {
      label: 'Add home to cloud relay',
      done: enrollment.status === 'invite_sent' || enrollment.status === 'active' || enrollment.status === 'needs_home_id',
      active: enrollment.status === 'pending',
    },
    {
      label: 'Waiting for relay to accept',
      done: enrollment.status === 'active',
      active: enrollment.status === 'invite_sent' || enrollment.status === 'needs_home_id',
    },
    {
      label: 'Devices appear here',
      done: enrollment.status === 'active',
    },
  ];

  return (
    <Card className={isDarkBackground ? 'bg-black/30 border-white/20' : ''}>
      <CardContent className={`py-8 ${isDarkBackground ? 'text-white' : ''}`}>
        <h3 className="text-lg font-semibold mb-6">
          Setting up "{enrollment.homeName}"
        </h3>

        <div className="space-y-4 mb-6">
          {steps.map((s, i) => (
            <div key={i} className="flex items-start gap-3">
              {s.done ? (
                <div className="mt-0.5 h-5 w-5 rounded-full bg-green-500 flex items-center justify-center shrink-0">
                  <Check className="h-3 w-3 text-white" />
                </div>
              ) : s.active ? (
                <div className="mt-0.5 h-5 w-5 rounded-full bg-primary flex items-center justify-center shrink-0">
                  <Loader2 className="h-3 w-3 text-white animate-spin" />
                </div>
              ) : (
                <div className={`mt-0.5 h-5 w-5 rounded-full border-2 shrink-0 ${isDarkBackground ? 'border-white/30' : 'border-muted-foreground/30'}`} />
              )}
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${s.done ? '' : s.active ? 'font-medium' : (isDarkBackground ? 'text-white/50' : 'text-muted-foreground')}`}>
                  {s.label}
                </p>

                {/* Show invite email when pending */}
                {s.active && enrollment.status === 'pending' && enrollment.inviteEmail && (
                  <div className="mt-2 space-y-3">
                    <p className={`text-xs ${isDarkBackground ? 'text-white/60' : 'text-muted-foreground'}`}>
                      Open the Apple Home app and invite this email as a member:
                    </p>
                    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${isDarkBackground ? 'border-white/20 bg-white/5' : ''}`}>
                      <span className="text-sm flex-1 truncate font-mono selectable">{enrollment.inviteEmail}</span>
                      <CopyButton text={enrollment.inviteEmail} />
                    </div>
                    <CollapsibleHelp title="How to invite">
                      <div className="flex items-start gap-2"><span className="shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold">1</span><span>Open the <strong>Home</strong> app on your iPhone, iPad, or Mac</span></div>
                      <div className="flex items-start gap-2"><span className="shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold">2</span><span>Tap or click the <strong>+</strong> button, then select <strong>Add People</strong></span></div>
                      <div className="flex items-start gap-2"><span className="shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold">3</span><span>Choose the <strong>Resident</strong> role (not Guest)</span></div>
                      <div className="flex items-start gap-2"><span className="shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold">4</span><span>Enter the relay email address above in the <strong>To</strong> field</span></div>
                      <div className="flex items-start gap-2"><span className="shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold">5</span><span>Tap or click <strong>Send Invite</strong></span></div>
                    </CollapsibleHelp>
                    <Button
                      size="sm"
                      onClick={() => confirmInviteSent({ variables: { enrollmentId: enrollment.id } })}
                    >
                      I've sent the invite
                    </Button>
                  </div>
                )}

                {/* Show invite_sent waiting state */}
                {s.active && enrollment.status === 'invite_sent' && (
                  <div className="mt-2 space-y-2">
                    <p className={`text-xs ${isDarkBackground ? 'text-white/60' : 'text-muted-foreground'}`}>
                      Waiting for the relay to accept your invitation. This may take up to 24 hours.
                    </p>
                    <button
                      className={`text-xs underline ${isDarkBackground ? 'text-white/40 hover:text-white/60' : 'text-muted-foreground hover:text-foreground'}`}
                      onClick={() => resetInviteStatus({ variables: { enrollmentId: enrollment.id } })}
                    >
                      Something wrong? Check invite instructions
                    </button>
                  </div>
                )}

                {/* Show needs_home_id state */}
                {s.active && enrollment.status === 'needs_home_id' && (
                  <div className="mt-2">
                    <div className={`flex items-start gap-2 rounded-lg border p-3 ${isDarkBackground ? 'border-amber-500/30 bg-amber-500/10' : 'border-amber-200 bg-amber-50'}`}>
                      <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                      <div>
                        <p className={`text-xs font-medium ${isDarkBackground ? 'text-amber-400' : 'text-amber-800'}`}>
                          Multiple homes found
                        </p>
                        <p className={`text-xs mt-1 ${isDarkBackground ? 'text-amber-400/80' : 'text-amber-700'}`}>
                          We found more than one home called "{enrollment.homeName}". Check your email for next steps.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {enrollment.status !== 'active' && (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <p className={`text-xs ${isDarkBackground ? 'text-white/60' : 'text-muted-foreground'}`}>
              {enrollment.status === 'pending' ? 'Send the invite and click the button above to continue.' :
               enrollment.status === 'invite_sent' ? 'Waiting for the relay to accept your invitation...' :
               'Almost there...'}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WaitingForInvite({ isDarkBackground, userEmail, onSetupCloud, onSetupMac, cloudSignupsAvailable = true }: {
  isDarkBackground: boolean;
  userEmail?: string;
  onSetupCloud?: () => void;
  onSetupMac?: () => void;
  cloudSignupsAvailable?: boolean;
}) {
  return (
    <Card className={isDarkBackground ? 'bg-black/30 border-white/20' : ''}>
      <CardContent className={`flex flex-col items-center py-12 ${isDarkBackground ? 'text-white' : ''}`}>
        <h3 className="mb-2 text-lg font-semibold">Waiting for a home invitation</h3>
        <p className={`text-center text-sm mb-4 ${isDarkBackground ? 'text-white/70' : 'text-muted-foreground'}`}>
          Ask the home owner to invite:
        </p>
        {userEmail && (
          <div className={`flex items-center gap-2 rounded-lg border px-4 py-2 mb-4 ${isDarkBackground ? 'border-white/20 bg-white/5' : ''}`}>
            <span className="text-sm font-mono">{userEmail}</span>
            <CopyButton text={userEmail} />
          </div>
        )}
        <p className={`text-xs mb-6 ${isDarkBackground ? 'text-white/60' : 'text-muted-foreground'}`}>
          This page updates automatically.
        </p>

        {(onSetupCloud || onSetupMac) && (
          <div className={`w-full max-w-sm border-t pt-4 ${isDarkBackground ? 'border-white/20' : ''}`}>
            <p className={`text-xs text-center ${isDarkBackground ? 'text-white/60' : 'text-muted-foreground'}`}>
              Want to set up your own home instead?{' '}
              {onSetupMac && <button onClick={onSetupMac} className="text-primary hover:underline">Mac relay</button>}
              {onSetupMac && onSetupCloud && ' · '}
              {onSetupCloud && (cloudSignupsAvailable
                ? <button onClick={onSetupCloud} className="text-primary hover:underline">Cloud relay</button>
                : <span>Cloud relay (at capacity)</span>
              )}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GetStarted({ isDarkBackground, onSetupCloud, onSetupMac, relayOffline = false, relayLastSeenAt = null, cloudSignupsAvailable = true }: {
  isDarkBackground: boolean;
  onSetupCloud?: () => void;
  onSetupMac?: () => void;
  relayOffline?: boolean;
  relayLastSeenAt?: string | null;
  cloudSignupsAvailable?: boolean;
  isInMobileApp?: boolean;
}) {
  const pricing = getPricing();

  return (
    <div className="space-y-5 max-w-lg mx-auto">
      <div className="text-center space-y-3">
        {!relayOffline && <img src="/icon-192.png" alt="Homecast" className="h-14 w-14 mx-auto rounded-2xl" />}
        <h3 className={`text-xl font-bold ${isDarkBackground ? 'text-white' : ''}`}>
          {relayOffline ? 'Connect your devices' : 'Welcome to Homecast'}
        </h3>
        <p className={`text-sm ${isDarkBackground ? 'text-white/60' : 'text-muted-foreground'}`}>
          Choose how you'd like to connect your HomeKit devices.
        </p>
      </div>

      <Card className={`cursor-pointer hover:border-primary/50 transition-colors ${isDarkBackground ? 'bg-black/30 border-white/20 hover:border-white/40' : ''}`}
        onClick={() => onSetupMac?.()}>
        <CardContent className={`py-5 ${isDarkBackground ? 'text-white' : ''}`}>
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1.5">
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${isDarkBackground ? 'bg-white/10' : 'bg-muted'}`}>
                  <Monitor className={`h-4 w-4 ${isDarkBackground ? 'text-white/70' : 'text-muted-foreground'}`} />
                </div>
                <span className="font-semibold text-sm">Self-hosted relay</span>
              </div>
              <p className={`text-xs ml-11 ${isDarkBackground ? 'text-white/60' : 'text-muted-foreground'}`}>
                Run the Homecast Mac app on your home network to bridge your devices.
              </p>
              <p className={`text-xs mt-1.5 ml-11 font-medium ${isDarkBackground ? 'text-green-400' : 'text-green-600'}`}>
                Free · up to 10 accessories
              </p>
              {relayOffline && (
                <div className={`mt-3 ml-11 flex items-start gap-2 rounded-md border px-2.5 py-2 ${isDarkBackground ? 'border-amber-500/30 bg-amber-500/10' : 'border-amber-200 bg-amber-50'}`}>
                  <Monitor className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${isDarkBackground ? 'text-amber-400' : 'text-amber-600'}`} />
                  <p className={`text-xs ${isDarkBackground ? 'text-amber-300' : 'text-amber-800'}`}>
                    It looks like you had a Mac relay connected before but it's offline now. Start the Homecast app on your Mac to reconnect.{' '}
                    <span className="opacity-75">{formatLastOnline(relayLastSeenAt)}.</span>
                  </p>
                </div>
              )}
            </div>
            <ArrowRight className={`h-4 w-4 shrink-0 ml-3 ${isDarkBackground ? 'text-white/30' : 'text-muted-foreground/50'}`} />
          </div>
        </CardContent>
      </Card>

      {onSetupCloud && (
        <Card className={`transition-colors ${cloudSignupsAvailable ? `cursor-pointer hover:border-primary/50 ${isDarkBackground ? 'hover:border-white/40' : ''}` : 'opacity-60'} ${isDarkBackground ? 'bg-black/30 border-white/20' : ''}`}
          onClick={cloudSignupsAvailable ? onSetupCloud : undefined}>
          <CardContent className={`py-5 ${isDarkBackground ? 'text-white' : ''}`}>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1.5">
                  <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${isDarkBackground ? 'bg-blue-500/15' : 'bg-blue-50'}`}>
                    <Cloud className={`h-4 w-4 ${isDarkBackground ? 'text-blue-400' : 'text-blue-500'}`} />
                  </div>
                  <span className="font-semibold text-sm">Cloud relay</span>
                </div>
                <p className={`text-xs ml-11 ${isDarkBackground ? 'text-white/60' : 'text-muted-foreground'}`}>
                  We run the relay for you — always on, no Mac needed. Requires an Apple Home Hub.
                </p>
                <p className={`text-xs mt-1.5 ml-11 font-medium ${isDarkBackground ? 'text-blue-400' : 'text-blue-500'}`}>
                  {cloudSignupsAvailable ? `${pricing.cloud.formatted}/mo · unlimited accessories` : 'Signups paused — at capacity'}
                </p>
              </div>
              {cloudSignupsAvailable && <ArrowRight className={`h-4 w-4 shrink-0 ml-3 ${isDarkBackground ? 'text-white/30' : 'text-muted-foreground/50'}`} />}
            </div>
          </CardContent>
        </Card>
      )}

      <div className={`flex flex-col items-center pt-1 ${isDarkBackground ? 'text-white/40' : 'text-muted-foreground'}`}>
        <div className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" />
          <p className="text-xs font-medium">Invited to a home?</p>
        </div>
        <p className="text-xs mt-0.5 text-center">
          Check your email or ask the owner to invite you.
        </p>
      </div>

    </div>
  );
}

export function SetupState({
  setupPath,
  homes,
  isDarkBackground,
  userEmail,
  isInMacApp,
  isInMobileApp = false,
  onSetupCloud,
  onSetupMac,
  accountType,
  pendingEnrollmentId,
  cloudSignupsAvailable = true,
}: SetupStateProps) {
  // Cloud customers: show enrollment tracker only if there's an in-progress enrollment
  // Once enrollment is active, HomeMember is created → homes.length > 0 → normal view takes over
  if (accountType === 'cloud' && !homes.length) {
    return (
      <>
        <EnableRelayHereBanner isDarkBackground={isDarkBackground} />
        <EnrollmentTracker isDarkBackground={isDarkBackground} pendingEnrollmentId={pendingEnrollmentId} />
      </>
    );
  }

  // Shared homes with offline relay: user can't change relay type, show offline state
  if (homes.length > 0 && homes.some(h => h.role && h.role !== 'owner')) {
    return <RelayOfflineState homes={homes} isDarkBackground={isDarkBackground} onSetupCloud={onSetupCloud} accountType={accountType} cloudSignupsAvailable={cloudSignupsAvailable} />;
  }

  // Show context-aware empty state based on setup path
  switch (setupPath) {
    case 'mac-relay':
      return (
        <>
          <EnableRelayHereBanner isDarkBackground={isDarkBackground} />
          <WaitingForMac isDarkBackground={isDarkBackground} onSetupCloud={onSetupCloud} accountType={accountType} cloudSignupsAvailable={cloudSignupsAvailable} />
        </>
      );
    case 'cloud-relay':
      return (
        <>
          <EnableRelayHereBanner isDarkBackground={isDarkBackground} />
          <EnrollmentTracker isDarkBackground={isDarkBackground} pendingEnrollmentId={pendingEnrollmentId} />
        </>
      );
    case 'shared-home':
      return <WaitingForInvite isDarkBackground={isDarkBackground} userEmail={userEmail} onSetupCloud={onSetupCloud} onSetupMac={onSetupMac} cloudSignupsAvailable={cloudSignupsAvailable} />;
    default:
      // Skipped or no setup path (returning user)
      return (
        <>
          <EnableRelayHereBanner isDarkBackground={isDarkBackground} />
          <GetStarted isDarkBackground={isDarkBackground} onSetupCloud={onSetupCloud} onSetupMac={onSetupMac} relayOffline={homes.length > 0} relayLastSeenAt={mostRecentLastSeen(homes)} cloudSignupsAvailable={cloudSignupsAvailable} isInMobileApp={isInMobileApp} />
        </>
      );
  }
}

function RelayOfflineState({ homes, isDarkBackground, onSetupCloud, accountType, cloudSignupsAvailable = true }: {
  homes: HomeKitHome[];
  isDarkBackground: boolean;
  onSetupCloud?: () => void;
  accountType?: string;
  cloudSignupsAvailable?: boolean;
}) {
  const sharedHomes = homes.filter(h => h.role && h.role !== 'owner');
  const isSharedHome = sharedHomes.length > 0;
  // Treat as "cloud relay offline" when every offline shared home is
  // cloud-managed — that's our infrastructure, not a Mac the owner forgot
  // to turn on.
  const isCloudRelayOffline = isSharedHome && sharedHomes.every(h => h.isCloudManaged);

  if (isSharedHome) {
    return (
      <Card className={isDarkBackground ? 'bg-black/30 border-white/20' : ''}>
        <CardContent className={`flex flex-col items-center py-12 ${isDarkBackground ? 'text-white' : ''}`}>
          {isCloudRelayOffline ? (
            <Cloud className={`mb-4 h-12 w-12 ${isDarkBackground ? 'text-white/60' : 'text-muted-foreground'}`} />
          ) : (
            <AlertCircle className={`mb-4 h-12 w-12 ${isDarkBackground ? 'text-white/60' : 'text-muted-foreground'}`} />
          )}
          <h3 className="mb-2 text-lg font-semibold">
            {isCloudRelayOffline ? 'Cloud relay offline' : 'Home relay is offline'}
          </h3>
          <p className={`text-center text-sm ${isDarkBackground ? 'text-white/70' : 'text-muted-foreground'}`}>
            {isCloudRelayOffline
              ? "Our cloud relay for this home is having trouble. We've been notified and are looking into it. Devices will appear when it's back online."
              : "The home owner's relay isn't connected right now. Devices will appear when it comes back online."}
          </p>
          <p className={`mt-2 text-center text-xs ${isDarkBackground ? 'text-white/50' : 'text-muted-foreground/70'}`}>
            {formatLastOnline(mostRecentLastSeen(sharedHomes))}.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={isDarkBackground ? 'bg-black/30 border-white/20' : ''}>
      <CardContent className={`flex flex-col items-center py-12 ${isDarkBackground ? 'text-white' : ''}`}>
        <Monitor className={`mb-4 h-12 w-12 ${isDarkBackground ? 'text-white/60' : 'text-muted-foreground'}`} />
        <h3 className="mb-2 text-lg font-semibold">Your Mac relay is offline</h3>
        <p className={`text-center text-sm mb-4 ${isDarkBackground ? 'text-white/70' : 'text-muted-foreground'}`}>
          It looks like you had a Mac relay connected before but it's offline now. Start the Homecast app on your Mac to reconnect.
        </p>
        <p className={`mb-2 text-center text-xs ${isDarkBackground ? 'text-white/50' : 'text-muted-foreground/70'}`}>
          {formatLastOnline(mostRecentLastSeen(homes.filter(h => !h.role || h.role === 'owner')))}.
        </p>
        {onSetupCloud && (
          <div className={`border-t pt-4 mt-2 ${isDarkBackground ? 'border-white/20' : ''}`}>
            <p className={`text-xs text-center ${isDarkBackground ? 'text-white/60' : 'text-muted-foreground'}`}>
              {accountType === 'cloud' ? (
                <>
                  You have a cloud relay included in your plan.{' '}
                  <button onClick={onSetupCloud} className="text-primary hover:underline">
                    Set it up
                  </button>
                </>
              ) : cloudSignupsAvailable ? (
                <>
                  Tired of keeping your Mac on?{' '}
                  <button onClick={onSetupCloud} className="text-primary hover:underline">
                    Switch to a cloud relay
                  </button>
                  <span className="ml-1">· Always on · {getPricing().cloud.formatted}/mo</span>
                </>
              ) : (
                'Cloud relay · signups paused — at capacity'
              )}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
