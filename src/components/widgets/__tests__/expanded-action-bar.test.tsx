// @vitest-environment jsdom
//
// The corner cluster in an expanded panel. Price & Deals joined it because the
// deal badge only ever appears on the collapsed tile, so an expanded accessory
// offered no way to prices but a right-click — and a service group offered none
// at all.
//
// Order is the thing worth pinning: the two "read about this" actions sit
// together ahead of the two that act on it.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import ExpandedActionBar, { type ExpandedAction } from '../ExpandedActionBar';

afterEach(cleanup);

const ALL: ExpandedAction[] = [
  { key: 'analytics', icon: 'analytics', label: 'Analytics', onClick: () => {} },
  { key: 'prices', icon: 'prices', label: 'Price & Deals', onClick: () => {} },
  { key: 'edit', icon: 'edit', label: 'Edit', onClick: () => {} },
  { key: 'share', icon: 'share', label: 'Share', onClick: () => {} },
];

describe('ExpandedActionBar', () => {
  it('reads left to right as analytics, prices, edit, share', () => {
    render(<ExpandedActionBar actions={ALL} onDark={false} />);
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Analytics', 'Price & Deals', 'Edit', 'Share']);
  });

  it('gives Price & Deals a real button, labelled for a screen reader and a tooltip', () => {
    render(<ExpandedActionBar actions={ALL} onDark={false} />);
    const prices = screen.getByRole('button', { name: 'Price & Deals' });
    expect(prices.getAttribute('title')).toBe('Price & Deals');
    expect(prices.querySelector('svg')).not.toBeNull();
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
