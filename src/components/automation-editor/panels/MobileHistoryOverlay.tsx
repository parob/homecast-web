// Automation Editor - Mobile history overlay
// Full-screen surface behind the toolbar's History button: past executions
// and version history under one segmented switch. Deliberately separate from
// the node palette overlay — adding nodes and inspecting history are
// different jobs, and mixing them into one tabbed surface read as neither.

import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ExecutionHistoryInline, type TraceEntitySource } from './ExecutionHistoryPanel';
import { VersionHistoryInline } from './VersionHistoryPanel';

type HistoryTab = 'executions' | 'versions';

export function MobileHistoryOverlay({
  automationId,
  homeId,
  entitySource,
  onSelectTrace,
  followLive,
  onToggleFollowLive,
  onVersionRestored,
  onClose,
}: {
  automationId: string;
  homeId?: string;
  entitySource?: TraceEntitySource;
  onSelectTrace?: (parsed: unknown) => void;
  followLive?: boolean;
  onToggleFollowLive?: () => void;
  onVersionRestored?: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<HistoryTab>('executions');
  const showVersions = !!homeId && !!onVersionRestored;

  return (
    <div className="absolute inset-0 z-20 bg-background/95 backdrop-blur-sm sm:hidden flex flex-col" data-testid="mobile-history-overlay">
      <div className="p-2 border-b flex items-center gap-2 shrink-0">
        <div className="flex-1 flex justify-center">
          <div className="flex items-center bg-muted rounded-lg p-0.5">
            {(
              [
                { id: 'executions' as const, label: 'Executions', show: true },
                { id: 'versions' as const, label: 'Versions', show: showVersions },
              ].filter((s) => s.show)
            ).map((segment) => (
              <button
                key={segment.id}
                type="button"
                className={cn(
                  'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                  tab === segment.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
                )}
                onClick={() => setTab(segment.id)}
                data-testid={`history-segment-${segment.id}`}
              >
                {segment.label}
              </button>
            ))}
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose} data-testid="history-close-button">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'executions' && (
          <ExecutionHistoryInline
            automationId={automationId}
            entitySource={entitySource}
            onSelectTrace={onSelectTrace}
            followLive={followLive}
            onToggleFollowLive={onToggleFollowLive}
          />
        )}
        {tab === 'versions' && showVersions && (
          <VersionHistoryInline
            automationId={automationId}
            homeId={homeId!}
            onRestored={onVersionRestored!}
          />
        )}
      </div>
    </div>
  );
}
