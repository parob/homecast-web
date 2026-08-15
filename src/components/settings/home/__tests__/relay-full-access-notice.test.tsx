// @vitest-environment jsdom
//
// The "Give the relay Full access" notice sits at the top of a home's settings
// page, above the home's own details, on a home that works fine without it.
// Two things are guarded here:
//
//  - it stays one line, with the explanation behind a popup rather than inline;
//  - dismissing it is permanent. The old per-id localStorage key came back
//    whenever the home's id was reported in a different case or re-minted,
//    which is exactly when a user is least inclined to believe they dismissed it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing/react';

// config.ts reads localStorage at module scope, which jsdom doesn't provide here.
vi.mock('@/lib/config', () => ({
  isCommunity: false,
  getCommunityMode: () => null,
  isRelayMode: () => false,
  isClientMode: () => false,
  isRelaySetupComplete: () => false,
  config: { isCommunity: false, apiBase: 'https://api.test', graphqlUrl: 'https://api.test/', wsUrl: 'wss://api.test/ws' },
}));

import { HomeOverviewSection } from '../HomeOverviewSection';
import type { HomeKitHome } from '@/lib/graphql/types';

// This environment's localStorage is a stub with no methods.
const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  },
});

const VIEW_ONLY_HOME: HomeKitHome = {
  id: 'HOME-ABCD',
  name: 'Beach House',
  isPrimary: true,
  roomCount: 3,
  accessoryCount: 12,
  isAdmin: false,
  relayConnected: true,
};

function renderHome(home: HomeKitHome = VIEW_ONLY_HOME) {
  return render(
    <MockedProvider mocks={[]}>
      <HomeOverviewSection home={home} />
    </MockedProvider>,
  );
}

/** The notice's headline, in one place so copy edits don't rewrite six tests. */
const NOTICE = 'Let Homecast edit scenes and automations';

describe('relay Full access notice', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('is one line, with the steps behind the popup rather than inline', () => {
    renderHome();
    expect(screen.getByText(NOTICE)).toBeTruthy();
    // The Apple Home path is not in the notice itself.
    expect(screen.queryByText(/Add & Edit Accessories/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'How' }));
    expect(screen.getByText(/Add & Edit Accessories/)).toBeTruthy();
    expect(screen.getByText(/Under People/)).toBeTruthy();
  });

  it('wraps rather than truncating, so the sentence never trails off', () => {
    // It used to be `truncate`, which on a narrow phone cut the line mid-phrase
    // — and the words that carried the meaning were the ones at the end.
    renderHome();
    const line = screen.getByText(NOTICE).parentElement!;
    expect(line.className).not.toContain('truncate');
  });

  it('stays hidden after dismissal, across a remount', () => {
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(NOTICE)).toBeNull();

    cleanup();
    renderHome();
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it('stays hidden when the same home comes back under a re-cased id', () => {
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    cleanup();

    renderHome({ ...VIEW_ONLY_HOME, id: 'home-abcd' });
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it('still shows for a different home', () => {
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    cleanup();

    renderHome({ ...VIEW_ONLY_HOME, id: 'HOME-EEEE', name: 'County Hall' });
    expect(screen.getByText(NOTICE)).toBeTruthy();
  });

  it('keeps the steps reachable from the access row once dismissed', () => {
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    fireEvent.click(screen.getByRole('button', { name: 'View-only' }));
    expect(screen.getByText(/Add & Edit Accessories/)).toBeTruthy();
  });

  it('shows no notice when the relay already has Full access', () => {
    renderHome({ ...VIEW_ONLY_HOME, isAdmin: true });
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(screen.getByText('Full access')).toBeTruthy();
  });
});
