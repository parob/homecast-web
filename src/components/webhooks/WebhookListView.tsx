import React, { useState } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  Plus,
  MoreVertical,
  Pause,
  Play,
  Pencil,
  Trash2,
  Loader2,
  Link2,
  RefreshCw,
  ChevronLeft,
  Check,
  X,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { WebhookDialog } from './WebhookDialog';
import { WebhookSecretDisplay } from './WebhookSecretDisplay';
import { WebhookDeliveryRow } from './WebhookDeliveryRow';
import {
  GET_WEBHOOKS,
  GET_WEBHOOK,
  GET_WEBHOOK_DELIVERY_HISTORY,
} from '@/lib/graphql/queries';
import {
  DELETE_WEBHOOK,
  PAUSE_WEBHOOK,
  RESUME_WEBHOOK,
  ROTATE_WEBHOOK_SECRET,
} from '@/lib/graphql/mutations';
import type {
  WebhookInfo,
  GetWebhooksResponse,
  GetWebhookResponse,
  GetWebhookDeliveryHistoryResponse,
  DeleteWebhookResponse,
  PauseWebhookResponse,
  ResumeWebhookResponse,
  RotateWebhookSecretResponse,
} from '@/lib/graphql/types';

interface WebhookListViewProps {
  onClose?: () => void;
}

export function WebhookListView({ onClose }: WebhookListViewProps) {
  const [selectedWebhookId, setSelectedWebhookId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState<WebhookInfo | null>(null);
  const [deleteWebhookId, setDeleteWebhookId] = useState<string | null>(null);
  const [newRawSecret, setNewRawSecret] = useState<string | null>(null); // Transient secret from create/rotate (before refetch)

  // Queries
  const { data: webhooksData, loading: webhooksLoading, refetch: refetchWebhooks } = useQuery<GetWebhooksResponse>(
    GET_WEBHOOKS,
    { fetchPolicy: 'cache-and-network' }
  );

  const { data: webhookDetailData, loading: detailLoading } = useQuery<GetWebhookResponse>(
    GET_WEBHOOK,
    {
      variables: { webhookId: selectedWebhookId },
      skip: !selectedWebhookId,
      fetchPolicy: 'cache-and-network',
    }
  );

  const { data: deliveriesData, loading: deliveriesLoading, refetch: refetchDeliveries } = useQuery<GetWebhookDeliveryHistoryResponse>(
    GET_WEBHOOK_DELIVERY_HISTORY,
    {
      variables: { webhookId: selectedWebhookId, limit: 50 },
      skip: !selectedWebhookId,
      fetchPolicy: 'cache-and-network',
    }
  );

  // Mutations
  const [deleteWebhook, { loading: deleting }] = useMutation<DeleteWebhookResponse>(DELETE_WEBHOOK);
  const [pauseWebhook, { loading: pausing }] = useMutation<PauseWebhookResponse>(PAUSE_WEBHOOK);
  const [resumeWebhook, { loading: resuming }] = useMutation<ResumeWebhookResponse>(RESUME_WEBHOOK);
  const [rotateSecret, { loading: rotating }] = useMutation<RotateWebhookSecretResponse>(ROTATE_WEBHOOK_SECRET);

  const webhooks = webhooksData?.webhooks || [];
  const selectedWebhook = webhookDetailData?.webhook;
  const deliveries = deliveriesData?.webhookDeliveryHistory?.deliveries || [];

  const formatRelativeTime = (isoString: string | null) => {
    if (!isoString) return 'Never';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.round(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.round(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.round(diffHours / 24);
    return `${diffDays}d ago`;
  };

  const getSuccessRate = (webhook: WebhookInfo) => {
    // Estimate from consecutive failures
    // This is a simplification - in production you'd track this properly
    const maxFailures = 10;
    const failures = webhook.consecutiveFailures || 0;
    return Math.max(0, 100 - (failures / maxFailures) * 100);
  };

  const getStatusColor = (webhook: WebhookInfo) => {
    if (webhook.status === 'disabled') return 'bg-red-500';
    if (webhook.status === 'paused') return 'bg-yellow-500';
    if (webhook.status === 'active' && webhook.consecutiveFailures >= 5) return 'bg-amber-500';
    if (webhook.status === 'active') return 'bg-green-500';
    return 'bg-gray-500';
  };

  const getStatusLabel = (webhook: WebhookInfo) => {
    if (webhook.status === 'disabled') return 'Disabled';
    if (webhook.status === 'paused') return 'Paused';
    if (webhook.status === 'active' && webhook.consecutiveFailures >= 5) return 'Deliveries paused';
    if (webhook.status === 'active') return 'Active';
    return webhook.status;
  };

  const handleDelete = async () => {
    if (!deleteWebhookId) return;

    try {
      await deleteWebhook({ variables: { webhookId: deleteWebhookId } });
      setDeleteWebhookId(null);
      if (selectedWebhookId === deleteWebhookId) {
        setSelectedWebhookId(null);
      }
      refetchWebhooks();
    } catch (error) {
      console.error('Failed to delete webhook:', error);
    }
  };

  const handleTogglePause = async (webhook: WebhookInfo) => {
    try {
      if (webhook.status === 'active') {
        await pauseWebhook({ variables: { webhookId: webhook.id } });
      } else {
        await resumeWebhook({ variables: { webhookId: webhook.id } });
      }
      refetchWebhooks();
    } catch (error) {
      console.error('Failed to toggle webhook status:', error);
    }
  };

  const handleRotateSecret = async () => {
    if (!selectedWebhookId) return;

    try {
      const result = await rotateSecret({ variables: { webhookId: selectedWebhookId } });
      if (result.data?.rotateWebhookSecret.rawSecret) {
        setNewRawSecret(result.data.rotateWebhookSecret.rawSecret);
      }
    } catch (error) {
      console.error('Failed to rotate secret:', error);
    }
  };

  const handleWebhookSaved = (webhook: WebhookInfo, rawSecret?: string | null) => {
    if (rawSecret) {
      setNewRawSecret(rawSecret);
    }
    refetchWebhooks();
    setDialogOpen(false);
    setEditingWebhook(null);
  };

  // Detail view
  if (selectedWebhookId && selectedWebhook) {
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => {
              setSelectedWebhookId(null);
              setNewRawSecret(null);
            }}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h3 className="font-semibold">{selectedWebhook.name}</h3>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className={`h-2 w-2 rounded-full ${getStatusColor(selectedWebhook)}`} />
              <span>{getStatusLabel(selectedWebhook)}</span>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditingWebhook(selectedWebhook)}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleTogglePause(selectedWebhook)}>
                {selectedWebhook.status === 'active' ? (
                  <>
                    <Pause className="h-4 w-4 mr-2" />
                    Pause
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Resume
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteWebhookId(selectedWebhook.id)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Endpoint health warning */}
        {selectedWebhook.consecutiveFailures >= 5 && selectedWebhook.status === 'active' && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/50 bg-amber-50 dark:bg-amber-950/30 p-3">
            <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-amber-700 dark:text-amber-300">Deliveries paused</p>
              <p className="text-amber-600 dark:text-amber-400 mt-0.5">
                Your endpoint has failed {selectedWebhook.consecutiveFailures} times in a row. New deliveries are being skipped until the endpoint recovers. The server will automatically retry shortly.
              </p>
            </div>
          </div>
        )}
        {selectedWebhook.consecutiveFailures > 0 && selectedWebhook.consecutiveFailures < 5 && selectedWebhook.status === 'active' && (
          <div className="flex items-start gap-3 rounded-lg border border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950/30 p-3">
            <AlertCircle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-yellow-700 dark:text-yellow-300">Endpoint failing</p>
              <p className="text-yellow-600 dark:text-yellow-400 mt-0.5">
                Your endpoint has failed {selectedWebhook.consecutiveFailures} time{selectedWebhook.consecutiveFailures !== 1 ? 's' : ''} in a row. After 5 consecutive failures, deliveries will be temporarily paused.
              </p>
            </div>
          </div>
        )}
        {selectedWebhook.status === 'disabled' && (
          <div className="flex items-start gap-3 rounded-lg border border-red-500/50 bg-red-50 dark:bg-red-950/30 p-3">
            <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-red-700 dark:text-red-300">Webhook disabled</p>
              <p className="text-red-600 dark:text-red-400 mt-0.5">
                This webhook was automatically disabled after {selectedWebhook.consecutiveFailures} consecutive failures. Fix the issue with your endpoint, then resume the webhook to start receiving deliveries again.
              </p>
            </div>
          </div>
        )}

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="deliveries">Deliveries</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 pt-4">
            {/* Configuration */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Configuration</h4>
              <div className="rounded-lg border p-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">URL</span>
                  <span className="font-mono text-xs truncate max-w-[200px] selectable">{selectedWebhook.url}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Events</span>
                  <span>{selectedWebhook.eventTypes?.length || 0} types</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Max Retries</span>
                  <span>{selectedWebhook.maxRetries}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Timeout</span>
                  <span>{selectedWebhook.timeoutMs}ms</span>
                </div>
              </div>
            </div>

            {/* Statistics */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Statistics (24h)</h4>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold">{deliveries.length}</p>
                  <p className="text-xs text-muted-foreground">Total</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold">{Math.round(getSuccessRate(selectedWebhook))}%</p>
                  <p className="text-xs text-muted-foreground">Success Rate</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold">
                    {deliveries.length > 0
                      ? Math.round(
                          deliveries.reduce((sum, d) => sum + (d.latencyMs || 0), 0) /
                            deliveries.filter((d) => d.latencyMs).length
                        ) || '-'
                      : '-'}
                  </p>
                  <p className="text-xs text-muted-foreground">Avg Latency</p>
                </div>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>Last Success: {formatRelativeTime(selectedWebhook.lastSuccessAt)}</p>
                <p>Last Failure: {formatRelativeTime(selectedWebhook.lastFailureAt)}</p>
              </div>
            </div>

            {/* Signing Secret */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Signing Secret</h4>
              <WebhookSecretDisplay
                secret={newRawSecret || selectedWebhook.secret}
                secretPrefix={selectedWebhook.secretPrefix}
                showRotate
                onRotate={handleRotateSecret}
                isRotating={rotating}
              />
            </div>
          </TabsContent>

          <TabsContent value="deliveries" className="pt-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium">Recent Deliveries</h4>
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                onClick={() => refetchDeliveries()}
              >
                <RefreshCw className={`h-3 w-3 mr-1 ${deliveriesLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>

            {deliveriesLoading && deliveries.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : deliveries.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No deliveries yet
              </p>
            ) : (
              <div className="rounded-lg border divide-y">
                {deliveries.map((delivery) => (
                  <WebhookDeliveryRow key={delivery.id} delivery={delivery} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Edit Dialog */}
        <WebhookDialog
          open={!!editingWebhook}
          onOpenChange={(open) => !open && setEditingWebhook(null)}
          webhook={editingWebhook}
          onSaved={handleWebhookSaved}
        />

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteWebhookId} onOpenChange={(open) => !open && setDeleteWebhookId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete webhook?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete the webhook and all its delivery history.
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // List view
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Webhooks</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Receive real-time notifications when events occur.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Create
        </Button>
      </div>

      {/* Webhook List */}
      {webhooksLoading && webhooks.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : webhooks.length === 0 ? (
        <div className="text-center py-8 space-y-3">
          <Link2 className="h-10 w-10 mx-auto text-muted-foreground" />
          <div>
            <p className="font-medium">No webhooks configured</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create a webhook to receive real-time notifications.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Webhook
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border divide-y">
          {webhooks.map((webhook) => (
            <div
              key={webhook.id}
              className="p-3 hover:bg-muted/50 transition-colors cursor-pointer"
              onClick={() => setSelectedWebhookId(webhook.id)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${getStatusColor(webhook)}`} />
                  <span className="font-medium truncate">{webhook.name}</span>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingWebhook(webhook);
                      }}
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTogglePause(webhook);
                      }}
                    >
                      {webhook.status === 'active' ? (
                        <>
                          <Pause className="h-4 w-4 mr-2" />
                          Pause
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4 mr-2" />
                          Resume
                        </>
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteWebhookId(webhook.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {webhook.consecutiveFailures >= 5 && webhook.status === 'active' && (
                <div className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-3 w-3" />
                  <span>Deliveries paused — endpoint unreachable</span>
                </div>
              )}
              {webhook.status === 'disabled' && (
                <div className="mt-1.5 flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                  <AlertCircle className="h-3 w-3" />
                  <span>Disabled after {webhook.consecutiveFailures} consecutive failures</span>
                </div>
              )}

              <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="truncate max-w-[150px]">{webhook.url}</span>
                <span className="shrink-0">{webhook.eventTypes?.length || 0} events</span>
                <span className="shrink-0">{formatRelativeTime(webhook.lastTriggeredAt)}</span>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <Progress value={getSuccessRate(webhook)} className="h-1.5 flex-1" />
                <span className="text-xs text-muted-foreground shrink-0">
                  {Math.round(getSuccessRate(webhook))}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <WebhookDialog
        open={dialogOpen || !!editingWebhook}
        onOpenChange={(open) => {
          if (!open) {
            setDialogOpen(false);
            setEditingWebhook(null);
          }
        }}
        webhook={editingWebhook}
        onSaved={handleWebhookSaved}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteWebhookId} onOpenChange={(open) => !open && setDeleteWebhookId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete webhook?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the webhook and all its delivery history.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
