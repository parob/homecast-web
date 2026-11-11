// @vitest-environment jsdom
//
// homecast-web#299: in the iOS app, focusing the name field as the dialog
// opened raised the keyboard mid-animation and pushed the heading above the
// screen. A finger now opens the dialog with nothing focused; a mouse still
// lands in the field.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing/react';
import { CreateCollectionDialog } from '../CreateCollectionDialog';

function setPointer(coarse: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(pointer: coarse)' ? coarse : false,
    media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
}

function open() {
  render(
    <MockedProvider mocks={[]}>
      <CreateCollectionDialog open onOpenChange={() => {}} onCreated={() => {}} />
    </MockedProvider>,
  );
  return screen.getByLabelText('Name');
}

afterEach(cleanup);

describe('CreateCollectionDialog focus on open', () => {
  it('does not focus the name field on a touch device, so no keyboard opens', async () => {
    setPointer(true);
    const input = open();
    await new Promise(r => setTimeout(r, 0));
    expect(document.activeElement).not.toBe(input);
  });

  it('focuses the name field with a mouse', async () => {
    setPointer(false);
    const input = open();
    await new Promise(r => setTimeout(r, 0));
    expect(document.activeElement).toBe(input);
  });
});
