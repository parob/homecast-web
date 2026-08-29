// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

/**
 * The onboarding dialog is the first screen a new account sees, and its copy is
 * the only thing on it. These tests pin the wording rules rather than the
 * sentences: an em dash anywhere in it, and a reader has to work out whether the
 * clause after it is an aside, a consequence or a second thought.
 *
 * Scanning the whole rendered dialog rather than named strings is deliberate —
 * it covers copy added later without anyone remembering to come back here.
 */

let community = false;

vi.mock('@/lib/config', () => ({
  get isCommunity() { return community; },
  config: { appStoreUrl: 'https://apps.apple.com/app/homecast' },
  getRelayAddress: () => null,
}));

vi.mock('@/lib/relay-probe', () => ({
  probeRelay: () => Promise.resolve(null),
}));

vi.mock('@/native/homekit-bridge', () => ({
  isRelayCapable: () => true,
}));

// The intent, mac and cloud steps issue no queries; the shared-home step needs
// an invitations result to get past its spinner.
vi.mock('@apollo/client/react', () => ({
  useQuery: () => ({ data: { pendingInvitations: [] }, loading: false, refetch: vi.fn() }),
  useMutation: () => [vi.fn(), {}],
}));

const { OnboardingOverlay } = await import('../OnboardingOverlay');

type Step = 'intent' | 'mac-setup' | 'cloud-setup' | 'shared-home';

function renderStep(step: Step, props: Record<string, unknown> = {}) {
  render(
    <OnboardingOverlay
      isInMacApp={false}
      onComplete={() => {}}
      onUpgradeStandard={() => {}}
      userEmail="someone@example.com"
      initialStep={step}
      {...props}
    />
  );
  return document.body.textContent ?? '';
}

/** Every dash a reader would see as punctuation rather than a minus sign. */
const PROSE_DASH = /[–—]/;

afterEach(() => {
  community = false;
  cleanup();
});

describe('OnboardingOverlay copy', () => {
  const steps: Step[] = ['intent', 'mac-setup', 'cloud-setup', 'shared-home'];

  for (const step of steps) {
    it(`uses no em or en dashes on the ${step} step`, () => {
      const text = renderStep(step);
      expect(text).not.toMatch(PROSE_DASH);
    });
  }

  // Each of these swaps a branch of the intent step for its other half, and
  // every branch is copy a real account sees.
  it('uses no em or en dashes in the Mac-app and paid-plan variants', () => {
    for (const props of [
      { isInMacApp: true },
      { accountType: 'standard' },
      { accountType: 'cloud', hasHomes: true, onAddHomeInSettings: () => {} },
      { cloudSignupsAvailable: false },
    ]) {
      const text = renderStep('intent', props);
      expect(text, `variant ${JSON.stringify(props)}`).not.toMatch(PROSE_DASH);
      cleanup();
    }
  });

  it('uses no em or en dashes in the Community first-run step', () => {
    community = true;
    const text = renderStep('intent');
    expect(text).not.toMatch(PROSE_DASH);
  });

  // The old line was "Free · 10 accessories · Standard · $8/mo · unlimited":
  // four middots doing two different jobs, wrapping mid-thought on a phone.
  it('states the two plans as one sentence rather than a run of middots', () => {
    const text = renderStep('intent');
    expect(text).toContain('Free for 10 accessories, or $8/mo on Standard for unlimited.');
  });
});
