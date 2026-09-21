// @vitest-environment jsdom
//
// The corner cluster in an expanded panel. Price & Deals joined it because the
// deal badge only ever appears on the collapsed tile, so an expanded accessory
// offered no way to prices but a right-click — and a service group offered none
// at all.
//
// Two things are worth pinning. Order: the two "read about this" actions sit
// together ahead of the ones that act on it. And the split between the word on
// the button and the fuller phrasing behind it — homecast-cloud#162 reported
// the icon-only version as unreadable, and a label that silently fell back to
// the long phrasing would put "Delete Virtual Accessory" on a pill in a 360px
// panel, which is the same problem wearing a different hat.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import ExpandedActionBar, { type ExpandedAction } from '../ExpandedActionBar';

afterEach(cleanup);

const ALL: ExpandedAction[] = [
  { key: 'analytics', icon: 'analytics', label: 'Analytics', onClick: () => {} },
  { key: 'prices', icon: 'prices', label: 'Prices', ariaLabel: 'Price & Deals', onClick: () => {} },
  { key: 'edit', icon: 'edit', label: 'Edit', onClick: () => {} },
  { key: 'share', icon: 'share', label: 'Share', onClick: () => {} },
];

describe('ExpandedActionBar', () => {
  it('reads left to right as analytics, prices, edit, share', () => {
    render(<ExpandedActionBar actions={ALL} onDark={false} />);
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Analytics', 'Price & Deals', 'Edit', 'Share']);
  });

  it('says what each button does in words, not only in a glyph', () => {
    render(<ExpandedActionBar actions={ALL} onDark={false} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Analytics', 'Prices', 'Edit', 'Share',
    ]);
  });

  it('shows the short word and keeps the full phrasing as name and tooltip', () => {
    render(<ExpandedActionBar actions={ALL} onDark={false} />);
    const prices = screen.getByRole('button', { name: 'Price & Deals' });
    expect(prices.textContent).toBe('Prices');
    expect(prices.getAttribute('title')).toBe('Price & Deals');
    expect(prices.querySelector('svg')).not.toBeNull();
  });

  it('falls back to the word itself when there is no fuller phrasing', () => {
    render(<ExpandedActionBar actions={ALL} onDark={false} />);
    const share = screen.getByRole('button', { name: 'Share' });
    expect(share.getAttribute('title')).toBe('Share');
  });

  it('wraps rather than truncating, so a sixth action still shows its word', () => {
    const { container } = render(<ExpandedActionBar actions={ALL} onDark={false} />);
    expect(container.firstElementChild?.className).toContain('flex-wrap');
    // Whatever else changes about the pill, the word must not be cut in half
    // to make it fit — wrapping is the release valve, not truncation.
    expect(container.querySelector('button')?.className).toContain('whitespace-nowrap');
  });

  it('renders nothing at all when an accessory offers no actions', () => {
    const { container } = render(<ExpandedActionBar actions={[]} onDark={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('drops the cluster to white ink only over a dark tile', () => {
    const { container: light } = render(<ExpandedActionBar actions={ALL} onDark={false} />);
    expect(light.querySelector('button')?.className).toContain('text-slate-900/80');
    cleanup();
    const { container: dark } = render(<ExpandedActionBar actions={ALL} onDark />);
    expect(dark.querySelector('button')?.className).toContain('text-white');
  });
});
