import { statusPresentation } from '@/lib/status-badge';
import { buildAnswerCard } from '@/lib/answer-card';
import type { HomeServing } from '@/server/home-serving';

/** MQTT needs the cloud route, never this device's Local Mode. */
export function homeRelayStatus(homeName: string, serving: HomeServing | null, managed = false) {
  const input = {
    quality: serving ? 'good' as const : 'unknown' as const,
    serving, relayServing: serving, thisDevice: null, localReason: null,
    unmapped: false, managed, community: false, relayEnabled: false,
    homeSelected: true, reconnected: false,
  };
  const presentation = statusPresentation(input);
  const answer = buildAnswerCard({ ...input, homeName, deviceNoun: 'This browser', rtt: null });
  return {
    ...presentation,
    tone: answer.tone,
    label: presentation.label ?? (serving?.state === 'served' ? 'Online' : 'Checking relay…'),
    explanation: answer.because,
  };
}
