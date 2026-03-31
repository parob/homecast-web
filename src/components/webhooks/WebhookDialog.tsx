import React, { useState, useEffect } from 'react';
import { useMutation, useQuery } from '@apollo/client/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, Loader2, Check, X, AlertTriangle, Home, DoorClosed, Lightbulb } from 'lucide-react';
import { WebhookSecretDisplay } from './WebhookSecretDisplay';
import { GET_HOMES, GET_ROOMS, GET_ACCESSORIES } from '@/lib/graphql/queries';
import { CREATE_WEBHOOK, UPDATE_WEBHOOK, TEST_WEBHOOK } from '@/lib/graphql/mutations';
import type {
  WebhookInfo,
  CreateWebhookResponse,
  UpdateWebhookResponse,
  TestWebhookResponse,
  HomeKitHome,
  HomeKitRoom,
  HomeKitAccessory,
} from '@/lib/graphql/types';

interface WebhookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  webhook?: WebhookInfo | null;
  onSaved?: (webhook: WebhookInfo, rawSecret?: string | null) => void;
}

export function WebhookDialog({
  open,
  onOpenChange,
  webhook,
  onSaved,
}: WebhookDialogProps) {
  const isEditing = !!webhook;

  // Form state
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [maxRetries, setMaxRetries] = useState(3);
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState(60);
  const [timeoutMs, setTimeoutMs] = useState(30000);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);

  // Scope filters
  const [selectedHomeIds, setSelectedHomeIds] = useState<Set<string>>(new Set());
  const [selectedRoomIds, setSelectedRoomIds] = useState<Set<string>>(new Set());
  const [selectedAccessoryIds, setSelectedAccessoryIds] = useState<Set<string>>(new Set());

  // New secret after creation
  const [newRawSecret, setNewRawSecret] = useState<string | null>(null);

  // Test result
  const [testResult, setTestResult] = useState<{
    success: boolean;
    statusCode?: number | null;
    responseTimeMs?: number | null;
    error?: string | null;
  } | null>(null);

  // Validation
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Queries
  const { data: homesData, loading: homesLoading } = useQuery<{ homes: HomeKitHome[] }>(
    GET_HOMES,
    { skip: !open, fetchPolicy: 'cache-first' }
  );
  const homes = homesData?.homes || [];

  // Get the first selected home for fetching rooms/accessories
  const selectedHomeId = selectedHomeIds.size > 0 ? Array.from(selectedHomeIds)[0] : null;

  const { data: roomsData, loading: roomsLoading } = useQuery<{ rooms: HomeKitRoom[] }>(
    GET_ROOMS,
    {
      variables: { homeId: selectedHomeId },
      skip: !open || !selectedHomeId,
      fetchPolicy: 'cache-first',
    }
  );
  const rooms = roomsData?.rooms || [];

  const { data: accessoriesData, loading: accessoriesLoading } = useQuery<{ accessories: HomeKitAccessory[] }>(
    GET_ACCESSORIES,
    {
      variables: { homeId: selectedHomeId },
      skip: !open || !selectedHomeId,
      fetchPolicy: 'cache-first',
    }
  );
  const accessories = accessoriesData?.accessories || [];

  // Filter accessories by selected rooms if any rooms are selected
  const filteredAccessories = selectedRoomIds.size > 0
    ? accessories.filter(a => a.roomId && selectedRoomIds.has(a.roomId))
    : accessories;

  // Mutations
  const [createWebhook, { loading: creating }] = useMutation<CreateWebhookResponse>(CREATE_WEBHOOK);
  const [updateWebhook, { loading: updating }] = useMutation<UpdateWebhookResponse>(UPDATE_WEBHOOK);
  const [testWebhook, { loading: testing }] = useMutation<TestWebhookResponse>(TEST_WEBHOOK);

  const loading = creating || updating;

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      if (webhook) {
        setName(webhook.name);
        setUrl(webhook.url);
        setMaxRetries(webhook.maxRetries);
        setRateLimitPerMinute(webhook.rateLimitPerMinute || 60);
        setTimeoutMs(webhook.timeoutMs);
        setSelectedHomeIds(new Set(webhook.homeIds || []));
        setSelectedRoomIds(new Set(webhook.roomIds || []));
        setSelectedAccessoryIds(new Set(webhook.accessoryIds || []));
        // Open scope section if any filters are set
        if ((webhook.homeIds?.length || 0) > 0 || (webhook.roomIds?.length || 0) > 0 || (webhook.accessoryIds?.length || 0) > 0) {
          setScopeOpen(true);
        }
      } else {
        setName('');
        setUrl('');
        setMaxRetries(3);
        setRateLimitPerMinute(60);
        setTimeoutMs(30000);
        setSelectedHomeIds(new Set());
        setSelectedRoomIds(new Set());
        setSelectedAccessoryIds(new Set());
      }
      setNewRawSecret(null);
      setTestResult(null);
      setErrors({});
      setAdvancedOpen(false);
    }
  }, [open, webhook]);

  // Clear room/accessory selections when home changes
  useEffect(() => {
    if (selectedHomeIds.size === 0) {
      setSelectedRoomIds(new Set());
      setSelectedAccessoryIds(new Set());
    }
  }, [selectedHomeIds.size]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = 'Name is required';
    } else if (name.length > 100) {
      newErrors.name = 'Name must be 100 characters or less';
    }

    if (!url.trim()) {
      newErrors.url = 'URL is required';
    } else if (!url.startsWith('https://')) {
      newErrors.url = 'URL must use HTTPS';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;

    const homeIds = Array.from(selectedHomeIds);
    const roomIds = Array.from(selectedRoomIds);
    const accessoryIds = Array.from(selectedAccessoryIds);

    try {
      if (isEditing && webhook) {
        const result = await updateWebhook({
          variables: {
            webhookId: webhook.id,
            name: name.trim(),
            url: url.trim(),
            eventTypes: ['state.changed'],
            homeIds: homeIds.length > 0 ? homeIds : null,
            roomIds: roomIds.length > 0 ? roomIds : null,
            accessoryIds: accessoryIds.length > 0 ? accessoryIds : null,
            maxRetries,
            rateLimitPerMinute,
            timeoutMs,
          },
        });

        if (result.data?.updateWebhook.success && result.data.updateWebhook.webhook) {
          onSaved?.(result.data.updateWebhook.webhook);
          onOpenChange(false);
        } else {
          setErrors({ submit: result.data?.updateWebhook.error || 'Failed to update webhook' });
        }
      } else {
        const result = await createWebhook({
          variables: {
            name: name.trim(),
            url: url.trim(),
            eventTypes: ['state.changed'],
            homeIds: homeIds.length > 0 ? homeIds : null,
            roomIds: roomIds.length > 0 ? roomIds : null,
            accessoryIds: accessoryIds.length > 0 ? accessoryIds : null,
            maxRetries,
            rateLimitPerMinute,
            timeoutMs,
          },
        });

        if (result.data?.createWebhook.success && result.data.createWebhook.webhook) {
          setNewRawSecret(result.data.createWebhook.rawSecret || null);
          onSaved?.(result.data.createWebhook.webhook, result.data.createWebhook.rawSecret);
        } else {
          setErrors({ submit: result.data?.createWebhook.error || 'Failed to create webhook' });
        }
      }
    } catch (error) {
      setErrors({ submit: 'An error occurred' });
    }
  };

  const handleTest = async () => {
    if (!webhook) return;

    setTestResult(null);
    try {
      const result = await testWebhook({
        variables: { webhookId: webhook.id },
      });

      if (result.data?.testWebhook) {
        setTestResult(result.data.testWebhook);
      }
    } catch {
      setTestResult({ success: false, error: 'Failed to send test' });
    }
  };

  const toggleHome = (homeId: string) => {
    setSelectedHomeIds(prev => {
      const next = new Set(prev);
      if (next.has(homeId)) {
        next.delete(homeId);
      } else {
        // Only allow one home at a time for simplicity
        next.clear();
        next.add(homeId);
      }
      return next;
    });
    // Clear room/accessory selections when home changes
    setSelectedRoomIds(new Set());
    setSelectedAccessoryIds(new Set());
  };

  const toggleRoom = (roomId: string) => {
    setSelectedRoomIds(prev => {
      const next = new Set(prev);
      if (next.has(roomId)) {
        next.delete(roomId);
      } else {
        next.add(roomId);
      }
      return next;
    });
    // Clear accessory selections when rooms change
    setSelectedAccessoryIds(new Set());
  };

  const toggleAccessory = (accessoryId: string) => {
    setSelectedAccessoryIds(prev => {
      const next = new Set(prev);
      if (next.has(accessoryId)) {
        next.delete(accessoryId);
      } else {
        next.add(accessoryId);
      }
      return next;
    });
  };

  // Scope description
  const getScopeDescription = () => {
    if (selectedAccessoryIds.size > 0) {
      return `${selectedAccessoryIds.size} accessory${selectedAccessoryIds.size > 1 ? 'ies' : ''}`;
    }
    if (selectedRoomIds.size > 0) {
      return `${selectedRoomIds.size} room${selectedRoomIds.size > 1 ? 's' : ''}`;
    }
    if (selectedHomeIds.size > 0) {
      const home = homes.find(h => selectedHomeIds.has(h.id));
      return home?.name || '1 home';
    }
    return 'All devices';
  };

  // If we just created and have a raw secret, show success view
  if (newRawSecret) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Check className="h-5 w-5 text-green-500" />
              Webhook Created
            </DialogTitle>
            <DialogDescription>
              Your webhook has been created. Save the signing secret below.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <Label>Signing Secret</Label>
              <div className="mt-2">
                <WebhookSecretDisplay
                  secret={newRawSecret!}
                  secretPrefix=""
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="shrink-0 px-6 pt-6">
          <DialogTitle>{isEditing ? 'Edit Webhook' : 'Create Webhook'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update your webhook configuration.'
              : 'Receive notifications when device states change.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Basic Information */}
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="My Webhook"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErrors((prev) => ({ ...prev, name: '' }));
              }}
              className={errors.name ? 'border-red-500' : ''}
            />
            {errors.name && (
              <p className="text-xs text-red-500">{errors.name}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="url">Endpoint URL</Label>
            <Input
              id="url"
              placeholder="https://example.com/webhook"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setErrors((prev) => ({ ...prev, url: '' }));
              }}
              className={errors.url ? 'border-red-500' : ''}
            />
            {errors.url ? (
              <p className="text-xs text-red-500">{errors.url}</p>
            ) : (
              <p className="text-xs text-muted-foreground">HTTPS required</p>
            )}
          </div>

          {/* Scope Filters */}
          <Collapsible open={scopeOpen} onOpenChange={setScopeOpen}>
            <CollapsibleTrigger className="flex items-center justify-between w-full text-sm font-medium hover:text-primary">
              <div className="flex items-center gap-2">
                {scopeOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                Scope
              </div>
              <span className="text-xs text-muted-foreground font-normal">
                {getScopeDescription()}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Limit this webhook to specific homes, rooms, or accessories. Leave empty to receive events from all devices.
              </p>

              {/* Home Selection */}
              <div className="space-y-2">
                <Label className="text-xs flex items-center gap-1.5">
                  <Home className="h-3.5 w-3.5" />
                  Home
                </Label>
                {homesLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </div>
                ) : homes.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No homes available</p>
                ) : (
                  <div className="space-y-1">
                    {homes.map(home => (
                      <div key={home.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`home-${home.id}`}
                          checked={selectedHomeIds.has(home.id)}
                          onCheckedChange={() => toggleHome(home.id)}
                        />
                        <label htmlFor={`home-${home.id}`} className="text-sm cursor-pointer">
                          {home.name}
                        </label>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Room Selection (only show if home selected) */}
              {selectedHomeIds.size > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs flex items-center gap-1.5">
                    <DoorClosed className="h-3.5 w-3.5" />
                    Rooms (optional)
                  </Label>
                  {roomsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading...
                    </div>
                  ) : rooms.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No rooms in this home</p>
                  ) : (
                    <ScrollArea className="h-[100px] rounded-md border p-2">
                      <div className="space-y-1">
                        {rooms.map(room => (
                          <div key={room.id} className="flex items-center gap-2">
                            <Checkbox
                              id={`room-${room.id}`}
                              checked={selectedRoomIds.has(room.id)}
                              onCheckedChange={() => toggleRoom(room.id)}
                            />
                            <label htmlFor={`room-${room.id}`} className="text-sm cursor-pointer">
                              {room.name}
                            </label>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              )}

              {/* Accessory Selection (only show if home selected) */}
              {selectedHomeIds.size > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs flex items-center gap-1.5">
                    <Lightbulb className="h-3.5 w-3.5" />
                    Accessories (optional)
                  </Label>
                  {accessoriesLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading...
                    </div>
                  ) : filteredAccessories.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {selectedRoomIds.size > 0 ? 'No accessories in selected rooms' : 'No accessories in this home'}
                    </p>
                  ) : (
                    <ScrollArea className="h-[120px] rounded-md border p-2">
                      <div className="space-y-1">
                        {filteredAccessories.map(accessory => (
                          <div key={accessory.id} className="flex items-center gap-2">
                            <Checkbox
                              id={`accessory-${accessory.id}`}
                              checked={selectedAccessoryIds.has(accessory.id)}
                              onCheckedChange={() => toggleAccessory(accessory.id)}
                            />
                            <label htmlFor={`accessory-${accessory.id}`} className="text-sm cursor-pointer truncate">
                              {accessory.name}
                              {accessory.roomName && (
                                <span className="text-xs text-muted-foreground ml-1">
                                  ({accessory.roomName})
                                </span>
                              )}
                            </label>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>

          {/* Advanced Settings */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium hover:text-primary">
              {advancedOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              Advanced Settings
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4 space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Max Retries</Label>
                  <span className="text-sm text-muted-foreground">{maxRetries}</span>
                </div>
                <Slider
                  value={[maxRetries]}
                  onValueChange={([value]) => setMaxRetries(value)}
                  min={0}
                  max={10}
                  step={1}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Rate Limit (per minute)</Label>
                  <span className="text-sm text-muted-foreground">{rateLimitPerMinute}</span>
                </div>
                <Slider
                  value={[rateLimitPerMinute]}
                  onValueChange={([value]) => setRateLimitPerMinute(value)}
                  min={1}
                  max={1000}
                  step={10}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="timeout">Timeout (ms)</Label>
                <Input
                  id="timeout"
                  type="number"
                  value={timeoutMs}
                  onChange={(e) => setTimeoutMs(parseInt(e.target.value) || 30000)}
                  min={1000}
                  max={120000}
                />
                <p className="text-xs text-muted-foreground">
                  1000 - 120000 ms (default: 30000)
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Test Webhook (only when editing) */}
          {isEditing && (
            <div className="space-y-3 pt-2">
              <Button
                variant="outline"
                onClick={handleTest}
                disabled={testing}
                className="w-full"
              >
                {testing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  'Send Test Event'
                )}
              </Button>

              {testResult && (
                <div
                  className={`rounded-lg border p-3 ${
                    testResult.success
                      ? 'border-green-500/50 bg-green-50 dark:bg-green-950/30'
                      : 'border-red-500/50 bg-red-50 dark:bg-red-950/30'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {testResult.success ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <X className="h-4 w-4 text-red-500" />
                    )}
                    <span className="text-sm font-medium">
                      {testResult.success ? 'Success' : 'Failed'}
                    </span>
                    {testResult.statusCode && (
                      <span className="text-sm text-muted-foreground">
                        Status: {testResult.statusCode}
                      </span>
                    )}
                    {testResult.responseTimeMs && (
                      <span className="text-sm text-muted-foreground">
                        {testResult.responseTimeMs}ms
                      </span>
                    )}
                  </div>
                  {testResult.error && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                      {testResult.error}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Submit Error */}
          {errors.submit && (
            <div className="flex items-center gap-2 text-sm text-red-500">
              <AlertTriangle className="h-4 w-4" />
              {errors.submit}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 px-6 pb-6 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEditing ? 'Save Changes' : 'Create Webhook'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
