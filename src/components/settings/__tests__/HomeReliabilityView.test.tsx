// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { HomeReliabilityView } from '../HomeReliabilityView';
import { UptimeSectionView, type UptimeSummary } from '../UptimeSection';
import { reliabilityBrief, type HomeReliability } from '@/lib/reliability';

afterEach(cleanup);
const base: HomeReliability = {
  asOf: '2026-10-12T09:30:00Z', connectionState: 'served', checkStatus: 'unavailable',
  firstObservedAt: '2026-10-12T08:30:00Z', lastHeardAt: '2026-10-12T09:30:00Z', checkedAt: '2026-10-12T09:29:00Z', checkReason: 'no_probe_target',
  checksVerified: 0, checksFailed: 2, checksInconclusive: 12,
  windows: ['24h','7d','30d'].map(label => ({ label, connectedSeconds: 3600, offlineSeconds: 0, unknownSeconds: 82800, availabilityPercent: 100, coveragePercent: 4.2 })),
  timeline: [{ bucketStart: '2026-10-12T09:00:00Z', connectedSeconds: 1800, offlineSeconds: 0, unknownSeconds: 0, checksVerified: 0, checksFailed: 2, checksInconclusive: 12 }], interruptions: [],
};

describe('shared home reliability', () => {
  it('keeps an unavailable live check separate from the connection', () => {
    render(<HomeReliabilityView evidence={base} />);
    expect(screen.getAllByText('Connected').length).toBeGreaterThan(0);
    expect(screen.getByText('Live check unavailable')).toBeTruthy();
    expect(screen.getByText(/2 failed · 12 inconclusive/)).toBeTruthy();
    expect(screen.getByText(/No disconnections recorded during observed time/)).toBeTruthy();
    expect(screen.queryByText(/Currently offline/)).toBeNull();
    fireEvent.click(screen.getByRole('button', {name: /^Connection, /}));
    expect(screen.getByText(/30m connected · 0s disconnected · 0s unknown/)).toBeTruthy();
  });
  it('shows missing history as unknown rather than zero reliability', () => {
    render(<HomeReliabilityView evidence={{...base, windows: base.windows.map(w => ({...w, availabilityPercent: null, coveragePercent: 0}))}} />);
    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.getByText(/No recorded history yet/)).toBeTruthy();
    expect(screen.queryByText('0%')).toBeNull();
  });
  it('renders the same measurements in owner and admin views', () => {
    const {container, unmount} = render(<UptimeSectionView summary={{reliability: base} as UptimeSummary} />);
    const customer = container.textContent;
    unmount();
    const admin = render(<HomeReliabilityView evidence={base} admin />);
    expect(admin.container.textContent?.startsWith(customer!)).toBe(true);
    expect(screen.getByText('Diagnostics')).toBeTruthy();
  });
  it('labels partial history in the status popover', () => {
    expect(reliabilityBrief(base)).toBe('100% connected · 1h 0m observed');
    expect(reliabilityBrief({...base, windows: []})).toBe('No recorded history');
  });
  it('does not imply one verified read confirms all accessories', () => {
    render(<HomeReliabilityView evidence={{...base, checkStatus: 'verified', checkReason: null}} />);
    expect(screen.getByText(/does not verify every device/)).toBeTruthy();
  });
});
