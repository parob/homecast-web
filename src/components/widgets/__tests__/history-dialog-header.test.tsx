// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { HistoryDialog } from '../HistoryDialog';
import type { HomeKitAccessory } from '@/lib/graphql/types';
import type { AnalyticsScope } from '@/contexts/HistoryContext';

// The dialog's close button is absolutely positioned and its 40px hit circle
// reaches ~23px past the header's content edge. Nothing clickable may live in
// the title row, because a name long enough to stop that row shrinking — most
// names, on a phone — used to push "Open in Analytics" straight under it.

const openAnalytics = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/HistoryContext', () => ({
  useHistory: () => ({
    openAnalytics,
    transport: null,
    analyticsAvailable: true,
  }),
}));

vi.mock('@apollo/client/react', () => ({
  useQuery: () => ({ data: undefined, loading: false }),
}));

vi.mock('@/components/home-analytics/useMultiSeriesHistory', () => ({
  useMultiSeriesHistory: () => ({ data: new Map(), loading: false }),
}));

const accessory = {
  id: 'ACC-1',
  name: 'Living Room Floor Lamp North Wall Sconce',
  services: [],
} as unknown as HomeKitAccessory;

const analyticsLink = () => screen.getByRole('button', { name: /Open in Analytics/ });

describe('HistoryDialog header', () => {
  beforeEach(() => { openAnalytics.mockClear(); });
  afterEach(cleanup);

  it('keeps every control out of the title row, where the close button reaches', () => {
    render(<HistoryDialog target={{ homeId: 'HOME-1', accessory }} onClose={() => {}} />);

    const title = screen.getByRole('heading', { level: 2 });
    expect(title.textContent).toContain(accessory.name);
    expect(title.querySelectorAll('button')).toHaveLength(0);
    expect(title.contains(analyticsLink())).toBe(false);
  });

  it('lets the name shrink instead of shoving the row wider than the dialog', () => {
    render(<HistoryDialog target={{ homeId: 'HOME-1', accessory }} onClose={() => {}} />);

    // `truncate` alone does nothing here: the header is a grid item, so without
    // `min-w-0` the row is floored at its min-content width and overflows.
    const title = screen.getByRole('heading', { level: 2 });
    expect(title.className).toContain('min-w-0');
    const name = title.querySelector('.truncate');
    expect(name).not.toBeNull();
    expect(name!.className).toContain('min-w-0');
  });

  it('still opens the accessory scope and closes the dialog', async () => {
    const onClose = vi.fn();
    render(<HistoryDialog target={{ homeId: 'HOME-1', accessory }} onClose={onClose} />);

    await act(async () => { fireEvent.click(analyticsLink()); });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(openAnalytics).toHaveBeenCalledWith({ level: 'accessory', accessory, homeId: 'HOME-1' });
  });

  it('sends a status target to the scope it was given', async () => {
    const scope: AnalyticsScope = { level: 'category', category: 'climate', room: 'Kitchen', homeId: 'HOME-1' };
    render(
      <HistoryDialog
        target={{
          homeId: 'HOME-1',
          status: { title: 'Status · Kitchen', categories: [], analyticsScope: scope },
        }}
        onClose={() => {}}
      />,
    );

    await act(async () => { fireEvent.click(analyticsLink()); });

    expect(openAnalytics).toHaveBeenCalledWith(scope);
  });
});
