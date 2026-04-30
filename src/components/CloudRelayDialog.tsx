import { useState, useCallback } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Cloud, Plus, Home as HomeIcon } from 'lucide-react';
import { usePricing, getPricing } from '@/lib/pricing';
import { isNativePurchaseAvailable } from '@/lib/platform';
import { GET_MY_ENROLLMENTS } from '@/lib/graphql/queries';
import { CREATE_CLOUD_MANAGED_CHECKOUT, CANCEL_CLOUD_MANAGED_ENROLLMENT } from '@/lib/graphql/mutations';
import type {
  MyCloudManagedEnrollmentsResponse,
  CreateCloudManagedCheckoutResponse,
  CustomerEnrollmentInfo,
  HomeKitHome,
} from '@/lib/graphql/types';
import { toast } from 'sonner';

interface CloudRelayDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  homes: HomeKitHome[];
  prefilledHomeName?: string;
}

function statusBadge(status: string) {
  switch (status) {
    case 'active':
      return <Badge variant="default" className="text-[10px] px-1.5 py-0 bg-green-600">Active</Badge>;
    case 'pending':
      return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-yellow-500/20 text-yellow-700 dark:text-yellow-400">Pending</Badge>;
    case 'needs_home_id':
      return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-orange-500/20 text-orange-700 dark:text-orange-400">Needs Home ID</Badge>;
    case 'awaiting_relay':
      return <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Awaiting Relay</Badge>;
    default:
      return <Badge variant="outline" className="text-[10px] px-1.5 py-0">{status}</Badge>;
  }
}

function EnrollmentCard({ enrollment, onCancel }: { enrollment: CustomerEnrollmentInfo; onCancel: () => void }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <HomeIcon className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{enrollment.homeName}</span>
          {enrollment.region && <Badge variant="outline" className="text-[10px] px-1 py-0 uppercase">{enrollment.region}</Badge>}
        </div>
        {statusBadge(enrollment.status)}
      </div>
      <div className="space-y-0.5">
        <p className="text-xs text-muted-foreground">
          Cloud relay {enrollment.status === 'active' ? '· Active' : enrollment.status === 'pending' ? '· Pending' : enrollment.status === 'needs_home_id' ? '· Needs Home ID' : '· ' + enrollment.status}
        </p>
        {enrollment.matchedHomeName && (
          <p className="text-xs text-muted-foreground">Matched: {enrollment.matchedHomeName}</p>
        )}
        {enrollment.status === 'pending' && enrollment.inviteEmail && (
          <p className="text-xs text-muted-foreground">Invite {enrollment.inviteEmail} to your Apple Home</p>
        )}
        {enrollment.status === 'needs_home_id' && (
          <p className="text-xs text-muted-foreground">Multiple homes found with this name</p>
        )}
      </div>
      {enrollment.status !== 'active' && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" className="h-6 text-xs text-destructive hover:text-destructive" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
      {enrollment.status === 'active' && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" className="h-6 text-xs text-destructive hover:text-destructive" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

function SelfHostedHomeCard({ home }: { home: HomeKitHome }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <HomeIcon className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{home.name}</span>
        </div>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">Self-hosted</Badge>
      </div>
      <p className="text-xs text-muted-foreground">Connected via your Mac</p>
    </div>
  );
}

export function CloudRelayDialog({ open, onOpenChange, homes, prefilledHomeName }: CloudRelayDialogProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [homeName, setHomeName] = useState(prefilledHomeName || '');
  const [loading, setLoading] = useState(false);
  const livePricing = usePricing();
  const PLACEHOLDER_PRICE = { amount: 0, symbol: '', formatted: '—' };
  const pricing = livePricing ?? (
    isNativePurchaseAvailable()
      ? { standard: PLACEHOLDER_PRICE, cloud: PLACEHOLDER_PRICE }
      : getPricing()
  );

  const { data, refetch } = useQuery<MyCloudManagedEnrollmentsResponse>(GET_MY_ENROLLMENTS, {
    skip: !open,
    fetchPolicy: 'network-only',
  });

  const [createCheckout] = useMutation<CreateCloudManagedCheckoutResponse>(CREATE_CLOUD_MANAGED_CHECKOUT);
  const [cancelEnrollment] = useMutation(CANCEL_CLOUD_MANAGED_ENROLLMENT);

  const enrollments = data?.myCloudManagedEnrollments || [];
  const enrolledHomeNames = new Set(enrollments.map(e => e.homeName.toLowerCase()));

  // Show self-hosted homes that don't have a cloud enrollment
  const selfHostedHomes = homes.filter(h => !enrolledHomeNames.has(h.name.toLowerCase()));

  const handleCancel = useCallback(async (enrollmentId: string) => {
    try {
      await cancelEnrollment({ variables: { enrollmentId } });
      toast.success('Enrollment cancelled');
      refetch();
    } catch {
      toast.error('Failed to cancel enrollment');
    }
  }, [cancelEnrollment, refetch]);

  const handleAdd = useCallback(async () => {
    if (!homeName.trim()) {
      toast.error('Please enter a home name');
      return;
    }
    setLoading(true);
    try {
      const { data: result } = await createCheckout({
        variables: { homeName: homeName.trim() },
      });
      const r = result?.createCloudManagedCheckout;
      if (r?.checkoutUrl) {
        window.location.href = r.checkoutUrl;
      } else if (r?.enrollmentId) {
        toast.success('Cloud relay enrollment created!');
        setAddDialogOpen(false);
        setHomeName('');
        refetch();
      } else if (r?.error) {
        toast.error(r.error);
      }
    } catch {
      toast.error('Failed to start checkout');
    } finally {
      setLoading(false);
    }
  }, [homeName, createCheckout, refetch]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg max-h-[80vh] flex flex-col p-0" style={{ zIndex: 10020 }}>
          <DialogHeader className="shrink-0 px-6 pt-6">
            <DialogTitle>Cloud Relay</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Manage how each home connects to Homecast.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-scroll scrollable-content">
            <div className="px-6 pb-6 space-y-2">
              {enrollments.length === 0 && selfHostedHomes.length === 0 && (
                <p className="text-xs text-muted-foreground py-4 text-center">No homes configured yet.</p>
              )}

              {/* Cloud managed enrollments first */}
              {enrollments.map((enrollment) => (
                <EnrollmentCard
                  key={enrollment.id}
                  enrollment={enrollment}
                  onCancel={() => handleCancel(enrollment.id)}
                />
              ))}

              {/* Self-hosted homes */}
              {selfHostedHomes.map((home) => (
                <SelfHostedHomeCard key={home.id} home={home} />
              ))}

              {/* Add button */}
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs mt-2"
                onClick={() => { setHomeName(prefilledHomeName || ''); setAddDialogOpen(true); }}
              >
                <Plus className="h-3 w-3 mr-1" /> Enroll Home
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Cloud Relay sub-dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-sm" style={{ zIndex: 10030 }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Cloud className="h-4 w-4" /> Enroll Home
            </DialogTitle>
            <DialogDescription className="sr-only">Enroll a home for managed relay</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-xs font-medium">Apple Home Name</label>
              <Input
                placeholder="My Home"
                value={homeName}
                onChange={(e) => setHomeName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                autoFocus
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {pricing.cloud.formatted}/mo.
              {!isNativePurchaseAvailable() && " You'll be redirected to Stripe to complete payment."}
            </p>
            <p className="text-xs text-amber-600">
              Requires an Apple Home Hub (Apple TV or HomePod) on your home network.
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
    </>
  );
}
