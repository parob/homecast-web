// Version history panel — browse and restore previous automation saves

import { useState } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { GET_AUTOMATION_VERSIONS } from '@/lib/graphql/queries';
import { RESTORE_AUTOMATION_VERSION } from '@/lib/graphql/mutations';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RotateCcw, GitCommitVertical } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface VersionHistoryPanelProps {
  automationId: string;
  homeId: string;
  onClose: () => void;
  onRestored: () => void;
  /** When true, skip outer wrapper chrome (width/border/bg + header) — caller provides it */
  embedded?: boolean;
}

export function VersionHistoryPanel({ automationId, homeId, onClose, onRestored, embedded }: VersionHistoryPanelProps) {
  const [restoring, setRestoring] = useState<string | null>(null);

  const { data, loading } = useQuery(GET_AUTOMATION_VERSIONS, {
    variables: { automationId },
    fetchPolicy: 'network-only',
  });

  const [restoreVersion] = useMutation(RESTORE_AUTOMATION_VERSION);

  const versions = data?.automationVersions ?? [];

  const handleRestore = async (versionId: string) => {
    setRestoring(versionId);
    try {
      await restoreVersion({ variables: { homeId, versionId } });
      toast.success('Version restored');
      onRestored();
    } catch (e) {
      toast.error('Failed to restore version');
      console.error(e);
    } finally {
      setRestoring(null);
    }
  };

  return (
    <div className={cn(
      'flex flex-col min-h-0 h-full shrink-0 bg-background',
      embedded ? 'w-full' : 'w-full sm:w-80 border-l',
    )}>
      {!embedded && (
        <div className="h-12 border-b flex items-center gap-2 px-3 shrink-0">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium flex-1">Version History</span>
          <span className="text-[10px] text-muted-foreground">{versions.length} versions</span>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && (
          <div className="p-4 text-xs text-muted-foreground">Loading...</div>
        )}

        {!loading && versions.length === 0 && (
          <div className="p-4 text-xs text-muted-foreground">
            No previous versions yet. Versions are saved automatically each time you save.
          </div>
        )}

        {versions.map((version: any) => {
          const time = new Date(version.savedAt).toLocaleString(undefined, {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          });

          return (
            <div
              key={version.id}
              className="px-3 py-2.5 border-b flex items-center gap-2 hover:bg-muted/50 transition-colors"
            >
              <GitCommitVertical className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium">Version {version.version}</div>
                <div className="text-[10px] text-muted-foreground">{time}</div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[10px] px-2"
                onClick={() => handleRestore(version.id)}
                disabled={restoring === version.id}
              >
                <RotateCcw className="w-3 h-3 mr-1" />
                {restoring === version.id ? 'Restoring...' : 'Restore'}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
