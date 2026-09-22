import { useEffect, useState } from 'react';
import { useHomes } from './useHomeKitData';
import { useHomeServingVersion } from './useHomeServing';
import { serverConnection } from '@/server/connection';
import { getHomeServing, getThisDevice } from '@/server/home-serving';
import { relaySectionState, RELAY_DUTY } from '@/lib/relay-section-state';
import { useStatusLog } from './useStatusLog';

/** Both relay dashboards read the same server-owned per-home assignments. */
export function useRelayDuty() {
  const [connectionState, setConnectionState] = useState(() => serverConnection.getState().connectionState);
  useEffect(() => serverConnection.subscribe(() => setConnectionState(serverConnection.getState().connectionState)), []);
  useHomeServingVersion();
  const { data: homes } = useHomes();
  const verdict = relaySectionState({ connectionState, community: false, homes: homes ?? [],
    serving: getHomeServing, thisDevice: getThisDevice() });
  const duty = RELAY_DUTY[verdict.state];
  useStatusLog('relay_duty', { state: verdict.state, label: duty.value, connectionState,
    servingHomes: (homes ?? []).filter(h => getHomeServing(h.id)?.by === getThisDevice()).map(h => h.id) });
  return { ...verdict, ...duty };
}
