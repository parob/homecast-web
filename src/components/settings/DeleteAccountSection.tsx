import { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client/react';
import { Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { GET_ACCOUNT } from '@/lib/graphql/queries';
import { DELETE_MY_ACCOUNT } from '@/lib/graphql/mutations';
import { openManageSubscriptions } from '@/lib/purchase';

/**
 * Deleting your account from inside the app — App Store guideline 5.1.1(v),
 * which rejected 1.2.6 (80): an app that lets you create an account must let
 * you delete it, without emailing anyone (homecast-cloud#214).
 *
 * The server asks for the password again and cancels a Stripe subscription
 * before it deletes anything. What it cannot do is cancel an App Store
 * subscription — only the subscriber can, with Apple — so that case is said
 * here, before the button, with the route to Apple's own sheet.
 */

export interface DeleteAccountResult {
  success: boolean;
  error?: string | null;
}

export interface DeleteAccountViewProps {
  accountType: string | undefined;
  subscriptionSource: string | null | undefined;
  onDelete: (password: string) => Promise<DeleteAccountResult>;
  onDeleted: () => void;
  onManageAppleSubscription: () => void;
}

export function DeleteAccountView({
  accountType,
  subscriptionSource,
  onDelete,
  onDeleted,
  onManageAppleSubscription,
}: DeleteAccountViewProps) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reset = (next: boolean) => {
    if (deleting) return;
    setOpen(next);
    if (!next) {
      setPassword('');
      setError(null);
    }
  };

  const submit = async () => {
    if (!password || deleting) return;
    setDeleting(true);
    setError(null);
    let result: DeleteAccountResult;
    try {
      result = await onDelete(password);
    } catch (e) {
      result = { success: false, error: e instanceof Error ? e.message : 'Something went wrong. Please try again.' };
    }
    if (result.success) {
      onDeleted();
      return;
    }
    setDeleting(false);
    setError(result.error || 'Your account could not be deleted. Please try again.');
  };

  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium">Delete Account</p>
        <p className="text-xs text-muted-foreground">Permanently delete your account and all its data</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="text-destructive border-destructive/50 hover:bg-destructive hover:text-destructive-foreground"
        onClick={() => reset(true)}
      >
        <Trash2 className="h-4 w-4 mr-1.5" />
        Delete
      </Button>

      <Dialog open={open} onOpenChange={reset}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This permanently deletes your Homecast account and everything in it — homes and
              layouts, collections, automations, webhooks, API tokens, share links, history and
              notification settings. Anyone you shared a home with loses access. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1 text-sm">
            {subscriptionSource === 'apple' && (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 space-y-2" data-testid="apple-subscription-warning">
                <p>
                  Your subscription is billed by Apple. Deleting your account does <strong>not</strong> cancel
                  it — cancel it with Apple first, or you will keep being charged.
                </p>
                <Button variant="outline" size="sm" onClick={onManageAppleSubscription}>
                  Manage Subscription
                </Button>
              </div>
            )}
            {subscriptionSource === 'stripe' && (
              <p className="text-muted-foreground" data-testid="stripe-subscription-note">
                Your subscription is cancelled immediately and you won't be charged again.
              </p>
            )}
            {accountType === 'cloud' && (
              <p className="text-muted-foreground" data-testid="cloud-relay-note">
                The Homecast cloud relay stops serving your home. To finish, remove it from your home's
                people in the Apple Home app.
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="delete-account-password">Enter your password to confirm</Label>
              <Input
                id="delete-account-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                disabled={deleting}
              />
            </div>
            {error && <p className="text-destructive" role="alert">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => reset(false)} disabled={deleting}>Cancel</Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={submit}
              disabled={!password || deleting}
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Delete Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function DeleteAccountSection({ logout }: { logout: () => void }) {
  const { user } = useAuth();
  const { data } = useQuery<{ account?: { accountType?: string; subscriptionSource?: string | null } }>(GET_ACCOUNT);
  const [deleteMyAccount] = useMutation<{ deleteMyAccount: DeleteAccountResult }>(DELETE_MY_ACCOUNT);

  const accountType = data?.account?.accountType ?? user?.accountType;
  // A relay's Apple ID account and an admin are not a customer's own account;
  // the server refuses them, so there is nothing to offer.
  if (user?.isAdmin || accountType === 'managed') return null;

  return (
    <DeleteAccountView
      accountType={accountType}
      subscriptionSource={data?.account?.subscriptionSource}
      onDelete={async (password) => {
        const res = await deleteMyAccount({ variables: { password } });
        return res.data?.deleteMyAccount ?? { success: false, error: res.error?.message };
      }}
      onDeleted={logout}
      onManageAppleSubscription={openManageSubscriptions}
    />
  );
}
