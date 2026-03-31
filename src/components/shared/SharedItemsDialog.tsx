import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { GET_MY_SHARED_ENTITIES, GET_AUTHORIZED_APPS, GET_CACHED_HOMES } from '@/lib/graphql/queries';
import { REVOKE_AUTHORIZED_APP, UPDATE_AUTHORIZED_APP } from '@/lib/graphql/mutations';
import type {
  GetMySharedEntitiesResponse,
  EntityType,
  GetAuthorizedAppsResponse,
  AuthorizedAppInfo,
  RevokeAuthorizedAppResponse,
  UpdateAuthorizedAppResponse,
  GetCachedHomesResponse,
} from '@/lib/graphql/types';
import { WELL_KNOWN_CLIENTS } from '@/lib/oauth-clients';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Share2,
  Folder,
  DoorClosed,
  Layers,
  Home as HomeIcon,
  Lightbulb,
  Loader2,
  Globe,
  Lock,
  Users,
  ChevronRight,
  Clock,
  Shield,
  Eye,
  Zap,
  ArrowLeft,
} from 'lucide-react';
import { ShareDialog } from './ShareDialog';

// Entity type to icon mapping
const ENTITY_TYPE_ICONS: Record<EntityType, typeof Folder> = {
  collection: Folder,
  collection_group: Layers,
  room: DoorClosed,
  room_group: Layers,
  accessory_group: Layers,
  home: HomeIcon,
  accessory: Lightbulb,
};

// Entity type to color mapping
const ENTITY_TYPE_COLORS: Record<EntityType, string> = {
  collection: 'bg-blue-500/10 text-blue-600',
  collection_group: 'bg-purple-500/10 text-purple-600',
  room: 'bg-amber-500/10 text-amber-600',
  room_group: 'bg-orange-500/10 text-orange-600',
  accessory_group: 'bg-pink-500/10 text-pink-600',
  home: 'bg-green-500/10 text-green-600',
  accessory: 'bg-yellow-500/10 text-yellow-600',
};

// Access type to icon and label mapping
const ACCESS_TYPE_INFO: Record<string, { icon: typeof Globe; label: string; color: string }> = {
  public: { icon: Globe, label: 'Public', color: 'text-green-600 bg-green-500/10' },
  passcode: { icon: Lock, label: 'Passcode', color: 'text-amber-600 bg-amber-500/10' },
  user: { icon: Users, label: 'User', color: 'text-blue-600 bg-blue-500/10' },
  member: { icon: Users, label: 'Member', color: 'text-violet-600 bg-violet-500/10' },
};

interface SharedItemsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SelectedEntity {
  entityType: EntityType;
  entityId: string;
  entityName: string;
}

interface HomePermission {
  homeId: string;
  homeName: string;
  enabled: boolean;
  role: 'view' | 'control';
}

function getAppLogo(app: AuthorizedAppInfo): string | null {
  if (app.logoUri) return app.logoUri;
  if (app.redirectDomain) {
    const wellKnown = WELL_KNOWN_CLIENTS[app.redirectDomain];
    if (wellKnown) return wellKnown.logoUrl;
  }
  return null;
}

function getAppName(app: AuthorizedAppInfo): string {
  if (app.clientName) return app.clientName;
  if (app.redirectDomain) {
    const wellKnown = WELL_KNOWN_CLIENTS[app.redirectDomain];
    if (wellKnown) return wellKnown.name;
  }
  return app.redirectDomain || app.clientId;
}

export function SharedItemsDialog({ open, onOpenChange }: SharedItemsDialogProps) {
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntity | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<AuthorizedAppInfo | null>(null);
  const [editingApp, setEditingApp] = useState<AuthorizedAppInfo | null>(null);
  const [homePermissions, setHomePermissions] = useState<HomePermission[]>([]);
  const tabSwitchedAt = useRef(0);

  const { data, loading, refetch } = useQuery<GetMySharedEntitiesResponse>(
    GET_MY_SHARED_ENTITIES,
    {
      fetchPolicy: 'cache-and-network',
      skip: !open,
    }
  );

  const { data: appsData, loading: appsLoading, refetch: refetchApps } = useQuery<GetAuthorizedAppsResponse>(
    GET_AUTHORIZED_APPS,
    {
      fetchPolicy: 'cache-and-network',
      skip: !open,
    }
  );

  const { data: homesData } = useQuery<GetCachedHomesResponse>(
    GET_CACHED_HOMES,
    {
      fetchPolicy: 'cache-first',
      skip: !open,
    }
  );

  const [revokeApp, { loading: revoking }] = useMutation<RevokeAuthorizedAppResponse>(
    REVOKE_AUTHORIZED_APP,
    {
      update(cache, { data }, { variables }) {
        if (data?.revokeAuthorizedApp.success && variables?.clientId) {
          cache.updateQuery<GetAuthorizedAppsResponse>(
            { query: GET_AUTHORIZED_APPS },
            (existing) => existing ? {
              authorizedApps: existing.authorizedApps.filter(
                app => app.clientId !== variables.clientId
              ),
            } : existing
          );
        }
      },
      onCompleted: (result) => {
        if (result.revokeAuthorizedApp.success) {
          setRevokeTarget(null);
        }
      },
    }
  );

  const [updateApp, { loading: updating }] = useMutation<UpdateAuthorizedAppResponse>(
    UPDATE_AUTHORIZED_APP,
    {
      onCompleted: (result) => {
        if (result.updateAuthorizedApp.success) {
          setEditingApp(null);
          refetchApps();
        }
      },
    }
  );

  const homes = homesData?.cachedHomes || [];
  const homeNameMap = new Map(homes.map(h => [h.id, h.name]));

  const sharedEntities = data?.mySharedEntities || [];
  const authorizedApps = appsData?.authorizedApps || [];

  // Initialize home permissions when editing an app
  useEffect(() => {
    if (editingApp && homes.length > 0) {
      let existingPerms: Record<string, string> = {};
      if (editingApp.homePermissions) {
        try {
          existingPerms = JSON.parse(editingApp.homePermissions);
        } catch { /* ignore */ }
      }

      setHomePermissions(homes.map(h => ({
        homeId: h.id,
        homeName: h.name,
        enabled: h.id in existingPerms,
        role: (existingPerms[h.id] as 'view' | 'control') || 'control',
      })));
    }
  }, [editingApp, homes]);

  // Group by entity (an entity can have multiple access entries)
  const entitiesByKey = sharedEntities.reduce((acc, entity) => {
    const key = `${entity.entityType}-${entity.entityId}`;
    if (!acc[key]) {
      acc[key] = {
        entityType: entity.entityType,
        entityId: entity.entityId,
        entityName: entity.entityName,
        accessEntries: [],
      };
    }
    acc[key].accessEntries.push({
      id: entity.id,
      accessType: entity.accessType,
      role: entity.role,
      name: entity.name,
      accessSchedule: entity.accessSchedule,
      createdAt: entity.createdAt,
    });
    return acc;
  }, {} as Record<string, {
    entityType: EntityType;
    entityId: string;
    entityName?: string | null;
    accessEntries: Array<{
      id: string;
      accessType: string;
      role: string;
      name?: string | null;
      accessSchedule?: string | null;
      createdAt?: string | null;
    }>;
  }>);

  const uniqueEntities = Object.values(entitiesByKey);

  const formatEntityId = (id: string) => {
    if (id.length > 12) {
      return `${id.slice(0, 6)}...${id.slice(-4)}`;
    }
    return id;
  };

  const handleEntityClick = (entity: typeof uniqueEntities[0]) => {
    const displayName = entity.entityName || `${entity.entityType.replace('_', ' ')}`;
    setSelectedEntity({
      entityType: entity.entityType,
      entityId: entity.entityId,
      entityName: displayName,
    });
  };

  const handleShareDialogClose = () => {
    setSelectedEntity(null);
    refetch();
  };

  const toggleHomeEnabled = (homeId: string) => {
    setHomePermissions(prev => prev.map(hp =>
      hp.homeId === homeId ? { ...hp, enabled: !hp.enabled } : hp
    ));
  };

  const setHomeRole = (homeId: string, role: 'view' | 'control') => {
    setHomePermissions(prev => prev.map(hp =>
      hp.homeId === homeId ? { ...hp, role, enabled: true } : hp
    ));
  };

  const handleSavePermissions = () => {
    if (!editingApp) return;
    const perms = homePermissions
      .filter(hp => hp.enabled)
      .reduce((acc, hp) => ({ ...acc, [hp.homeId]: hp.role }), {} as Record<string, string>);
    updateApp({
      variables: {
        clientId: editingApp.clientId,
        homePermissions: JSON.stringify(perms),
      },
    });
  };

  const renderEntityCard = (entity: typeof uniqueEntities[0]) => {
    const EntityIcon = ENTITY_TYPE_ICONS[entity.entityType] || Folder;
    const colorClass = ENTITY_TYPE_COLORS[entity.entityType] || 'bg-gray-500/10 text-gray-600';
    const displayName = entity.entityName || formatEntityId(entity.entityId);

    return (
      <div
        key={`${entity.entityType}-${entity.entityId}`}
        className="group flex items-center gap-3 p-3 rounded-lg border bg-card transition-all cursor-pointer hover:shadow-md hover:border-primary/50"
        onClick={() => handleEntityClick(entity)}
      >
        <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${colorClass}`}>
          <EntityIcon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium truncate">
            {displayName}
          </h4>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className="text-xs text-muted-foreground capitalize">
              {entity.entityType.replace('_', ' ')}
            </span>
            <span className="text-muted-foreground">·</span>
            {(() => {
              const nonMemberEntries = entity.accessEntries.filter(a => a.accessType !== 'member');
              const seen = new Set<string>();
              return nonMemberEntries.map((access) => {
                if (seen.has(access.accessType)) return null;
                seen.add(access.accessType);
                const accessInfo = ACCESS_TYPE_INFO[access.accessType] || ACCESS_TYPE_INFO.public;
                return (
                  <Badge key={access.id} variant="secondary" className={`h-5 text-[10px] gap-0.5 ${accessInfo.color}`}>
                    {accessInfo.label}
                  </Badge>
                );
              });
            })()}
            {(() => {
              const memberEntries = entity.accessEntries.filter(a => a.accessType === 'member');
              if (memberEntries.length === 0) return null;
              const pendingCount = memberEntries.filter(a => a.accessSchedule === 'pending').length;
              const accessInfo = ACCESS_TYPE_INFO.member;
              return (
                <>
                  <Badge variant="secondary" className={`h-5 text-[10px] gap-0.5 ${accessInfo.color}`}>
                    {memberEntries.length} {memberEntries.length === 1 ? 'Member' : 'Members'}
                  </Badge>
                  {pendingCount > 0 && (
                    <Badge variant="secondary" className="h-5 text-[10px] gap-0.5 text-amber-600 bg-amber-500/10">
                      <Clock className="h-3 w-3" />
                      {pendingCount} Pending
                    </Badge>
                  )}
                </>
              );
            })()}
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </div>
    );
  };

  const renderAppCard = (app: AuthorizedAppInfo) => {
    const logoUrl = getAppLogo(app);
    const appName = getAppName(app);
    const scopes = app.scope ? app.scope.split(' ').filter(Boolean) : [];

    let homePerms: Record<string, string> = {};
    if (app.homePermissions) {
      try {
        homePerms = JSON.parse(app.homePermissions);
      } catch { /* ignore */ }
    }
    const homePermEntries = Object.entries(homePerms);

    return (
      <div
        key={app.clientId}
        className="flex items-start gap-3 p-3 rounded-lg border bg-card cursor-pointer transition-all hover:shadow-md hover:border-primary/50 group"
        onClick={() => { if (Date.now() - tabSwitchedAt.current < 300) return; setEditingApp(app); }}
      >
        <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 bg-muted overflow-hidden">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={appName}
              className="h-10 w-10 rounded-lg object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <Shield className="h-5 w-5 text-violet-600" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium truncate">{appName}</h4>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {scopes.map(scope => (
              <Badge key={scope} variant="secondary" className="h-5 text-[10px]">
                {scope}
              </Badge>
            ))}
          </div>
          {homePermEntries.length > 0 && (
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {homePermEntries.map(([homeId, role]) => (
                <Badge key={homeId} variant="outline" className="h-5 text-[10px] gap-0.5">
                  <HomeIcon className="h-3 w-3" />
                  {homeNameMap.get(homeId) || homeId.slice(0, 8)}
                  <span className="text-muted-foreground">({role})</span>
                </Badge>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-1.5">
            Authorized {new Date(app.createdAt).toLocaleDateString()}
          </p>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1" />
      </div>
    );
  };

  const renderEditApp = () => {
    if (!editingApp) return null;
    const logoUrl = getAppLogo(editingApp);
    const appName = getAppName(editingApp);
    const scopes = editingApp.scope ? editingApp.scope.split(' ').filter(Boolean) : [];
    const enabledHomes = homePermissions.filter(hp => hp.enabled);

    return (
      <DialogContent className="max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <button
              onClick={() => setEditingApp(null)}
              className="p-1 -ml-1 rounded-md hover:bg-muted transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            Edit App Permissions
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-3 pb-3 border-b">
          <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 bg-muted overflow-hidden">
            {logoUrl ? (
              <img src={logoUrl} alt={appName} className="h-10 w-10 rounded-lg object-cover" />
            ) : (
              <Shield className="h-5 w-5 text-violet-600" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-medium truncate">{appName}</h4>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              {scopes.map(scope => (
                <Badge key={scope} variant="secondary" className="h-5 text-[10px]">
                  {scope}
                </Badge>
              ))}
              <span className="text-xs text-muted-foreground">
                · Authorized {new Date(editingApp.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6">
          {homes.length > 0 ? (
            <div className="space-y-2 py-2">
              <p className="text-sm font-medium text-muted-foreground">
                Home permissions:
              </p>
              <div className="rounded-lg border bg-card divide-y">
                {homePermissions.map((hp) => (
                  <div key={hp.homeId} className="p-3 space-y-2">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        id={`edit-home-${hp.homeId}`}
                        checked={hp.enabled}
                        onCheckedChange={() => toggleHomeEnabled(hp.homeId)}
                      />
                      <label
                        htmlFor={`edit-home-${hp.homeId}`}
                        className={`flex items-center gap-2 text-sm font-medium cursor-pointer flex-1 ${!hp.enabled ? 'text-muted-foreground' : ''}`}
                      >
                        <HomeIcon className={`h-4 w-4 flex-shrink-0 ${hp.enabled ? 'text-primary' : 'text-muted-foreground'}`} />
                        {hp.homeName}
                      </label>
                    </div>
                    {hp.enabled && (
                      <div className="flex items-center gap-2 ml-7">
                        <button
                          type="button"
                          onClick={() => setHomeRole(hp.homeId, 'view')}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors ${
                            hp.role === 'view'
                              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                              : 'bg-muted text-muted-foreground hover:bg-muted/80'
                          }`}
                        >
                          <Eye className="h-3 w-3" />
                          View only
                        </button>
                        <button
                          type="button"
                          onClick={() => setHomeRole(hp.homeId, 'control')}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors ${
                            hp.role === 'control'
                              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                              : 'bg-muted text-muted-foreground hover:bg-muted/80'
                          }`}
                        >
                          <Zap className="h-3 w-3" />
                          Full control
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {enabledHomes.length === 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  No homes selected. The app won't be able to access any devices.
                </p>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">
                No homes found. Connect your HomeKit device to manage home permissions.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-3 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => {
              setRevokeTarget(editingApp);
            }}
          >
            Revoke App
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditingApp(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSavePermissions} disabled={updating}>
              {updating && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    );
  };

  return (
    <>
      {/* Main dialog (hidden when editing app or viewing share dialog) */}
      <Dialog open={open && !selectedEntity && !editingApp} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="h-5 w-5" />
              Shared Items
            </DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="shared" className="flex-1 flex flex-col min-h-0" onValueChange={() => { tabSwitchedAt.current = Date.now(); }}>
            <TabsList className="w-full">
              <TabsTrigger value="shared" className="flex-1">Shared Items</TabsTrigger>
              <TabsTrigger value="apps" className="flex-1">Authorized Apps</TabsTrigger>
            </TabsList>

            <TabsContent value="shared" className="flex-1 min-h-0 flex flex-col">
              {loading && uniqueEntities.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : uniqueEntities.length === 0 ? (
                <div className="text-center py-12">
                  <Share2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                  <h3 className="font-medium text-lg mb-2">Nothing Shared</h3>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    You haven't shared any homes, rooms, collections, or accessories yet.
                    Use the share button on any item to create a shareable link.
                  </p>
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6">
                  <div className="space-y-2 pb-4">
                    {uniqueEntities.map(renderEntityCard)}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="apps" className="flex-1 min-h-0 flex flex-col">
              {appsLoading && authorizedApps.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : authorizedApps.length === 0 ? (
                <div className="text-center py-12">
                  <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                  <h3 className="font-medium text-lg mb-2">No Authorized Apps</h3>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    You haven't authorized any third-party applications to access your Homecast account.
                  </p>
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6">
                  <div className="space-y-2 pb-4">
                    {authorizedApps.map(renderAppCard)}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Edit app permissions dialog */}
      <Dialog open={!!editingApp} onOpenChange={(isOpen) => { if (!isOpen) setEditingApp(null); }}>
        {renderEditApp()}
      </Dialog>

      {/* Share Dialog for selected entity */}
      {selectedEntity && (
        <ShareDialog
          entityType={selectedEntity.entityType}
          entityId={selectedEntity.entityId}
          entityName={selectedEntity.entityName}
          open={!!selectedEntity}
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              handleShareDialogClose();
            }
          }}
          onUpdated={() => refetch()}
          onViewAllSharedItems={() => {
            setSelectedEntity(null);
          }}
        />
      )}

      {/* Revoke confirmation dialog */}
      <AlertDialog open={!!revokeTarget} onOpenChange={(isOpen) => { if (!isOpen) setRevokeTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke Access</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to revoke access for <span className="font-medium">{revokeTarget ? getAppName(revokeTarget) : ''}</span>? This app will no longer be able to access your Homecast account and all its tokens will be invalidated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={revoking}
              onClick={() => {
                if (revokeTarget) {
                  revokeApp({
                    variables: { clientId: revokeTarget.clientId },
                    onCompleted: () => {
                      // Also close the edit dialog if revoking from there
                      setEditingApp(null);
                    },
                  });
                }
              }}
            >
              {revoking ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
