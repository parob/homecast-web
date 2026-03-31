import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
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
import { LogOut, Trash2 } from 'lucide-react';
import { config, isCommunity } from '@/lib/config';
import { isRelayCapable } from '@/native/homekit-bridge';

interface AccountSectionProps {
  userEmail: string | undefined;
  developerMode: boolean;
  toggleDeveloperMode: (value: boolean) => void;
  settingSaveError: string | null;
  logout: () => void;
  resetAndUninstall?: () => Promise<void>;
  serverVersion: string | undefined;
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
  return (
    <div className="space-y-6">
      {userEmail && (
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
