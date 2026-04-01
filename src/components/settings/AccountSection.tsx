import { useState, useEffect, useCallback } from 'react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LogOut, Trash2, Plus, UserIcon, X, Shield, Key, Loader2 } from 'lucide-react';
import { config, isCommunity } from '@/lib/config';
import { isRelayCapable } from '@/native/homekit-bridge';

interface CommunityUser {
  id: string;
  name: string;
  role: string;
  createdAt: string;
}

interface AccountSectionProps {
  userEmail: string | undefined;
  developerMode: boolean;
  toggleDeveloperMode: (value: boolean) => void;
  settingSaveError: string | null;
  logout: () => void;
  resetAndUninstall?: () => Promise<void>;
  serverVersion: string | undefined;
}

async function communityGraphQL(operationName: string, variables: Record<string, unknown> = {}) {
  if (isRelayCapable()) {
    // Relay Mac: call handleGraphQL directly — avoids HTTP round-trip through Swift bridge
    const { handleGraphQL } = await import('@/server/local-graphql');
    return handleGraphQL({ operationName, variables });
  }
  const resp = await fetch(config.graphqlUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationName, query: '', variables }),
  });
  return resp.json();
}

export function AccountSection({
  userEmail,
  developerMode,
  toggleDeveloperMode,
  settingSaveError,
  logout,
  resetAndUninstall,
  serverVersion,
}: AccountSectionProps) {
  // Community auth management (relay Mac only)
  const showAuthManagement = isCommunity && isRelayCapable();
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [users, setUsers] = useState<CommunityUser[]>([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<string>('control');
  const [addError, setAddError] = useState('');

  const loadAuthState = useCallback(async () => {
    if (!showAuthManagement) return;
    try {
      const [authResult, usersResult] = await Promise.all([
        communityGraphQL('GetAuthEnabled'),
        communityGraphQL('GetCommunityUsers'),
      ]);
      setAuthEnabled(authResult?.data?.authEnabled ?? false);
      setUsers(usersResult?.data?.communityUsers ?? []);
    } catch {}
    setAuthLoading(false);
  }, [showAuthManagement]);

  useEffect(() => { loadAuthState(); }, [loadAuthState]);

  const toggleAuth = async (enabled: boolean) => {
    setAuthEnabled(enabled);
    await communityGraphQL('SetAuthEnabled', { enabled });
  };

  const addUser = async () => {
    if (!newUsername.trim() || !newPassword.trim()) {
      setAddError('Username and password are required');
      return;
    }
    setAddError('');
    try {
      const result = await communityGraphQL('CreateCommunityUser', {
        name: newUsername.trim(),
        password: newPassword,
        role: newRole,
      });
      if (result?.errors?.[0]) {
        setAddError(result.errors[0].message);
        return;
      }
      setNewUsername('');
      setNewPassword('');
      setNewRole('control');
      setShowAddUser(false);
      loadAuthState();
    } catch (e: any) {
      setAddError(e.message || 'Failed to create user');
    }
  };

  const deleteUser = async (userId: string) => {
    await communityGraphQL('DeleteCommunityUser', { userId });
    loadAuthState();
  };

  const [passwordDialogUser, setPasswordDialogUser] = useState<CommunityUser | null>(null);
  const [editPassword, setEditPassword] = useState('');
  const [editPasswordError, setEditPasswordError] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const changePassword = async () => {
    if (!passwordDialogUser || !editPassword.trim()) {
      setEditPasswordError('Password is required');
      return;
    }
    setChangingPassword(true);
    try {
      await communityGraphQL('ChangeCommunityUserPassword', { userId: passwordDialogUser.id, password: editPassword });
      setPasswordDialogUser(null);
      setEditPassword('');
      setEditPasswordError('');
    } catch (e: any) {
      setEditPasswordError(e.message || 'Failed to change password');
    }
    setChangingPassword(false);
  };

  return (
    <div className="space-y-6">
      {/* Community auth management */}
      {showAuthManagement && !authLoading && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Require Authentication</p>
              <p className="text-xs text-muted-foreground">
                {authEnabled
                  ? 'LAN clients must sign in with a username and password'
                  : 'Anyone on your network can access this relay'}
              </p>
            </div>
            <Switch checked={authEnabled} onCheckedChange={toggleAuth} />
          </div>

          {authEnabled && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5" />
                  Users
                </h4>
                <Button variant="ghost" size="sm" onClick={() => setShowAddUser(true)} className="h-7 px-2 text-xs">
                  <Plus className="h-3 w-3 mr-1" />
                  Add User
                </Button>
              </div>

              {users.length === 0 && !showAddUser && (
                <p className="text-xs text-muted-foreground">No users yet. Add a user so LAN clients can sign in.</p>
              )}

              {users.map(user => (
                <div key={user.id} className="flex items-center justify-between py-1.5 px-2 rounded-md bg-muted/50">
                  <div className="flex items-center gap-2">
                    <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm">{user.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{user.role}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" onClick={() => { setPasswordDialogUser(user); setEditPassword(''); setEditPasswordError(''); }}>
                      <Key className="h-3 w-3 mr-1" />
                      Change Password
                    </Button>
                    {user.role !== 'owner' && (
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive hover:text-destructive" onClick={() => deleteUser(user.id)}>
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}

              {/* Change Password Dialog */}
              <Dialog open={!!passwordDialogUser} onOpenChange={(open) => { if (!open) setPasswordDialogUser(null); }}>
                <DialogContent className="sm:max-w-sm">
                  <DialogHeader>
                    <DialogTitle>Change Password</DialogTitle>
                    <DialogDescription>
                      Set a new password for <span className="font-medium">{passwordDialogUser?.name}</span>
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3 py-2">
                    <div className="space-y-1.5">
                      <Label className="text-sm">New Password</Label>
                      <Input
                        type="password"
                        value={editPassword}
                        onChange={e => setEditPassword(e.target.value)}
                        placeholder="Enter new password"
                        onKeyDown={e => e.key === 'Enter' && changePassword()}
                        autoFocus
                      />
                    </div>
                    {editPasswordError && <p className="text-sm text-destructive">{editPasswordError}</p>}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setPasswordDialogUser(null)}>Cancel</Button>
                    <Button onClick={changePassword} disabled={changingPassword}>
                      {changingPassword ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Save Password
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {showAddUser && (
                <div className="space-y-2 rounded-md border p-2.5">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Username</Label>
                    <Input
                      value={newUsername}
                      onChange={e => setNewUsername(e.target.value.replace(/\s/g, ''))}
                      placeholder="username"
                      className="h-8 text-sm"
                      autoFocus
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Password</Label>
                    <Input
                      type="password"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder="••••••••"
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Role</Label>
                    <Select value={newRole} onValueChange={setNewRole}>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="control">Control</SelectItem>
                        <SelectItem value="view">View Only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {addError && <p className="text-xs text-destructive">{addError}</p>}
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" className="h-7 text-xs" onClick={addUser}>
                      Create User
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setShowAddUser(false); setAddError(''); }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="border-t" />
        </div>
      )}

      {userEmail && !showAuthManagement && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Signed in as</p>
          <p className="text-sm font-medium">{userEmail}</p>
        </div>
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Developer Mode</p>
            <p className="text-xs text-muted-foreground">Show API access, webhooks, and developer tools</p>
          </div>
          <div className="relative flex items-center">
            {settingSaveError === 'developerMode' && (
              <div className="absolute right-full mr-2 whitespace-nowrap rounded bg-destructive px-2 py-1 text-xs text-destructive-foreground shadow-lg">
                Failed to save
              </div>
            )}
            <Switch
              checked={developerMode}
              onCheckedChange={toggleDeveloperMode}
            />
          </div>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="text-destructive border-destructive/50 hover:bg-destructive hover:text-destructive-foreground">
              {isCommunity && isRelayCapable() ? (
                <><Trash2 className="h-4 w-4 mr-1.5" />Reset &amp; Uninstall</>
              ) : (
                <><LogOut className="h-4 w-4 mr-1.5" />Sign Out</>
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{isCommunity && isRelayCapable() ? 'Reset Homecast?' : 'Sign out?'}</AlertDialogTitle>
              <AlertDialogDescription>
                {isCommunity && isRelayCapable()
                  ? 'This will permanently delete all data including users, settings, collections, and automations. This cannot be undone.'
                  : 'Are you sure you want to sign out of Homecast?'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={isCommunity && isRelayCapable() ? () => resetAndUninstall?.() : logout}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isCommunity && isRelayCapable() ? 'Reset all data' : 'Sign out'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Version */}
      <div className="space-y-2 pt-4 border-t">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Version</h3>
        <div className="text-xs text-muted-foreground space-y-0.5">
          {config.version !== 'dev' && <div>Web: {config.version}</div>}
          {serverVersion && serverVersion !== 'dev' && <div>Server: {serverVersion}</div>}
          {(window as any).homecastAppVersion && (
            <div>App: {(window as any).homecastAppVersion}{(window as any).homecastAppBuild && (window as any).homecastAppBuild !== 'unknown' ? ` (${(window as any).homecastAppBuild})` : ''}</div>
          )}
        </div>
      </div>
    </div>
  );
}
