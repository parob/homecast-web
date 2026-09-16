import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { useHomeServing } from '@/hooks/useHomeServing';
import { useLocalMode } from '@/hooks/useLocalMode';
import { useStatusLog } from '@/hooks/useStatusLog';
import { buildAnswerCard } from '@/lib/answer-card';
import { isCommunity } from '@/lib/config';
import { thisDeviceNoun } from '@/lib/platform';
import { statusPresentation } from '@/lib/status-badge';
import { cn } from '@/lib/utils';
import { isRelayCapable, isRelayEnabled } from '@/native/homekit-bridge';
import { getHomeServing, getThisDevice } from '@/server/home-serving';

/** The dashboard's status model, rendered as a readable row on other screens. */
export function HomeConnectionSummary({ home, surface = 'home_summary' }: {
  home: { id: string; name: string; isCloudManaged?: boolean };
  surface?: string;
}) {
  const { user } = useAuth();
  const { quality } = useWebSocket();
  const serving = useHomeServing(home.id);
  const local = useLocalMode(home.id);
  const [, tick] = useState(0);
  const deadline = serving?.state === 'waiting' ? serving.graceEndsAt : null;
  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  const community = isCommunity && isRelayCapable();
  const input = {
    quality: community ? 'good' as const : quality, serving,
    relayServing: getHomeServing(home.id), thisDevice: getThisDevice(),
    localReason: local.reason, unmapped: local.identityState === 'unmapped',
    // The plan survives locally answered home lists, whose flags may be absent.
    managed: user?.accountType === 'cloud' || user?.accountType === 'managed' || home.isCloudManaged === true,
    community, relayEnabled: isRelayEnabled(), homeSelected: true, reconnected: false,
  };
  const presentation = statusPresentation(input);
  const answer = buildAnswerCard({ ...input, homeName: home.name, deviceNoun: thisDeviceNoun(), rtt: null });
  useStatusLog(surface, { homeId: home.id, quality: input.quality, serving,
    relayServing: input.relayServing, localReason: local.reason,
    label: presentation.label, verdict: answer.verdict, because: answer.because, colour: presentation.dotClass });
  return <div className="flex items-start gap-2 text-xs text-muted-foreground">
    <span className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', presentation.dotClass, presentation.pulse && 'animate-pulse')} />
    <div>
      <p className="font-medium text-foreground">{presentation.label ?? answer.verdict}</p>
      {answer.because && <p>{answer.because}</p>}
      {answer.via && <p>{answer.via}</p>}
      {answer.caveat && <p>{answer.caveat}</p>}
      {answer.note && <p>{answer.note}</p>}
    </div>
  </div>;
}
