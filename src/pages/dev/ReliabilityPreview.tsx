/** Dev-only examples of the same component used by owner and admin reliability. */
import { useState } from 'react';
import { HomeReliabilityView } from '@/components/settings/HomeReliabilityView';
import { UptimeSectionView, type UptimeSummary } from '@/components/settings/UptimeSection';
import type { HomeReliability } from '@/lib/reliability';

const HOUR = 3600;
const NOW = Date.parse('2026-10-12T09:00:00Z');
const iso = (seconds: number) => new Date(NOW + seconds * 1000).toISOString();
const scenarios = ['unavailable', 'verified', 'failed', 'offline', 'waiting', 'no-history'] as const;
function evidence(scenario: string): HomeReliability {
  const empty = scenario === 'no-history';
  const disconnected = scenario === 'offline' || scenario === 'waiting';
  const r: HomeReliability = {
    asOf: iso(0), connectionState: disconnected ? scenario : 'served',
    checkStatus: empty ? 'pending' : disconnected ? 'stale' : scenario,
    firstObservedAt: empty ? null : iso(-48*HOUR), lastHeardAt: empty ? null : iso(-10),
    checkedAt: empty ? null : iso(-60), checkReason: scenario === 'unavailable' ? 'no_probe_target' : scenario === 'failed' ? 'accessory_error: read_error' : null,
    checksVerified: 0, checksFailed: 0, checksInconclusive: 0,
    windows: [], timeline: [], interruptions: [],
  };
  for (let hour=-168; hour<0; hour++) {
    const unknown = empty || hour < -48;
    const offline = !unknown && disconnected && hour === -1;
    const failed = !unknown && !offline && scenario === 'failed' && hour === -1;
    const verified = !unknown && !offline && scenario !== 'unavailable' && !failed;
    r.timeline.push({ bucketStart: iso(hour*HOUR), connectedSeconds: unknown || offline ? 0 : HOUR, offlineSeconds: offline ? HOUR : 0, unknownSeconds: unknown ? HOUR : 0,
      checksVerified: verified ? 12 : 0, checksFailed: failed ? 2 : 0, checksInconclusive: !unknown && scenario === 'unavailable' ? 12 : 0 });
  }
  r.checksVerified = r.timeline.reduce((n,b) => n+b.checksVerified,0);
  r.checksFailed = r.timeline.reduce((n,b) => n+b.checksFailed,0);
  r.checksInconclusive = r.timeline.reduce((n,b) => n+b.checksInconclusive,0);
  r.windows = [1,7,30].map((days,i) => {
    const known = empty ? 0 : Math.min(days*24,48)*HOUR;
    const offline = disconnected ? HOUR : 0;
    return { label: ['24h','7d','30d'][i], connectedSeconds: known-offline, offlineSeconds: offline, unknownSeconds: days*24*HOUR-known, coveragePercent: known/(days*24*HOUR)*100, availabilityPercent: known ? (known-offline)/known*100 : null };
  });
  if(disconnected) r.interruptions.push({startedAt:iso(-HOUR),endedAt:null,durationSeconds:HOUR});
  return r;
}
export default function ReliabilityPreview() {
  const params=new URLSearchParams(location.search);
  const [scenario,setScenario]=useState(params.get('case') ?? 'unavailable');
  const [admin,setAdmin]=useState(params.has('admin'));
  const r=evidence(scenario);
  const s: UptimeSummary = { currentStatus:'connected',uptimePercent24h:0,uptimePercent7d:0,uptimePercent30d:0,verifiedRatio7d:0,avgLatencyMs:null,statusSince:null,lastProbe:null,timeline:[],outages:[],reliability:r };
  return <main className="max-w-4xl mx-auto p-5 space-y-5">
    <h1 className="text-xl font-semibold">Reliability preview</h1>
    <div className="flex flex-wrap gap-3 text-xs"><label>Scenario <select aria-label="Scenario" className="rounded border p-1 bg-background" value={scenario} onChange={e=>setScenario(e.target.value)}>{scenarios.map(s=><option key={s}>{s}</option>)}</select></label><label><input type="checkbox" checked={admin} onChange={e=>setAdmin(e.target.checked)} /> Admin diagnostics</label></div>
    {admin ? <HomeReliabilityView evidence={r} admin /> : <UptimeSectionView summary={s} />}
  </main>;
}
