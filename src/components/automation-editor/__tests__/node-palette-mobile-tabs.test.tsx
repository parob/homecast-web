// @vitest-environment jsdom
//
// The mobile palette overlay renders NodePalette with `forceVisible`, which
// used to suppress the tab strip entirely — and the call site didn't pass
// automationId/homeId — so the Executions and Versions tabs were unreachable
// on phones. These tests pin the fixed structure: the tab strip renders in
// forceVisible mode, the tabs appear when the ids are provided, and the
// overlay close button lives in the tab row.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../panels/ExecutionHistoryPanel', () => ({
  ExecutionHistoryInline: ({ automationId }: { automationId: string }) => (
    <div data-testid="execution-history" data-automation-id={automationId} />
  ),
  STATUS_STYLES: {},
}));
vi.mock('../panels/VersionHistoryPanel', () => ({
  VersionHistoryInline: () => <div data-testid="version-history" />,
}));

import { NodePalette } from '../panels/NodePalette';

afterEach(() => cleanup());

describe('NodePalette in mobile overlay (forceVisible) mode', () => {
  it('renders the Executions and Versions tabs when ids are provided', () => {
    render(
      <NodePalette
        forceVisible
        onAddNode={() => {}}
        automationId="auto-1"
        homeId="home-1"
        onVersionRestored={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText('Executions')).toBeTruthy();
    expect(screen.getByText('Versions')).toBeTruthy();
  });

  it('opens the execution history when the Executions tab is tapped', () => {
    render(
      <NodePalette
        forceVisible
        onAddNode={() => {}}
        automationId="auto-1"
        homeId="home-1"
        onVersionRestored={() => {}}
      />,
    );

    fireEvent.click(screen.getByText('Executions'));
    expect(screen.getByTestId('execution-history').getAttribute('data-automation-id')).toBe('auto-1');
  });

  it('shows a close button in the tab row when onClose is provided', () => {
    const onClose = vi.fn();
    render(<NodePalette forceVisible onAddNode={() => {}} onClose={onClose} />);

    fireEvent.click(screen.getByTestId('palette-close-button'));
    expect(onClose).toHaveBeenCalled();
  });

  it('opens directly on the requested tab (toolbar History deep-link)', () => {
    render(
      <NodePalette
        forceVisible
        initialTab="executions"
        onAddNode={() => {}}
        automationId="auto-1"
        homeId="home-1"
        onVersionRestored={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByTestId('execution-history').getAttribute('data-automation-id')).toBe('auto-1');
  });

  it('keeps only the Nodes tab for unsaved automations', () => {
    render(<NodePalette forceVisible onAddNode={() => {}} onClose={() => {}} />);

    expect(screen.getByText('Nodes')).toBeTruthy();
    expect(screen.queryByText('Executions')).toBeNull();
    expect(screen.queryByText('Versions')).toBeNull();
  });
});
