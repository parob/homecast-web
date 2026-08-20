// @vitest-environment jsdom
/**
 * The Analytics gate on a public share page.
 *
 * Before SharedHistoryProvider existed, a share page hid its analytics
 * affordances by accident: /s/:hash mounts outside MainRoutes, so no
 * HistoryProvider was ever rendered, useHistory() fell through to the module
 * default, and every predicate answered false. Correct behaviour that nobody
 * had decided and nothing tested — and one hoisted provider away from leaking
 * a home's history to anyone holding a link.
 *
 * These tests pin the decision. The important assertions are the OFF ones:
 * off is the default for every home that exists today, so off is the case that
 * must never regress.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SharedHistoryProvider, useHistory } from '../HistoryContext';
import type { HomeKitAccessory } from '@/lib/graphql/types';

// The provider must not issue an authenticated query. Rather than trusting a
// reviewer to notice one being added, blow up if Apollo is touched at all.
const useApolloClient = vi.fn(() => {
  throw new Error('SharedHistoryProvider must not use Apollo');
});
vi.mock('@apollo/client/react', () => ({
  useApolloClient: () => useApolloClient(),
  useQuery: () => { throw new Error('SharedHistoryProvider must not query'); },
}));

vi.mock('@/history/mock', () => ({ isMockHistoryEnabled: () => false }));

const RECORDABLE: HomeKitAccessory = {
  id: 'ACC-1',
  name: 'Lamp',
  homeId: 'HOME-1',
  services: [{
    id: 'svc-1',
    serviceType: 'lightbulb',
    name: 'Lamp',
    characteristics: [{ characteristicType: 'power_state', value: true }],
  }],
} as unknown as HomeKitAccessory;

function Probe() {
  const h = useHistory();
  return (
    <div>
      <span data-testid="available">{String(h.analyticsAvailable)}</span>
      <span data-testid="for-home">{String(h.analyticsAvailableFor('HOME-1'))}</span>
      <span data-testid="for-other">{String(h.analyticsAvailableFor('SOMEONE-ELSE'))}</span>
      <span data-testid="accessory">{String(h.historyAvailable(RECORDABLE))}</span>
      <span data-testid="transport">{h.transport ? h.transport.kind : 'none'}</span>
      <button onClick={() => h.openAnalytics()}>open analytics</button>
      <button onClick={() => h.openHistory(RECORDABLE)}>open history</button>
    </div>
  );
}

function renderGate(enabled: boolean, handlers: {
  onOpenAnalytics?: ReturnType<typeof vi.fn>;
  onOpenHistory?: ReturnType<typeof vi.fn>;
} = {}) {
  return render(
    <SharedHistoryProvider
      shareHash="h0123456789ab"
      passcode={null}
      homeId="HOME-1"
      enabled={enabled}
      onOpenAnalytics={handlers.onOpenAnalytics}
      onOpenHistory={handlers.onOpenHistory}
    >
      <Probe />
    </SharedHistoryProvider>,
  );
}

describe('a share link with analytics switched off', () => {
  it('answers no to every gate, which is what hides the buttons', () => {
    renderGate(false);
    expect(screen.getByTestId('available').textContent).toBe('false');
    expect(screen.getByTestId('for-home').textContent).toBe('false');
    expect(screen.getByTestId('accessory').textContent).toBe('false');
  });

  it('offers no transport, so no query can be built from it either', () => {
    renderGate(false);
    expect(screen.getByTestId('transport').textContent).toBe('none');
  });

  it('will not open a surface even if something calls the opener', () => {
    // A callback captured before the owner switched sharing off must not
    // still work. The gate is re-checked inside each opener, not just at
    // render time.
    const onOpenAnalytics = vi.fn();
    const onOpenHistory = vi.fn();
    renderGate(false, { onOpenAnalytics, onOpenHistory });
    screen.getByText('open analytics').click();
    screen.getByText('open history').click();
    expect(onOpenAnalytics).not.toHaveBeenCalled();
    expect(onOpenHistory).not.toHaveBeenCalled();
  });
});

describe('a share link with analytics switched on', () => {
  it('answers yes and carries the share transport', () => {
    renderGate(true);
    expect(screen.getByTestId('available').textContent).toBe('true');
    expect(screen.getByTestId('for-home').textContent).toBe('true');
    expect(screen.getByTestId('accessory').textContent).toBe('true');
    expect(screen.getByTestId('transport').textContent).toBe('share');
  });

  it('opens the surfaces its affordances ask for', () => {
    const onOpenAnalytics = vi.fn();
    const onOpenHistory = vi.fn();
    renderGate(true, { onOpenAnalytics, onOpenHistory });
    screen.getByText('open analytics').click();
    screen.getByText('open history').click();
    expect(onOpenAnalytics).toHaveBeenCalledWith({ level: 'home' });
    expect(onOpenHistory).toHaveBeenCalledWith(
      expect.objectContaining({ homeId: 'HOME-1' }),
    );
  });

  it('answers the same for any home id it is asked about', () => {
    // A share names one home and `enabled` was computed for it server-side.
    // There is no per-home map to consult and pretending otherwise would
    // invent an answer.
    renderGate(true);
    expect(screen.getByTestId('for-other').textContent).toBe('true');
  });
});

describe('the provider itself', () => {
  it('never touches Apollo', () => {
    // HistoryProvider polls GET_HISTORY_STORAGE_STATS every five minutes.
    // That query is authenticated and there is no session on a share page, so
    // this provider must not merely skip it — it must not contain one.
    renderGate(true);
    expect(useApolloClient).not.toHaveBeenCalled();
  });
});
