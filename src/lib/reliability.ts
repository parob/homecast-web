/** Connection duration and accessory-check evidence are deliberately independent. */
export interface ReliabilityWindow {
  label: string; connectedSeconds: number; offlineSeconds: number; unknownSeconds: number;
  coveragePercent: number; availabilityPercent: number | null;
}
export interface ReliabilityBucket {
  bucketStart: string; connectedSeconds: number; offlineSeconds: number; unknownSeconds: number;
  checksVerified: number; checksFailed: number; checksInconclusive: number;
}
export interface HomeReliability {
  asOf: string; connectionState: string; checkStatus: string;
  firstObservedAt: string | null; lastHeardAt: string | null; checkedAt: string | null; checkReason: string | null;
  checksVerified: number; checksFailed: number; checksInconclusive: number;
  windows: ReliabilityWindow[]; timeline: ReliabilityBucket[];
  interruptions: { startedAt: string; endedAt: string | null; durationSeconds: number }[];
}
export function reliabilityPercent(value: number | null | undefined): string {
  return value == null ? '—' : `${Number(value.toFixed(1))}%`;
}
export function connectionLabel(state: string): string {
  return ({ served: 'Connected', waiting: 'Waiting for relay takeover', reconnecting: 'Reconnecting', offline: 'Relay offline' } as Record<string, string>)[state] ?? 'Connection unknown';
}
export function checkLabel(status: string): string {
  return ({ verified: 'Live read verified', failed: 'Last live check failed', unavailable: 'Live check unavailable', pending: 'Awaiting first check', stale: 'No recent live check' } as Record<string, string>)[status] ?? 'Check unavailable';
}
export function checkExplanation(reason: string | null): string {
  if (reason?.includes('all_reported_unreachable')) return 'The relay reports all accessories as unreachable.';
  if (reason?.includes('no_accessories')) return 'The relay has no accessories to check in this home.';
  if (reason?.includes('no_readable_characteristics')) return 'No accessory offers a supported live reading.';
  if (reason?.startsWith('no_probe_target')) return 'The relay could not find an accessory for a live check.';
  if (reason?.startsWith('cached_read')) return 'This check returned cached information, so a live read was not verified.';
  if (reason?.startsWith('probe_timeout')) return 'The live check did not answer in time.';
  if (reason?.startsWith('accessory_error')) return 'The accessory could not complete the live read.';
  return '';
}
export function observedDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor(seconds % 86400 / 3600)}h`;
}
export function reliabilityBrief(evidence: HomeReliability): string {
  const week = evidence.windows.find(w => w.label === '7d');
  if (week?.availabilityPercent == null) return 'No recorded history';
  return `${reliabilityPercent(week.availabilityPercent)} connected · ${observedDuration(week.connectedSeconds + week.offlineSeconds)} observed`;
}
