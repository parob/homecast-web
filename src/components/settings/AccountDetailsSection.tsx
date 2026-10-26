import { useState } from 'react';
import { useMutation } from '@apollo/client/react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PasswordRequirements, validatePassword } from '@/components/ui/password-requirements';
import { useAuth } from '@/contexts/AuthContext';
import { CHANGE_MY_PASSWORD, UPDATE_MY_NAME } from '@/lib/graphql/mutations';

/**
 * Who you are signed in as, and the two things about it you can change: your
 * name and your password (Cloud only — Community accounts live on the relay
 * and are managed from its Users list).
 *
 * Before this the name given at signup could never be changed, and changing a
 * password meant signing out to use the reset email. The server asks for the
 * current password again, as account deletion does.
 */

export interface AccountChangeResult {
  success: boolean;
  error?: string | null;
}

export interface AccountDetailsViewProps {
  email: string;
  name: string | null;
  onSaveName: (name: string) => Promise<AccountChangeResult>;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<AccountChangeResult>;
}

const MAX_NAME_LENGTH = 100;

/** The server's normalisation, so the row shows what was actually saved. */
function normaliseName(name: string): string {
  return name.split(/\s+/).filter(Boolean).join(' ');
}

function failure(e: unknown): AccountChangeResult {
  return { success: false, error: e instanceof Error ? e.message : 'Something went wrong. Please try again.' };
}

export function AccountDetailsView({ email, name, onSaveName, onChangePassword }: AccountDetailsViewProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Signed in as</p>
        <p className="text-sm font-medium">{email}</p>
      </div>
      <NameRow name={name} onSave={onSaveName} />
      <PasswordRow onChange={onChangePassword} />
    </div>
  );
}

function NameRow({ name, onSave }: { name: string | null; onSave: AccountDetailsViewProps['onSaveName'] }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEditing = () => {
    setDraft(name ?? '');
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    let result: AccountChangeResult;
    try {
      result = await onSave(draft);
    } catch (e) {
      result = failure(e);
    }
    setSaving(false);
    if (result.success) {
      setEditing(false);
    } else {
      setError(result.error || 'Your name could not be saved. Please try again.');
    }
  };

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Name</p>
          <p className="text-xs text-muted-foreground truncate" data-testid="account-name">{name || 'Not set'}</p>
        </div>
        <Button variant="outline" size="sm" onClick={startEditing}>Edit</Button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="account-name-input" className="text-sm font-medium">Name</Label>
      <div className="flex gap-2">
        <Input
          id="account-name-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="name"
          autoFocus
          disabled={saving}
          className="h-8 text-sm"
        />
        <Button size="sm" onClick={save} disabled={saving || normaliseName(draft) === (name ?? '')}>
          {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
      </div>
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );
}

function PasswordRow({ onChange }: { onChange: AccountDetailsViewProps['onChangePassword'] }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [showNext, setShowNext] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = (isOpen: boolean) => {
    if (saving) return;
    setOpen(isOpen);
    if (!isOpen) {
      setCurrent('');
      setNext('');
      setShowNext(false);
      setError(null);
    }
  };

  const ready = !!current && validatePassword(next) === null && !saving;

  const submit = async () => {
    if (!ready) return;
    setSaving(true);
    setError(null);
    let result: AccountChangeResult;
    try {
      result = await onChange(current, next);
    } catch (e) {
      result = failure(e);
    }
    setSaving(false);
    if (result.success) {
      reset(false);
    } else {
      setError(result.error || 'Your password could not be changed. Please try again.');
    }
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium">Password</p>
        <p className="text-xs text-muted-foreground">Change the password you sign in with</p>
      </div>
      <Button variant="outline" size="sm" onClick={() => reset(true)}>Change</Button>

      <Dialog open={open} onOpenChange={reset}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>Enter your current password, then choose a new one.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1 text-sm">
            <div className="space-y-1.5">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                disabled={saving}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showNext ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                  disabled={saving}
                  className="pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowNext(v => !v)}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
                  aria-label={showNext ? 'Hide password' : 'Show password'}
                >
                  {showNext ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <PasswordRequirements password={next} />
            </div>
            {error && <p className="text-destructive" role="alert">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => reset(false)} disabled={saving}>Cancel</Button>
            <Button onClick={submit} disabled={!ready}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Change Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function AccountDetailsSection({ email }: { email: string }) {
  const { user } = useAuth();
  // The auth context's user is not refreshed by a save, so the row keeps its
  // own copy rather than showing the old name until the next sign-in.
  const [savedName, setSavedName] = useState<string | null | undefined>(undefined);
  const [updateMyName] = useMutation<{ updateMyName: AccountChangeResult }>(UPDATE_MY_NAME);
  const [changeMyPassword] = useMutation<{ changeMyPassword: AccountChangeResult }>(CHANGE_MY_PASSWORD);

  const name = savedName !== undefined ? savedName : (user?.name ?? null);

  return (
    <AccountDetailsView
      email={email}
      name={name}
      onSaveName={async (draft) => {
        const clean = normaliseName(draft);
        const res = await updateMyName({ variables: { name: clean || null } });
        const result = res.data?.updateMyName ?? { success: false, error: res.error?.message };
        if (result.success) {
          setSavedName(clean || null);
          toast.success(clean ? 'Name saved' : 'Name removed');
        }
        return result;
      }}
      onChangePassword={async (currentPassword, newPassword) => {
        const res = await changeMyPassword({ variables: { currentPassword, newPassword } });
        const result = res.data?.changeMyPassword ?? { success: false, error: res.error?.message };
        if (result.success) toast.success('Password changed');
        return result;
      }}
    />
  );
}
