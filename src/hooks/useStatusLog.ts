import { useEffect } from 'react';
import { browserLogger } from '@/lib/browser-logger';

/** Record transitions, not render/timer noise. Never include request payloads. */
export function useStatusLog(surface: string, evidence: Record<string, unknown>) {
  const snapshot = JSON.stringify(evidence);
  useEffect(() => {
    browserLogger.logInfo('connection_status', { statusVersion: 1, surface, ...JSON.parse(snapshot) });
  }, [surface, snapshot]);
}
