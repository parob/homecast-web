// Version history panel — browse and restore previous automation saves

import { useState } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { GET_AUTOMATION_VERSIONS } from '@/lib/graphql/queries';
import { RESTORE_AUTOMATION_VERSION } from '@/lib/graphql/mutations';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ArrowLeft, RotateCcw, GitCommitVertical } from 'lucide-react';
import { toast } from 'sonner';

interface VersionHistoryPanelProps {
  automationId: string;
  homeId: string;
  onClose: () => void;
  onRestored: () => void;
}

export function VersionHistoryInline({
  automationId,
  homeId,
  onRestored,
}: {
  automationId: string;
  homeId: string;
  onRestored: () => void;
}) {
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
    <div className="px-1.5 pb-1">
      {loading && (
        <div className="px-2 py-1.5 text-[10px] text-muted-foreground">Loading...</div>
      )}

      {!loading && versions.length === 0 && (
        <div className="px-2 py-1.5 text-[10px] text-muted-foreground">
          No previous versions yet
        </div>
      )}

      {versions.map((version: any) => {
        const time = new Date(version.savedAt).toLocaleString(undefined, {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        });

        return (
          <div
            key={version.id}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors"
          >
            <GitCommitVertical className="w-3 h-3 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-medium">v{version.version}</div>
              <div className="text-[9px] text-muted-foreground leading-tight">{time}</div>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => handleRestore(version.id)}
                  disabled={restoring === version.id}
                >
                  <RotateCcw className={`w-3 h-3 ${restoring === version.id ? 'animate-spin' : ''}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Restore this version</TooltipContent>
            </Tooltip>
          </div>
        );
      })}
    </div>
  );
}
