import { useState, useCallback, useMemo } from 'react';
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
import { Wifi, WifiOff, Cloud, Monitor, Users, Sparkles, X } from 'lucide-react';
import { isCommunity } from '@/lib/config';
import { formatRelativeAgo } from '@/lib/relay-last-seen';
import { homeAccessLabel, homeAccessHint } from '@/lib/homekit-errors';
import { isNoticeDismissed, dismissNotice } from '@/lib/notice-dismissal';
import { RelayFullAccessDialog } from './RelayFullAccessDialog';
import { useQuery, useMutation } from '@apollo/client/react';
import { GET_MY_ENROLLMENTS } from '@/lib/graphql/queries';
import { CANCEL_CLOUD_MANAGED_ENROLLMENT } from '@/lib/graphql/mutations';
import type { HomeKitHome, MyCloudManagedEnrollmentsResponse } from '@/lib/graphql/types';
import { toast } from 'sonner';

/**
 * The home's landing page — who and what it is, and the one destructive action
 * that belongs to the home as a whole. Everything configurable is a page of
 * its own now; this is the summary you land on.
 */
export function HomeOverviewSection({
  home,
  developerMode,
  onCloudRelayRemoved,
  children,
}: {
  home: HomeKitHome;
  developerMode?: boolean;
  onCloudRelayRemoved?: () => void;
  /** The sub-section list, on layouts that have no sidebar to show it. */
  children?: React.ReactNode;
}) {
  // Dismissed for good, by id *and* name — a home's id varies in case between
  // sources and can be re-minted, and the old one-key-per-id scheme let the
  // notice come back when it did. See lib/notice-dismissal.ts.
  // Recomputed per home rather than read once into state: this component is
  // reused across homes, so a `useState` initializer would answer for whichever
  // home happened to mount it first.
  const [dismissTick, setDismissTick] = useState(0);
  const editRightsDismissed = useMemo(
    () => isNoticeDismissed('editrights', { id: home.id, name: home.name }, [`hc_editrights_dismissed_${home.id}`]),
    [home.id, home.name, dismissTick],
  );
  const dismissEditRights = useCallback(() => {
    dismissNotice('editrights', { id: home.id, name: home.name });
    setDismissTick(t => t + 1);
  }, [home.id, home.name]);
  const [accessDialogOpen, setAccessDialogOpen] = useState(false);

  const isOwner = !home.role || home.role === 'owner';
  const isShared = !isOwner;
  const isCloudManaged = home.isCloudManaged === true;

  // Active cloud-managed enrollment backing this home (removal lives here on
  // the individual home page, not in the homes list).
  const { data: enrollmentsData } = useQuery<MyCloudManagedEnrollmentsResponse>(GET_MY_ENROLLMENTS, {
    skip: !isCloudManaged || isCommunity,
    fetchPolicy: 'cache-and-network',
  });
  const cloudEnrollment = (enrollmentsData?.myCloudManagedEnrollments || []).find(
    e => e.status === 'active' && (
      (e.matchedHomeId && e.matchedHomeId.toUpperCase() === home.id.toUpperCase()) ||
      (e.matchedHomeName || e.homeName).toLowerCase() === home.name.toLowerCase()
    )
  );
  const [cancelEnrollment] = useMutation(CANCEL_CLOUD_MANAGED_ENROLLMENT);
  const [removingRelay, setRemovingRelay] = useState(false);
  const handleRemoveFromCloudRelay = async () => {
    if (!cloudEnrollment) return;
    setRemovingRelay(true);
    try {
      await cancelEnrollment({ variables: { enrollmentId: cloudEnrollment.id } });
      toast.success(`${home.name} removed from cloud relay`);
      onCloudRelayRemoved?.();
    } catch {
      toast.error('Failed to remove home from cloud relay');
    } finally {
      setRemovingRelay(false);
    }
  };

  const relayKindLabel = isCloudManaged ? 'Cloud Relay' : 'Self-hosted relay';
  const RelayKindIcon = isCloudManaged ? Cloud : Monitor;
  const roleLabel = isShared
    ? (home.role === 'admin' ? 'Admin'
       : home.role === 'view' ? 'View'
       : home.role === 'control' ? 'Control'
       : 'Shared')
    : null;
  const relayOnline = home.relayConnected === true;

  return (
    <div className="space-y-4">
      {/* Optional prompt: grant the relay editing rights so Homecast can manage
          HomeKit scenes and automations. One line — the home works without it,
          so the explanation lives behind "How" rather than above the home's own
          details. Dismissing hides it for this home for good. */}
      {!isCommunity && home.isAdmin === false && !editRightsDismissed && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/5 px-3 py-2">
          <Sparkles className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
          <p className="min-w-0 flex-1 truncate text-xs">
            <span className="font-medium">Give the relay Full access</span>
            <span className="text-muted-foreground"> — optional</span>
          </p>
          <button
            onClick={() => setAccessDialogOpen(true)}
            className="shrink-0 text-xs font-medium text-amber-700 hover:underline dark:text-amber-500"
          >
            How
          </button>
          <button
            onClick={dismissEditRights}
            className="shrink-0 text-muted-foreground/60 hover:text-foreground"
            title="Dismiss"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {accessDialogOpen && (
        <RelayFullAccessDialog
          open={accessDialogOpen}
          onOpenChange={setAccessDialogOpen}
          relayKind={isCloudManaged ? 'cloud' : 'self-hosted'}
          relayEmail={cloudEnrollment?.inviteEmail}
        />
      )}

      {/* Connection / Home */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{isCommunity ? 'Home' : 'Connection'}</p>
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-xs">
          {!isCommunity && (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <RelayKindIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium">{relayKindLabel}</span>
                </div>
                <span className={`flex items-center gap-1.5 font-medium px-1.5 py-0.5 rounded-full ${
                  relayOnline
                    ? 'bg-green-500/10 text-green-600'
                    : 'bg-red-500/10 text-red-600'
                }`}>
                  {relayOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                  {relayOnline ? 'Online' : 'Offline'}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-muted-foreground">Last online</span>
                <span className="font-medium">
                  {home.relayLastSeenAt ? formatRelativeAgo(home.relayLastSeenAt) : 'Never'}
                </span>
              </div>

              {roleLabel && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Your access</span>
                  <span className="font-medium">{roleLabel}</span>
                </div>
              )}

              {isShared && home.ownerEmail && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground shrink-0">Home owner</span>
                  <span className="font-medium truncate max-w-[180px]" title={home.ownerEmail}>{home.ownerEmail}</span>
                </div>
              )}

              {home.relayOwnerEmail && home.relayOwnerEmail !== home.ownerEmail && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground shrink-0 flex items-center gap-1">
                    <Users className="h-3 w-3" /> Relay operator
                  </span>
                  <span className="font-medium break-all text-right">{home.relayOwnerEmail}</span>
                </div>
              )}
            </>
          )}

          {/* Relay's Apple Home permission level (reported by relay 1.1.2+; hidden when unknown) */}
          {typeof home.isAdmin === 'boolean' && (
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Apple Home access</span>
                {/* View-only is the one value with something to do about it, so
                    it doubles as the way back to the instructions once the
                    notice above has been dismissed for good. */}
                {home.isAdmin === false ? (
                  <button
                    onClick={() => setAccessDialogOpen(true)}
                    className="font-medium underline decoration-dotted underline-offset-2 hover:text-foreground"
                  >
                    {homeAccessLabel(home.isAdmin)}
                  </button>
                ) : (
                  <span className="font-medium">{homeAccessLabel(home.isAdmin)}</span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground/70 leading-snug">
                {homeAccessHint(home.isAdmin)}
              </p>
            </div>
          )}

          <div className="flex justify-between">
            <span className="text-muted-foreground">Accessories</span>
            <span className="font-medium">{home.accessoryCount ?? 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Rooms</span>
            <span className="font-medium">{home.roomCount ?? 0}</span>
          </div>

          {!isCommunity && home.relayId && (
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground shrink-0">Relay ID</span>
              <span className="font-mono text-[10px] truncate max-w-[180px]" title={home.relayId}>{home.relayId}</span>
            </div>
          )}

          {developerMode && (
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground shrink-0">Home ID</span>
              <span className="font-mono text-[10px] truncate max-w-[180px]" title={home.id}>{home.id}</span>
            </div>
          )}
        </div>
      </div>

      {children}

      {/* Remove from cloud relay — only for the enrollment owner of a cloud-managed home */}
      {isCloudManaged && cloudEnrollment && (
        <div className="flex justify-end pt-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-xs text-destructive hover:text-destructive" disabled={removingRelay}>
                {removingRelay ? 'Removing…' : 'Remove Home from Cloud Relay'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent style={{ zIndex: 10050 }}>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove "{home.name}" from the cloud relay?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2">
                    <p>
                      This disconnects the home from Homecast — remote access, API, and automations
                      through Homecast stop working. Your Apple Home itself is untouched, and you
                      can re-enroll at any time.
                    </p>
                    {cloudEnrollment?.inviteEmail && (
                      <p>
                        We recommend also removing the relay from your home: in the Apple Home app,
                        open <strong>Home Settings</strong>, tap{' '}
                        <strong className="font-mono text-xs">{cloudEnrollment.inviteEmail}</strong>{' '}
                        and choose <strong>Remove</strong>.
                      </p>
                    )}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => { void handleRemoveFromCloudRelay(); }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}
