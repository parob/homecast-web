import { useState, useMemo, useEffect, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { useParams } from 'react-router-dom';
import { useQuery } from '@apollo/client/react';
import { GET_PUBLIC_ENTITY } from '@/lib/graphql/queries';
import type { SharedEntityData, GetPublicEntityResponse, BackgroundSettings } from '@/lib/graphql/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Folder,
  FolderOpen,
  Lock,
  Loader2,
  AlertCircle,
  Home as HomeIcon,
  Lightbulb,
  DoorClosed,
  Layers,
  Zap,
  Eye,
  KeyRound,
  Wifi,
} from 'lucide-react';
import { SharedCollectionView } from '@/components/shared/SharedCollectionView';
import { SharedRoomView } from '@/components/shared/SharedRoomView';
import { SharedHomeView } from '@/components/shared/SharedHomeView';
import { SharedAccessoryView } from '@/components/shared/SharedAccessoryView';
import { SharedAccessoryGroupView } from '@/components/shared/SharedAccessoryGroupView';
import { SharedRoomGroupView } from '@/components/shared/SharedRoomGroupView';
import { useBackgroundContext } from '@/contexts/BackgroundContext';
import { checkIsInMacApp } from '@/lib/platform';

// Detect if running inside a mobile native app WebView (iOS or Android)
const checkIsInMobileApp = () => {
  if (typeof window === 'undefined') return false;
  const w = window as any;
  if (w.isHomecastIOSApp) return true;
  if (w.navigator?.standalone && /iPhone|iPad|iPod/.test(navigator.userAgent)) return true;
  if (w.isHomecastAndroidApp) return true;
  return false;
};

// Entity type to display name
const ENTITY_TYPE_NAMES: Record<string, string> = {
  collection: 'Collection',
  collection_group: 'Group',
  room: 'Room',
  accessory_group: 'Accessory Group',
  home: 'Home',
  accessory: 'Accessory',
  room_group: 'Room Group',
};

// Entity type to icon (matching dashboard sidebar icons)
const ENTITY_TYPE_ICONS: Record<string, typeof Folder> = {
  collection: Folder,
  collection_group: FolderOpen,
  room: DoorClosed,
  accessory_group: Layers,
  home: HomeIcon,
  accessory: Lightbulb,
  room_group: Layers,
};

/** Header content that reads dark mode from BackgroundContext (rendered inside MainLayout) */
function SharedHeaderContent({ icon: Icon, title, subtitle }: { icon: typeof Folder; title: string; subtitle?: string | null }) {
  const { isDarkBackground } = useBackgroundContext();
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center shrink-0">
        <Icon className="h-5 w-5 text-primary-foreground" />
      </div>
      <div className="min-w-0">
        <h1 className={`text-lg font-normal truncate leading-tight ${isDarkBackground ? 'text-white' : ''}`}>{title}</h1>
        {subtitle && (
          <p className={`text-sm truncate leading-tight ${isDarkBackground ? 'text-white/70' : 'text-muted-foreground'}`}>{subtitle}</p>
        )}
      </div>
    </div>
  );
}

/** Status bar that reads dark mode from BackgroundContext (rendered inside MainLayout) */
function SharedStatusBar({
  role, wsSubscribed, accessoriesCount, canUpgrade,
  upgradeDialogOpen, setUpgradeDialogOpen,
  upgradePasscode, setUpgradePasscode,
  upgradeError, setUpgradeError, onUpgradeSubmit,
}: {
  role: string;
  wsSubscribed: boolean;
  accessoriesCount: number;
  canUpgrade: boolean;
  upgradeDialogOpen: boolean;
  setUpgradeDialogOpen: (open: boolean) => void;
  upgradePasscode: string;
  setUpgradePasscode: (v: string) => void;
  upgradeError: string | null;
  setUpgradeError: (v: string | null) => void;
  onUpgradeSubmit: (e: React.FormEvent) => void;
}) {
  const { isDarkBackground } = useBackgroundContext();
  const RoleIcon = role === 'control' ? Zap : Eye;

  return (
    <div className="mb-6">
      <div className={cn(
        "inline-flex items-center gap-2 text-sm",
        isDarkBackground
          ? "text-white/70 bg-black/40 backdrop-blur-xl rounded-full px-4 py-2"
          : "text-muted-foreground"
      )}>
        <span className="flex items-center gap-1">
          <RoleIcon className="h-3 w-3" />
          {role === 'control' ? 'Control Access' : 'View Only'}
        </span>
        {wsSubscribed && (
          <>
            <span>·</span>
            <span className="flex items-center gap-1 text-green-600">
              <Wifi className="h-3 w-3" />
              Live
            </span>
          </>
        )}
        {accessoriesCount > 0 && (
          <>
            <span>·</span>
            <span>{accessoriesCount} accessor{accessoriesCount !== 1 ? 'ies' : 'y'}</span>
          </>
        )}
        {canUpgrade && (
          <>
            <button
              className="flex items-center gap-1 text-primary hover:underline"
              onClick={() => setUpgradeDialogOpen(true)}
            >
              <KeyRound className="h-3 w-3" />
              Unlock Control
            </button>
            <Dialog open={upgradeDialogOpen} onOpenChange={setUpgradeDialogOpen}>
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle>Enter Passcode</DialogTitle>
                  <DialogDescription>
                    Enter the control passcode to unlock full access.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={onUpgradeSubmit} className="space-y-3">
                  <div className="space-y-2">
                    <Input
                      type="password"
                      placeholder="Passcode"
                      value={upgradePasscode}
                      onChange={(e) => {
                        setUpgradePasscode(e.target.value);
                        setUpgradeError(null);
                      }}
                      autoFocus
                    />
                    {upgradeError && (
                      <p className="text-xs text-destructive">{upgradeError}</p>
                    )}
                  </div>
                  <Button type="submit" size="sm" className="w-full" disabled={!upgradePasscode.trim()}>
                    Unlock
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    </div>
  );
}

export default function SharedEntityPage() {
  const { hash } = useParams<{ hash: string }>();
  const [passcode, setPasscode] = useState('');
  const [submittedPasscode, setSubmittedPasscode] = useState<string | null>(null);

  // State for upgrade passcode popover
  const [upgradePasscode, setUpgradePasscode] = useState('');
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  // Platform detection state
  const [isInMacApp, setIsInMacApp] = useState(false);
  const [isInMobileApp, setIsInIOSApp] = useState(false);

  // Sidebar state for external sidebar control
  const [sidebarContent, setSidebarContent] = useState<React.ReactNode>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);

  // Metadata reported by child views after their accessories query loads
  const [accessoriesMeta, setAccessoriesMeta] = useState<{
    count: number; entityName: string | null; background: BackgroundSettings | undefined;
  } | null>(null);

  // WebSocket status reported by child views (for Live indicator)
  const [wsSubscribed, setWsSubscribed] = useState(false);

  // Callback for child views to set sidebar content
  const handleSetSidebar = useCallback((sidebar: React.ReactNode) => {
    setSidebarContent(sidebar);
  }, []);

  // Callback for child views to report loaded accessories metadata
  const handleAccessoriesLoaded = useCallback((meta: { count: number; entityName: string | null; background: BackgroundSettings | undefined }) => {
    setAccessoriesMeta(meta);
  }, []);

  // Callback for child views to report WebSocket subscription status
  const handleWsStatusChange = useCallback((subscribed: boolean) => {
    setWsSubscribed(subscribed);
  }, []);

  useEffect(() => {
    const check = () => {
      const macResult = checkIsInMacApp();
      const iosResult = checkIsInMobileApp();
      return { mac: macResult, ios: iosResult };
    };
    const result = check();
    setIsInMacApp(result.mac);
    setIsInIOSApp(result.ios);
    const timer = setTimeout(() => {
      const result = check();
      setIsInMacApp(result.mac);
      setIsInIOSApp(result.ios);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // Fetch public entity by share hash
  const { data, loading, error, refetch } = useQuery<GetPublicEntityResponse>(
    GET_PUBLIC_ENTITY,
    {
      variables: {
        shareHash: hash,
        passcode: submittedPasscode,
      },
      skip: !hash,
      fetchPolicy: 'network-only',
    }
  );

  const entity = data?.publicEntity;
  const requiresPasscode = entity?.requiresPasscode && !submittedPasscode;

  // Derive header/status values from child-reported metadata
  const accessoriesCount = accessoriesMeta?.count ?? 0;
  const resolvedBackground = accessoriesMeta?.background;

  // Determine header title based on entity type (doesn't change with room/group selection)
  // Must be before early returns to follow Rules of Hooks
  const headerInfo = useMemo(() => {
    if (!entity) {
      return { icon: FolderOpen, title: 'Loading...', subtitle: null };
    }

    const entityTypeName = ENTITY_TYPE_NAMES[entity.entityType] || 'Item';

    if (entity.entityType === 'home') {
      return {
        icon: HomeIcon,
        title: accessoriesMeta?.entityName || entity.entityName || 'Home',
        subtitle: null,
      };
    }

    if (entity.entityType === 'collection' || entity.entityType === 'collection_group') {
      return {
        icon: Folder,
        title: accessoriesMeta?.entityName || entity.entityName || 'Collection',
        subtitle: null,
      };
    }

    return {
      icon: ENTITY_TYPE_ICONS[entity.entityType] || FolderOpen,
      title: accessoriesMeta?.entityName || entity.entityName || entityTypeName,
      subtitle: null,
    };
  }, [entity, accessoriesMeta?.entityName]);

  const handleSubmitPasscode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode.trim()) return;
    setSubmittedPasscode(passcode);
  };

  const handleTryAgain = () => {
    setSubmittedPasscode(null);
    setPasscode('');
  };

  const handleUpgradePasscode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!upgradePasscode.trim()) return;

    setUpgradeError(null);

    // Refetch with the upgrade passcode
    const result = await refetch({
      shareHash: hash,
      passcode: upgradePasscode,
    });

    if (result.data?.publicEntity?.role === 'control') {
      // Success - upgrade worked
      setSubmittedPasscode(upgradePasscode);
      setUpgradeDialogOpen(false);
      setUpgradePasscode('');
    } else {
      // Passcode didn't grant control access
      setUpgradeError('Invalid passcode');
    }
  };

  // Callback for child views to request passcode upgrade dialog
  const handleRequestPasscodeUpgrade = useCallback(() => {
    setUpgradeDialogOpen(true);
  }, []);

  // Shared footer component
  const sharedFooter = (
    <footer className="max-w-6xl mx-auto px-4 py-8 text-center">
      <a
        href="https://homecast.cloud"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>Shared via</span>
        <div className="flex items-center gap-1.5">
          <div className="h-5 w-5 rounded bg-primary flex items-center justify-center">
            <HomeIcon className="h-3 w-3 text-primary-foreground" />
          </div>
          <span className="font-medium">Homecast</span>
        </div>
      </a>
    </footer>
  );

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Passcode prompt (show if entity requires passcode)
  if (requiresPasscode) {
    const EntityIcon = entity?.entityType ? ENTITY_TYPE_ICONS[entity.entityType] || FolderOpen : Lock;
    const entityTypeName = entity?.entityType ? ENTITY_TYPE_NAMES[entity.entityType] || 'Item' : 'Item';

    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="flex-1 flex items-center justify-center p-4">
          <Card className="max-w-md w-full">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Lock className="h-6 w-6 text-primary" />
              </div>
              <CardTitle>Protected {entityTypeName}</CardTitle>
              <CardDescription>
                This {entityTypeName.toLowerCase()} requires a passcode to access.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmitPasscode} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="passcode">Passcode</Label>
                  <Input
                    id="passcode"
                    type="password"
                    placeholder="Enter passcode"
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    autoFocus
                  />
                </div>
                <Button type="submit" className="w-full" disabled={!passcode.trim()}>
                  Continue
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
        {sharedFooter}
      </div>
    );
  }

  // Entity not found or access denied
  if (!entity || error) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="flex-1 flex items-center justify-center p-4">
          <Card className="max-w-md w-full">
            <CardContent className="pt-6">
              <div className="text-center">
                <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto" />
                <h2 className="mt-4 text-xl font-semibold">
                  {submittedPasscode ? 'Access Denied' : 'Not Found'}
                </h2>
                <p className="mt-2 text-muted-foreground">
                  {submittedPasscode
                    ? 'The passcode is incorrect or you do not have access.'
                    : 'This shared link is invalid or the item is no longer being shared.'}
                </p>
                {submittedPasscode && (
                  <div className="mt-6">
                    <Button variant="outline" onClick={handleTryAgain}>
                      Try Again
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
        {sharedFooter}
      </div>
    );
  }

  // Render entity based on type
  const entityTypeName = ENTITY_TYPE_NAMES[entity.entityType] || 'Item';
  const HeaderIcon = headerInfo.icon;

  const headerContent = (
    <SharedHeaderContent icon={HeaderIcon} title={headerInfo.title} subtitle={headerInfo.subtitle} />
  );

  const statusBar = (
    <SharedStatusBar
      role={entity.role}
      wsSubscribed={wsSubscribed}
      accessoriesCount={accessoriesCount}
      canUpgrade={!!entity.canUpgradeWithPasscode && entity.role === 'view'}
      upgradeDialogOpen={upgradeDialogOpen}
      setUpgradeDialogOpen={setUpgradeDialogOpen}
      upgradePasscode={upgradePasscode}
      setUpgradePasscode={setUpgradePasscode}
      upgradeError={upgradeError}
      setUpgradeError={setUpgradeError}
      onUpgradeSubmit={handleUpgradePasscode}
    />
  );

  return (
    <MainLayout
      headerContent={headerContent}
      isInMacApp={isInMacApp}
      isInMobileApp={isInMobileApp}
      footer={sharedFooter}
      sidebar={sidebarContent}
      background={resolvedBackground}
    >
      {statusBar}
      {entity.entityType === 'collection' || entity.entityType === 'collection_group' ? (
        <SharedCollectionView
          entityData={entity}
          shareHash={hash!}
          passcode={submittedPasscode}
          renderSidebar={entity.entityType === 'collection' ? handleSetSidebar : undefined}
          externalSelectedGroup={selectedGroup}
          onExternalGroupSelect={setSelectedGroup}
          onWsStatusChange={handleWsStatusChange}
          onAccessoriesLoaded={handleAccessoriesLoaded}
          onRequestPasscodeUpgrade={entity.canUpgradeWithPasscode && entity.role === 'view' ? handleRequestPasscodeUpgrade : undefined}
        />
      ) : entity.entityType === 'room' ? (
        <SharedRoomView
          entityData={entity}
          shareHash={hash!}
          passcode={submittedPasscode}
          onWsStatusChange={handleWsStatusChange}
          onAccessoriesLoaded={handleAccessoriesLoaded}
          onRequestPasscodeUpgrade={entity.canUpgradeWithPasscode && entity.role === 'view' ? handleRequestPasscodeUpgrade : undefined}
        />
      ) : entity.entityType === 'accessory' ? (
        <SharedAccessoryView
          entityData={entity}
          shareHash={hash!}
          passcode={submittedPasscode}
          onWsStatusChange={handleWsStatusChange}
          onAccessoriesLoaded={handleAccessoriesLoaded}
          onRequestPasscodeUpgrade={entity.canUpgradeWithPasscode && entity.role === 'view' ? handleRequestPasscodeUpgrade : undefined}
        />
      ) : entity.entityType === 'home' ? (
        <SharedHomeView
          entityData={entity}
          shareHash={hash!}
          passcode={submittedPasscode}
          renderSidebar={handleSetSidebar}
          externalSelectedRoom={selectedRoom}
          onExternalRoomSelect={setSelectedRoom}
          onWsStatusChange={handleWsStatusChange}
          onAccessoriesLoaded={handleAccessoriesLoaded}
          onRequestPasscodeUpgrade={entity.canUpgradeWithPasscode && entity.role === 'view' ? handleRequestPasscodeUpgrade : undefined}
        />
      ) : entity.entityType === 'accessory_group' ? (
        <SharedAccessoryGroupView
          entityData={entity}
          shareHash={hash!}
          passcode={submittedPasscode}
          onWsStatusChange={handleWsStatusChange}
          onAccessoriesLoaded={handleAccessoriesLoaded}
          onRequestPasscodeUpgrade={entity.canUpgradeWithPasscode && entity.role === 'view' ? handleRequestPasscodeUpgrade : undefined}
        />
      ) : entity.entityType === 'room_group' ? (
        <SharedRoomGroupView
          entityData={entity}
          shareHash={hash!}
          passcode={submittedPasscode}
          renderSidebar={handleSetSidebar}
          externalSelectedRoom={selectedRoom}
          onExternalRoomSelect={setSelectedRoom}
          onWsStatusChange={handleWsStatusChange}
          onAccessoriesLoaded={handleAccessoriesLoaded}
          onRequestPasscodeUpgrade={entity.canUpgradeWithPasscode && entity.role === 'view' ? handleRequestPasscodeUpgrade : undefined}
        />
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Folder className="h-12 w-12 text-muted-foreground mx-auto" />
            <h3 className="mt-4 text-lg font-medium">{entityTypeName} View</h3>
            <p className="mt-2 text-muted-foreground">
              Viewing shared {entityTypeName.toLowerCase()}: {entity.entityName || entity.entityId}
            </p>
          </CardContent>
        </Card>
      )}
    </MainLayout>
  );
}
