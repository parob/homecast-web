import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Check, X, Clock, AlertCircle, RotateCcw, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AnimatedCollapse } from '@/components/ui/animated-collapse';
import { parseUTCTimestamp } from '@/lib/date';
import type { WebhookDeliveryInfo, DeliveryStatus } from '@/lib/graphql/types';

interface WebhookDeliveryRowProps {
  delivery: WebhookDeliveryInfo;
  onRetry?: () => void;
}

const statusConfig: Record<DeliveryStatus, { icon: React.ElementType; color: string; label: string }> = {
  success: { icon: Check, color: 'text-green-500', label: 'Success' },
  failed: { icon: X, color: 'text-red-500', label: 'Failed' },
  pending: { icon: Clock, color: 'text-yellow-500', label: 'Pending' },
  retrying: { icon: RotateCcw, color: 'text-blue-500', label: 'Retrying' },
  dead_letter: { icon: AlertCircle, color: 'text-red-700', label: 'Dead Letter' },
};

/** Map raw error messages to user-friendly descriptions. */
function describeError(errorMessage: string): { short: string; detail: string } {
  const msg = errorMessage.toLowerCase();

  if (msg.includes('circuit breaker') || msg.includes('endpoint unreachable')) {
    return {
      short: 'Skipped',
      detail: 'Delivery was skipped because your endpoint had multiple consecutive failures. The server pauses deliveries briefly to avoid overwhelming an unresponsive endpoint, then automatically retries.',
    };
  }
  if (msg.includes('request timeout') || msg.includes('timed out')) {
    return {
      short: 'Timeout',
      detail: 'Your endpoint did not respond within the configured timeout. Make sure it responds quickly (ideally under 5 seconds) and returns a 2xx status.',
    };
  }
  if (msg.includes('connection error') || msg.includes('connection refused')) {
    return {
      short: 'Connection failed',
      detail: 'Could not connect to your endpoint. Check that the URL is correct and your server is running and accepting connections.',
    };
  }
  if (msg.startsWith('http ')) {
    const code = msg.replace('http ', '');
    return {
      short: `HTTP ${code}`,
      detail: `Your endpoint returned status ${code}. Webhook deliveries expect a 2xx response to be considered successful.`,
    };
  }

  return { short: 'Error', detail: errorMessage };
}

export function WebhookDeliveryRow({ delivery, onRetry }: WebhookDeliveryRowProps) {
  const [expanded, setExpanded] = useState(false);

  const config = statusConfig[delivery.status as DeliveryStatus] || statusConfig.pending;
  const StatusIcon = config.icon;

  const errorInfo = delivery.errorMessage ? describeError(delivery.errorMessage) : null;
  const msg = delivery.errorMessage?.toLowerCase() ?? '';
  const isSkipped = msg.includes('circuit breaker') || msg.includes('endpoint unreachable');

  const formatTime = (isoString: string | null) => {
    const date = parseUTCTimestamp(isoString);
    if (!date) return '';
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  };

  const formatRelativeTime = (isoString: string | null) => {
    const date = parseUTCTimestamp(isoString);
    if (!date) return '';
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffSecs = Math.round(diffMs / 1000);

    if (diffSecs < 0) return 'now';
    if (diffSecs < 60) return `in ${diffSecs}s`;
    const diffMins = Math.round(diffSecs / 60);
    return `in ${diffMins}m`;
  };

  // Use Ban icon for skipped deliveries
  const RowIcon = isSkipped ? Ban : StatusIcon;
  const rowIconColor = isSkipped ? 'text-muted-foreground' : config.color;

  return (
    <div className="border-b last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}

        <span className="text-xs text-muted-foreground w-20 shrink-0">
          {formatTime(delivery.createdAt)}
        </span>

        <span className="text-sm flex-1 truncate">
          {delivery.eventType}
        </span>

        <div className="flex items-center gap-2 shrink-0">
          {delivery.responseStatusCode ? (
            <Badge
              variant={delivery.status === 'success' ? 'default' : 'destructive'}
              className="text-xs"
            >
              {delivery.responseStatusCode}
            </Badge>
          ) : errorInfo && delivery.status !== 'pending' && delivery.status !== 'retrying' ? (
            <span className="text-xs text-muted-foreground">
              {errorInfo.short}
            </span>
          ) : null}

          {delivery.latencyMs ? (
            <span className="text-xs text-muted-foreground w-14 text-right">
              {delivery.latencyMs}ms
            </span>
          ) : null}

          <RowIcon className={`h-4 w-4 ${rowIconColor}`} />
        </div>
      </button>

      <AnimatedCollapse open={expanded}>
        <div className="px-3 pb-3 space-y-3 border-t bg-muted/30">
          <div className="pt-3 grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-xs text-muted-foreground">Event ID</span>
              <p className="font-mono text-xs truncate selectable">{delivery.eventId}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Status</span>
              <p className={`font-medium ${config.color}`}>{config.label}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Attempts</span>
              <p>{delivery.attemptNumber} / {delivery.maxAttempts}</p>
            </div>
            {delivery.nextRetryAt && (
              <div>
                <span className="text-xs text-muted-foreground">Next Retry</span>
                <p>{formatRelativeTime(delivery.nextRetryAt)}</p>
              </div>
            )}
          </div>

          {errorInfo && (
            <div>
              <span className="text-xs text-muted-foreground">Error</span>
              <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                {errorInfo.detail}
              </p>
            </div>
          )}

          {delivery.responseBody && (
            <div>
              <span className="text-xs text-muted-foreground">Response</span>
              <pre className="mt-1 p-2 rounded-md bg-muted text-xs font-mono overflow-x-auto max-h-32">
                {delivery.responseBody}
              </pre>
            </div>
          )}

          {onRetry && delivery.status !== 'success' && delivery.status !== 'pending' && (
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onRetry();
              }}
            >
              <RotateCcw className="h-3 w-3 mr-2" />
              Retry Now
            </Button>
          )}
        </div>
      </AnimatedCollapse>
    </div>
  );
}
