import { useState } from 'react';
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
import { useQuery, useMutation } from '@apollo/client/react';
import { toast } from 'sonner';
import { isCommunity } from '@/lib/config';
import { GET_MY_ENROLLMENTS } from '@/lib/graphql/queries';
import { CANCEL_CLOUD_MANAGED_ENROLLMENT } from '@/lib/graphql/mutations';
import type { HomeKitHome, MyCloudManagedEnrollmentsResponse } from '@/lib/graphql/types';

/**
 * The active cloud-managed enrollment backing this home, if the signed-in user
 * owns one. The overview reads it for the relay's invite email; the removal
 * below needs it to cancel. Both ask the same Apollo query, so it is one fetch.
 */
export function useCloudEnrollment(home: Pick<HomeKitHome, 'id' | 'name' | 'isCloudManaged'>) {
  const isCloudManaged = home.isCloudManaged === true;
  const { data } = useQuery<MyCloudManagedEnrollmentsResponse>(GET_MY_ENROLLMENTS, {
    skip: !isCloudManaged || isCommunity,
    fetchPolicy: 'cache-and-network',
  });
  if (!isCloudManaged) return undefined;
  return (data?.myCloudManagedEnrollments || []).find(
    e => e.status === 'active' && (
      (e.matchedHomeId && e.matchedHomeId.toUpperCase() === home.id.toUpperCase()) ||
      (e.matchedHomeName || e.homeName).toLowerCase() === home.name.toLowerCase()
    )
  );
}

/**
 * Remove this home from the cloud relay — the one destructive action on the
 * home's page, so it sits at the very bottom, after every setting. Only the
 * enrollment's owner sees it.
 */
export function RemoveFromCloudRelay({
  home,
  onRemoved,
}: {
  home: HomeKitHome;
  onRemoved?: () => void;
}) {
  const cloudEnrollment = useCloudEnrollment(home);
  const [cancelEnrollment] = useMutation(CANCEL_CLOUD_MANAGED_ENROLLMENT);
  const [removingRelay, setRemovingRelay] = useState(false);
  const handleRemoveFromCloudRelay = async () => {
    if (!cloudEnrollment) return;
    setRemovingRelay(true);
    try {
      await cancelEnrollment({ variables: { enrollmentId: cloudEnrollment.id } });
      toast.success(`${home.name} removed from cloud relay`);
      onRemoved?.();
    } catch {
      toast.error('Failed to remove home from cloud relay');
    } finally {
      setRemovingRelay(false);
    }
  };

  if (!cloudEnrollment) return null;

  return (
    <div className="flex justify-end border-t pt-4">
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
  );
}
