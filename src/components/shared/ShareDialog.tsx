import { useState, useEffect } from 'react';
import { useMutation, useQuery } from '@apollo/client/react';
import { useAuth } from '@/contexts/AuthContext';
import { CREATE_ENTITY_ACCESS, UPDATE_ENTITY_ACCESS, DELETE_ENTITY_ACCESS, INVITE_HOME_MEMBER, UPDATE_HOME_MEMBER_ROLE, REMOVE_HOME_MEMBER } from '@/lib/graphql/mutations';
import { GET_ENTITY_ACCESS, GET_SHARING_INFO, GET_HOME_MEMBERS } from '@/lib/graphql/queries';
import { config, isCommunity } from '@/lib/config';
import type {
  EntityType,
  AccessRole,
  AccessSchedule,
  EntityAccessInfo,
  SharingInfo,
  GetEntityAccessResponse,
  GetSharingInfoResponse,
  CreateEntityAccessResponse,
  UpdateEntityAccessResponse,
  DeleteEntityAccessResponse,
  HomeMemberInfo,
  GetHomeMembersResponse,
  InviteHomeMemberResponse,
  UpdateHomeMemberRoleResponse,
  RemoveHomeMemberResponse,
  HomeRole,
} from '@/lib/graphql/types';
import { SchedulePicker, formatScheduleSummary } from '@/components/schedule';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Loader2,
  Copy,
  Check,
  Eye,
  Zap,
  Lock,
  Trash2,
  Plus,
  X,
  Users,
  Globe,
  Mail,
  ExternalLink,
  List,
  ChevronRight,
  AlertCircle,
  Shield,
  Clock,
  Bot,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { ShareQRCode } from './ShareQRCode';
import type { HomeKitAccessory } from '@/lib/graphql/types';
import { getPrimaryServiceType } from '@/components/widgets';

interface ShareDialogProps {
  entityType: EntityType;
  entityId: string;
  entityName: string;
  homeId?: string;  // Required for room/group/accessory
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated?: () => void;
  onViewAllSharedItems?: () => void;  // Callback to view all shared items
  // Optional counts for home/room (since these come from live HomeKit data)
  roomCount?: number;
  accessoryCount?: number;
  // Optional: characteristics available for this accessory/service group
  // Used to show only relevant HTTP control endpoints
  availableCharacteristics?: string[];
  // Optional: all resolved accessories for multi-accessory entity types (collection, collection_group)
  // Used to check if all devices share the same type for endpoint filtering
  allAccessories?: HomeKitAccessory[];
  // Home members (only for entityType === 'home')
  callerRole?: HomeRole;  // Current user's role for this home
  ownerEmail?: string;    // Home owner's email for display
  developerMode?: boolean;  // Show state/control endpoint info
}

type PublicAccessState = 'off' | 'view' | 'control';

export function ShareDialog({
  entityType,
  entityId,
  entityName,
  homeId,
  open,
  onOpenChange,
  onUpdated,
  onViewAllSharedItems,
  roomCount: propRoomCount,
  accessoryCount: propAccessoryCount,
  availableCharacteristics,
  allAccessories,
  callerRole,
  ownerEmail,
  developerMode,
}: ShareDialogProps) {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [addingPasscode, setAddingPasscode] = useState(false);
  const [newPasscode, setNewPasscode] = useState('');
  const [newPasscodeName, setNewPasscodeName] = useState('');
  const [newPasscodeRole, setNewPasscodeRole] = useState<AccessRole>('view');
  const [newPasscodeSchedule, setNewPasscodeSchedule] = useState<AccessSchedule | null>(null);
  const [endpointsOpen, setEndpointsOpen] = useState(false);
  const [endpointCopied, setEndpointCopied] = useState<string | null>(null);

  // Home members state (only used when entityType === 'home')
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState('control');

  // Fetch current access configuration
  const { data: accessData, refetch: refetchAccess } = useQuery<GetEntityAccessResponse>(
    GET_ENTITY_ACCESS,
    {
      variables: { entityType, entityId },
      skip: !open,
      fetchPolicy: 'cache-and-network',
    }
  );

  const { data: sharingData, refetch: refetchSharing } = useQuery<GetSharingInfoResponse>(
    GET_SHARING_INFO,
    {
      variables: { entityType, entityId },
      skip: !open,
      fetchPolicy: 'cache-and-network',
    }
  );

  const [createAccess, { loading: creating }] = useMutation<CreateEntityAccessResponse>(CREATE_ENTITY_ACCESS);
  const [updateAccess, { loading: updating }] = useMutation<UpdateEntityAccessResponse>(UPDATE_ENTITY_ACCESS);
  const [deleteAccess, { loading: deleting }] = useMutation<DeleteEntityAccessResponse>(DELETE_ENTITY_ACCESS);

  // Home members queries/mutations (only for homes)
  const isHome = entityType === 'home';
  const canManageSharing = !callerRole || callerRole === 'owner' || callerRole === 'admin';
  const canManageMembers = isHome && canManageSharing;
  const { data: membersData, refetch: refetchMembers } = useQuery<GetHomeMembersResponse>(
    GET_HOME_MEMBERS,
    { variables: { homeId: entityId }, skip: !open || !canManageMembers, fetchPolicy: 'network-only' }
  );
  const [inviteMember, { loading: inviting }] = useMutation<InviteHomeMemberResponse>(INVITE_HOME_MEMBER);
  const [updateMemberRole, { loading: updatingMember }] = useMutation<UpdateHomeMemberRoleResponse>(UPDATE_HOME_MEMBER_ROLE);
  const [removeMember, { loading: removingMember }] = useMutation<RemoveHomeMemberResponse>(REMOVE_HOME_MEMBER);
  const currentUserEmail = user?.email?.toLowerCase();
  const members = (membersData?.homeMembers ?? []).filter(m => m.email.toLowerCase() !== currentUserEmail);

  // Parse access records
  const accessList = accessData?.entityAccess || [];
  const publicAccess = accessList.find(a => a.accessType === 'public');
  const passcodeAccess = accessList.filter(a => a.accessType === 'passcode');
  const sharingInfo = sharingData?.sharingInfo;

  // Current public access state
  const publicState: PublicAccessState = publicAccess
    ? (publicAccess.role as PublicAccessState)
    : 'off';

  const shareUrl = sharingInfo?.shareUrl || '';

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setAddingPasscode(false);
      setNewPasscode('');
      setNewPasscodeName('');
      setNewPasscodeRole('view');
      setNewPasscodeSchedule(null);
      setEndpointsOpen(false);
      setEndpointCopied(null);
      setMemberEmail('');
      setMemberRole('control');
    }
  }, [open]);

  // Base API URL for share endpoints (control + state)
  const shareApiUrl = shareUrl ? `${config.apiUrl}${new URL(shareUrl, window.location.origin).pathname}` : '';

  // Generate available HTTP control endpoints based on entity type and characteristics
  const getControlEndpoints = () => {
    if (!shareUrl) return [];

    // All possible endpoints with their matching characteristic types
    // Note: characteristic types are normalized (lowercase, underscores to hyphens)
    const allEndpoints = [
      { action: 'on', label: 'Turn On', url: `${shareApiUrl}/on`, chars: ['on', 'power-state', 'active'] },
      { action: 'off', label: 'Turn Off', url: `${shareApiUrl}/off`, chars: ['on', 'power-state', 'active'] },
      { action: 'toggle', label: 'Toggle', url: `${shareApiUrl}/toggle`, chars: ['on', 'power-state', 'active'] },
      { action: 'brightness', label: 'Set Brightness', url: `${shareApiUrl}/brightness/{0-100}`, chars: ['brightness'] },
      { action: 'color', label: 'Set Color', url: `${shareApiUrl}/color/{hue}/{saturation}`, chars: ['hue', 'saturation'] },
      { action: 'temp', label: 'Color Temperature', url: `${shareApiUrl}/temp/{mirek}`, chars: ['color-temperature'] },
      { action: 'position', label: 'Set Position', url: `${shareApiUrl}/position/{0-100}`, chars: ['target-position', 'current-position'] },
      { action: 'lock', label: 'Lock', url: `${shareApiUrl}/lock`, chars: ['lock-target-state', 'lock-current-state'] },
      { action: 'unlock', label: 'Unlock', url: `${shareApiUrl}/unlock`, chars: ['lock-target-state', 'lock-current-state'] },
    ];

    // For multi-accessory types, check if we have accessory data for filtering
    const multiAccessoryTypes = ['collection', 'collection_group', 'room', 'room_group', 'home'];
    if (multiAccessoryTypes.includes(entityType)) {
      if (allAccessories && allAccessories.length > 0) {
        // Check if all accessories share the same primary service type
        const types = new Set(allAccessories.map(a => getPrimaryServiceType(a)).filter(Boolean));
        if (types.size > 1) {
          // Mixed types — return empty to signal mixed state
          return [];
        }
        // Uniform type — filter by the union of characteristics across all accessories
        const chars = allAccessories.flatMap(a =>
          a.services?.flatMap(s => s.characteristics?.map(c => c.characteristicType) || []) || []
        );
        const normalizedChars = chars.map(c => c.toLowerCase().replace(/_/g, '-'));
        return allEndpoints
          .filter(ep => ep.chars.some(c => normalizedChars.includes(c)))
          .map(({ action, label, url }) => ({ action, label, url }));
      }
      // No accessory data provided — show all endpoints (backward compat for home/room)
      return allEndpoints.map(({ action, label, url }) => ({ action, label, url }));
    }

    // For single accessory or accessory_group, filter by available characteristics
    if (availableCharacteristics && availableCharacteristics.length > 0) {
      const normalizedChars = availableCharacteristics.map(c => c.toLowerCase().replace(/_/g, '-'));
      return allEndpoints
        .filter(ep => ep.chars.some(c => normalizedChars.includes(c)))
        .map(({ action, label, url }) => ({ action, label, url }));
    }

    // If no characteristics provided for accessory types, show common ones
    return allEndpoints.map(({ action, label, url }) => ({ action, label, url }));
  };

  const handleCopyEndpoint = async (url: string, action: string) => {
    const w = window as any;
    if (w.webkit?.messageHandlers?.homecast) {
      w.webkit.messageHandlers.homecast.postMessage({ action: 'copy', text: url });
    } else {
      await navigator.clipboard.writeText(url);
    }
    setEndpointCopied(action);
    toast.success('Endpoint copied');
    setTimeout(() => setEndpointCopied(null), 2000);
  };

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    const w = window as any;
    // Use native bridge if running in Mac app
    if (w.webkit?.messageHandlers?.homecast) {
      w.webkit.messageHandlers.homecast.postMessage({ action: 'copy', text: shareUrl });
    } else {
      await navigator.clipboard.writeText(shareUrl);
    }
    setCopied(true);
    toast.success('Link copied');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenLink = () => {
    if (!shareUrl) return;
    const w = window as any;
    // Use native bridge if running in Mac app
    if (w.webkit?.messageHandlers?.homecast) {
      w.webkit.messageHandlers.homecast.postMessage({ action: 'openUrl', url: shareUrl });
    } else {
      window.open(shareUrl, '_blank');
    }
  };

  const handleRefetch = () => {
    refetchAccess();
    refetchSharing();
    onUpdated?.();
  };

  const handlePublicAccessChange = async (newState: PublicAccessState) => {
    if (newState === publicState) return;

    try {
      if (newState === 'off') {
        // Remove public access
        if (publicAccess) {
          const result = await deleteAccess({ variables: { accessId: publicAccess.id } });
          if (result.data?.deleteEntityAccess.success) {
            toast.success('Public access disabled');
            handleRefetch();
          } else {
            toast.error(result.data?.deleteEntityAccess.error || 'Failed to disable');
          }
        }
      } else if (publicAccess) {
        // Update existing public access
        const result = await updateAccess({
          variables: { accessId: publicAccess.id, role: newState },
        });
        if (result.data?.updateEntityAccess.success) {
          toast.success(`Public access set to ${newState}`);
          handleRefetch();
        } else {
          toast.error(result.data?.updateEntityAccess.error || 'Failed to update');
        }
      } else {
        // Create new public access
        const result = await createAccess({
          variables: {
            entityType,
            entityId,
            accessType: 'public',
            role: newState,
            homeId,
            entityName,
          },
        });
        if (result.data?.createEntityAccess.success) {
          toast.success(`Public access enabled (${newState})`);
          handleRefetch();
        } else {
          toast.error(result.data?.createEntityAccess.error || 'Failed to enable');
        }
      }
    } catch {
      toast.error('Failed to update public access');
    }
  };

  const handleAddPasscode = async () => {
    if (!newPasscode.trim()) {
      toast.error('Passcode is required');
      return;
    }

    try {
      const result = await createAccess({
        variables: {
          entityType,
          entityId,
          accessType: 'passcode',
          role: newPasscodeRole,
          homeId,
          passcode: newPasscode,
          name: newPasscodeName.trim() || undefined,
          entityName,
          accessSchedule: newPasscodeSchedule ? JSON.stringify(newPasscodeSchedule) : undefined,
        },
      });

      if (result.data?.createEntityAccess.success) {
        toast.success('Passcode added');
        setAddingPasscode(false);
        setNewPasscode('');
        setNewPasscodeName('');
        setNewPasscodeRole('view');
        setNewPasscodeSchedule(null);
        handleRefetch();
      } else {
        toast.error(result.data?.createEntityAccess.error || 'Failed to add passcode');
      }
    } catch {
      toast.error('Failed to add passcode');
    }
  };

  const handleDeletePasscode = async (accessId: string) => {
    try {
      const result = await deleteAccess({ variables: { accessId } });
      if (result.data?.deleteEntityAccess.success) {
        toast.success('Passcode removed');
        handleRefetch();
      } else {
        toast.error(result.data?.deleteEntityAccess.error || 'Failed to remove');
      }
    } catch {
      toast.error('Failed to remove passcode');
    }
  };

  // Home member handlers
  const handleInviteMember = async () => {
    if (!memberEmail.trim()) return;
    try {
      const { data: result } = await inviteMember({
        variables: { homeId: entityId, email: memberEmail.trim(), role: memberRole },
      });
      if (result?.inviteHomeMember.success) {
        toast.success(`Invited ${memberEmail.trim()}`);
        setMemberEmail('');
        refetchMembers();
      } else {
        toast.error(result?.inviteHomeMember.error || 'Failed to invite');
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to invite');
    }
  };

  const handleMemberRoleChange = async (email: string, newRole: string) => {
    try {
      const { data: result } = await updateMemberRole({
        variables: { homeId: entityId, email, role: newRole },
      });
      if (result?.updateHomeMemberRole.success) {
        toast.success(`Updated role for ${email}`);
        refetchMembers();
      } else {
        toast.error(result?.updateHomeMemberRole.error || 'Failed to update role');
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to update role');
    }
  };

  const handleRemoveMember = async (email: string) => {
    try {
      const { data: result } = await removeMember({
        variables: { homeId: entityId, email },
      });
      if (result?.removeHomeMember.success) {
        toast.success(`Removed ${email}`);
        refetchMembers();
      } else {
        toast.error(result?.removeHomeMember.error || 'Failed to remove');
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to remove');
    }
  };

  const canModifyMember = (member: HomeMemberInfo): boolean => {
    if (!canManageMembers) return false;
    return true;
  };

  const availableMemberRoles = canManageSharing ? ['admin', 'control', 'view'] : ['control', 'view'];

  const MEMBER_ROLE_LABELS: Record<string, string> = { admin: 'Admin', control: 'Control', view: 'View' };

  const isLoading = creating || updating || deleting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-hidden overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Share "{entityName}"</DialogTitle>
          <DialogDescription>
            {entityType === 'home' && (() => {
              const rooms = propRoomCount ?? sharingInfo?.roomCount;
              const accessories = propAccessoryCount ?? sharingInfo?.accessoryCount;
              return rooms != null && accessories != null
                ? `Includes ${rooms} room${rooms !== 1 ? 's' : ''} and ${accessories} accessor${accessories !== 1 ? 'ies' : 'y'} in this home.`
                : 'Includes all rooms and accessories in this home.';
            })()}
            {entityType === 'room' && (() => {
              const accessories = propAccessoryCount ?? sharingInfo?.accessoryCount;
              return accessories != null
                ? `Includes ${accessories} accessor${accessories !== 1 ? 'ies' : 'y'} in this room.`
                : 'Includes all accessories in this room.';
            })()}
            {entityType === 'collection' && (
              sharingInfo?.groupCount != null && sharingInfo?.accessoryCount != null
                ? `Includes ${sharingInfo.groupCount} group${sharingInfo.groupCount !== 1 ? 's' : ''} and ${sharingInfo.accessoryCount} accessor${sharingInfo.accessoryCount !== 1 ? 'ies' : 'y'} in this collection.`
                : 'Includes all groups and accessories in this collection.'
            )}
            {entityType === 'collection_group' && (
              sharingInfo?.accessoryCount != null
                ? `Includes ${sharingInfo.accessoryCount} accessor${sharingInfo.accessoryCount !== 1 ? 'ies' : 'y'} in this group.`
                : 'Includes all accessories in this group.'
            )}
            {entityType === 'room_group' && (
              sharingInfo?.roomCount != null
                ? `Includes ${sharingInfo.roomCount} room${sharingInfo.roomCount !== 1 ? 's' : ''} in this group.`
                : 'Includes all rooms in this group.'
            )}
            {entityType === 'accessory_group' && (
              sharingInfo?.accessoryCount != null
                ? `Includes ${sharingInfo.accessoryCount} accessor${sharingInfo.accessoryCount !== 1 ? 'ies' : 'y'} in this group.`
                : 'Includes all accessories in this group.'
            )}
            {entityType === 'accessory' && 'Share access to this individual accessory.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4 min-w-0">
          {/* Share Link */}
          {shareUrl && canManageSharing && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Share Link</Label>
              <div className="flex gap-2">
                <Input
                  value={shareUrl}
                  readOnly
                  className="font-mono text-xs selectable"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleCopyLink}
                  title="Copy link"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleOpenLink}
                  title="Open in browser"
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
                <ShareQRCode shareUrl={shareUrl} entityName={entityName} />
              </div>
            </div>
          )}

          {/* Read State Endpoint */}
          {developerMode && shareUrl && canManageSharing && publicState !== 'off' && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">State Endpoint</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs font-mono bg-muted px-2.5 py-1.5 rounded overflow-x-auto whitespace-nowrap scrollbar-thin selectable">
                  {shareApiUrl}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => handleCopyEndpoint(shareApiUrl, 'state')}
                  title="Copy state endpoint"
                >
                  {endpointCopied === 'state' ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Returns current state of all accessories as JSON. Works with any access level.
              </p>
            </div>
          )}

          {/* Share Control Endpoints */}
          {developerMode && shareUrl && canManageSharing && (() => {
            // Control endpoints don't apply to homes/rooms (mixed device types)
            if (entityType === 'home' || entityType === 'room') return null;

            const hasControlAccess = publicState === 'control' || passcodeAccess.some(p => p.role === 'control');
            const controlPasscodes = passcodeAccess.filter(p => p.role === 'control');
            const endpoints = getControlEndpoints();

            // Check if this is a mixed-type collection (allAccessories provided but types differ)
            const isMixedType = allAccessories && allAccessories.length > 0 &&
              new Set(allAccessories.map(a => getPrimaryServiceType(a)).filter(Boolean)).size > 1;

            // Don't show section if no endpoints available and not mixed type (e.g., sensor-only accessory)
            if (endpoints.length === 0 && !isMixedType) return null;

            return (
              <Collapsible open={endpointsOpen} onOpenChange={setEndpointsOpen}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full flex items-center justify-between text-sm font-medium hover:text-foreground transition-colors"
                  >
                    <span>Control Endpoints</span>
                    <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", endpointsOpen && "rotate-90")} />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2 pt-3 max-w-md">
                  {isMixedType ? (
                    <div className="flex items-start gap-2 px-2 py-2 bg-muted/50 rounded text-xs text-muted-foreground">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>
                        Control endpoints are available when all devices are the same type.
                        This {entityType === 'collection_group' ? 'group' : 'collection'} contains a mix of device types.
                      </span>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground px-2">
                        Control via simple URLs (GET or POST).
                        {publicState === 'control'
                          ? ' Anyone with the link can use these endpoints.'
                          : !hasControlAccess
                          ? ' Requires public control access or a passcode with control access.'
                          : ` Add ?passcode=xxx to authenticate${controlPasscodes.length === 1 ? ` (${controlPasscodes[0].name || 'passcode'})` : ''}.`
                        }
                      </p>
                      <div className="space-y-1.5 max-h-64 overflow-y-auto">
                        {endpoints.map((ep) => (
                          <div key={ep.action} className="flex items-center gap-2 px-2">
                            <code className="flex-1 text-xs font-mono bg-muted px-2 py-1.5 rounded overflow-x-auto whitespace-nowrap scrollbar-thin selectable">
                              {ep.url}
                            </code>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              onClick={() => handleCopyEndpoint(ep.url, ep.action)}
                              title={`Copy ${ep.label} endpoint`}
                            >
                              {endpointCopied === ep.action ? (
                                <Check className="h-3.5 w-3.5" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </div>
                        ))}
                      </div>
                      {publicState !== 'control' && controlPasscodes.length > 0 && (
                        <p className="text-xs text-muted-foreground px-2 pt-1 border-t">
                          Example: <code className="bg-muted px-1 rounded selectable">{`${shareApiUrl}/on?passcode=yourcode`}</code>
                        </p>
                      )}
                    </>
                  )}
                </CollapsibleContent>
              </Collapsible>
            );
          })()}

          {/* Public Access Section */}
          {canManageSharing ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium">Public Access</Label>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handlePublicAccessChange('off')}
                disabled={isLoading}
                className={`flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all ${
                  publicState === 'off'
                    ? 'border-primary bg-primary/10'
                    : 'border-muted hover:border-muted-foreground/50'
                } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <X className={`h-5 w-5 ${publicState === 'off' ? 'text-primary' : 'text-muted-foreground'}`} />
                <span className={`text-sm font-medium ${publicState === 'off' ? 'text-primary' : ''}`}>Off</span>
                <span className="text-xs text-muted-foreground text-center">No public access</span>
              </button>
              <button
                type="button"
                onClick={() => handlePublicAccessChange('view')}
                disabled={isLoading}
                className={`flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all ${
                  publicState === 'view'
                    ? 'border-primary bg-primary/10'
                    : 'border-muted hover:border-muted-foreground/50'
                } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <Eye className={`h-5 w-5 ${publicState === 'view' ? 'text-primary' : 'text-muted-foreground'}`} />
                <span className={`text-sm font-medium ${publicState === 'view' ? 'text-primary' : ''}`}>View Only</span>
                <span className="text-xs text-muted-foreground text-center">Can see accessories</span>
              </button>
              <button
                type="button"
                onClick={() => handlePublicAccessChange('control')}
                disabled={isLoading}
                className={`flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all ${
                  publicState === 'control'
                    ? 'border-primary bg-primary/10'
                    : 'border-muted hover:border-muted-foreground/50'
                } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <Zap className={`h-5 w-5 ${publicState === 'control' ? 'text-primary' : 'text-muted-foreground'}`} />
                <span className={`text-sm font-medium ${publicState === 'control' ? 'text-primary' : ''}`}>Control</span>
                <span className="text-xs text-muted-foreground text-center">Can control accessories</span>
              </button>
            </div>
          </div>
          ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium">Sharing</Label>
            </div>
            <p className="text-xs text-muted-foreground">Only home owners and admins can manage sharing settings.</p>
          </div>
          )}

          {/* Divider */}
          {canManageSharing && <div className="border-t" />}

          {/* Passcodes Section */}
          {canManageSharing && (
          <div className={`space-y-3 ${publicState === 'control' ? 'opacity-50' : ''}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm font-medium">Passcodes</Label>
              </div>
              {!addingPasscode && publicState !== 'control' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAddingPasscode(true)}
                  className="h-7 px-2 text-xs"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Passcode
                </Button>
              )}
            </div>

            {publicState === 'control' ? (
              <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded-md">
                Passcodes are not needed when public control access is enabled. Anyone with the link can already control this {entityType}.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Add passcodes for elevated or restricted access
              </p>
            )}

            {/* Existing passcodes */}
            {passcodeAccess.length > 0 && (
              <div className="space-y-2">
                {passcodeAccess.map((access) => {
                  const schedule = access.accessSchedule
                    ? JSON.parse(access.accessSchedule) as AccessSchedule
                    : null;
                  const scheduleSummary = formatScheduleSummary(schedule);
                  return (
                    <div
                      key={access.id}
                      className="flex items-center justify-between p-2 rounded-lg border bg-muted/30"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="text-sm font-medium truncate">
                            {access.name || 'Passcode'}
                          </span>
                          <span className="text-xs text-muted-foreground capitalize shrink-0">
                            {access.role}
                          </span>
                        </div>
                        {schedule && (
                          <p className="text-xs text-muted-foreground mt-0.5 ml-6 truncate">
                            {scheduleSummary}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => handleDeletePasscode(access.id)}
                        disabled={isLoading}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add passcode dialog */}
            <Dialog open={addingPasscode} onOpenChange={setAddingPasscode}>
              <DialogContent className="sm:max-w-[450px] max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Add Passcode</DialogTitle>
                  <DialogDescription>
                    Create a passcode for access to this {entityType}.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="passcode-name">Name (optional)</Label>
                    <Input
                      id="passcode-name"
                      placeholder="e.g., Guest access"
                      value={newPasscodeName}
                      onChange={(e) => setNewPasscodeName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="passcode">Passcode</Label>
                    <Input
                      id="passcode"
                      type="text"
                      placeholder="Enter passcode"
                      value={newPasscode}
                      onChange={(e) => setNewPasscode(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Access Level</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setNewPasscodeRole('view')}
                        className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all ${
                          newPasscodeRole === 'view'
                            ? 'border-primary bg-primary/10'
                            : 'border-muted hover:border-muted-foreground/50'
                        }`}
                      >
                        <Eye className={`h-5 w-5 ${newPasscodeRole === 'view' ? 'text-primary' : 'text-muted-foreground'}`} />
                        <span className={`text-sm font-medium ${newPasscodeRole === 'view' ? 'text-primary' : ''}`}>View Only</span>
                        <span className="text-xs text-muted-foreground text-center">Can see accessories</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewPasscodeRole('control')}
                        className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all ${
                          newPasscodeRole === 'control'
                            ? 'border-primary bg-primary/10'
                            : 'border-muted hover:border-muted-foreground/50'
                        }`}
                      >
                        <Zap className={`h-5 w-5 ${newPasscodeRole === 'control' ? 'text-primary' : 'text-muted-foreground'}`} />
                        <span className={`text-sm font-medium ${newPasscodeRole === 'control' ? 'text-primary' : ''}`}>Control</span>
                        <span className="text-xs text-muted-foreground text-center">Can control accessories</span>
                      </button>
                    </div>
                  </div>

                  {/* Schedule Picker */}
                  <div className="pt-2 border-t">
                    <SchedulePicker
                      schedule={newPasscodeSchedule}
                      onChange={setNewPasscodeSchedule}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setAddingPasscode(false);
                      setNewPasscode('');
                      setNewPasscodeName('');
                      setNewPasscodeSchedule(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAddPasscode}
                    disabled={!newPasscode.trim() || isLoading}
                  >
                    {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Add Passcode
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {passcodeAccess.length === 0 && publicState !== 'control' && (
              <p className="text-xs text-muted-foreground italic">
                No passcodes configured
              </p>
            )}
          </div>
          )}

          {/* Members Section (homes only, not in Community mode — roles are global) */}
          {isHome && canManageMembers && !isCommunity && (
            <>
              <div className="border-t" />
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-sm font-medium">Members</Label>
                </div>

                {/* Owner row */}
                {ownerEmail && (
                  <div className="flex items-center justify-between py-1.5 px-2 rounded-md bg-muted/50">
                    <span className="text-sm truncate">{ownerEmail}</span>
                    <span className="text-xs font-medium text-muted-foreground">
                      Owner
                    </span>
                  </div>
                )}

                {/* Members list */}
                {members.length > 0 && (
                  <div className="space-y-1">
                    {members.map((member) => (
                      <div key={member.id} className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate">{member.name || member.email}</div>
                          {member.name && <div className="text-xs text-muted-foreground truncate">{member.email}</div>}
                          {member.isPending && (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                              <Clock className="h-3 w-3" /> Pending
                            </span>
                          )}
                        </div>
                        {canModifyMember(member) ? (
                          <div className="flex items-center gap-1">
                            <Select
                              value={member.role}
                              onValueChange={(val) => handleMemberRoleChange(member.email, val)}
                              disabled={updatingMember}
                            >
                              <SelectTrigger className="h-7 w-[90px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {availableMemberRoles.map((r) => (
                                  <SelectItem key={r} value={r} className="text-xs">
                                    {MEMBER_ROLE_LABELS[r] || r}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => handleRemoveMember(member.email)}
                              disabled={removingMember}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground capitalize">{member.role}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Invite form */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Invite by email</Label>
                  <div className="flex gap-2">
                    <Input
                      type="email"
                      placeholder="email@example.com"
                      value={memberEmail}
                      onChange={(e) => setMemberEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleInviteMember()}
                      className="h-9 text-sm flex-1"
                    />
                    <Select value={memberRole} onValueChange={setMemberRole}>
                      <SelectTrigger className="h-9 w-[90px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {availableMemberRoles.map((r) => (
                          <SelectItem key={r} value={r} className="text-xs">
                            {MEMBER_ROLE_LABELS[r] || r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      className="h-9"
                      onClick={handleInviteMember}
                      disabled={inviting || !memberEmail.trim()}
                    >
                      {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Invite'}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Members get full dashboard access. Pending invites activate on signup.
                  </p>
                </div>
              </div>
            </>
          )}

          {/* AI Assistants Section (homes only) */}
          {isHome && (
            <>
              <div className="border-t" />
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-sm font-medium">AI Assistants</Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Connect Claude, ChatGPT, Gemini, or other AI assistants to control your home.
                </p>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs font-mono bg-muted px-2.5 py-1.5 rounded truncate selectable">
                      {config.apiUrl}/mcp
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={async () => {
                        const url = `${config.apiUrl}/mcp`;
                        const w = window as any;
                        if (w.webkit?.messageHandlers?.homecast) {
                          w.webkit.messageHandlers.homecast.postMessage({ action: 'copy', text: url });
                        } else {
                          await navigator.clipboard.writeText(url);
                        }
                        toast.success('MCP endpoint copied');
                      }}
                      title="Copy MCP endpoint"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Divider */}
          <div className="border-t" />

          {/* View All Shared Items */}
          {onViewAllSharedItems && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                onOpenChange(false);
                onViewAllSharedItems();
              }}
            >
              <List className="h-4 w-4 mr-2" />
              View All Shared Items
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
