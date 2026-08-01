// @vitest-environment jsdom
//
// Mobile access to executions and version history. These live in a dedicated
// History overlay (MobileHistoryOverlay) opened from the toolbar — the node
// palette overlay is a pure "Add Node" surface and must NOT grow tabs, and
// vice versa. Desktop keeps the three-tab sidebar (NodePalette).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../panels/ExecutionHistoryPanel', () => ({
  ExecutionHistoryInline: ({ automationId }: { automationId: string }) => (
    <div data-testid="execution-history" data-automation-id={automationId} />
  ),
  STATUS_STYLES: {},
}));
vi.mock('../panels/VersionHistoryPanel', () => ({
  VersionHistoryInline: ({ automationId }: { automationId: string }) => (
    <div data-testid="version-history" data-automation-id={automationId} />
  ),
}));

import { MobileHistoryOverlay } from '../panels/MobileHistoryOverlay';
import { NodePalette } from '../panels/NodePalette';

afterEach(() => cleanup());

describe('MobileHistoryOverlay', () => {
  const baseProps = {
    automationId: 'auto-1',
    homeId: 'home-1',
    onVersionRestored: () => {},
    onClose: () => {},
  };

  it('opens on executions', () => {
    render(<MobileHistoryOverlay {...baseProps} />);
    expect(screen.getByTestId('execution-history').getAttribute('data-automation-id')).toBe('auto-1');
    expect(screen.queryByTestId('version-history')).toBeNull();
  });

  it('switches to version history via the segmented control', () => {
    render(<MobileHistoryOverlay {...baseProps} />);
    fireEvent.click(screen.getByTestId('history-segment-versions'));
    expect(screen.getByTestId('version-history').getAttribute('data-automation-id')).toBe('auto-1');
    expect(screen.queryByTestId('execution-history')).toBeNull();
  });

  it('hides the Versions segment without a home id', () => {
    render(<MobileHistoryOverlay automationId="auto-1" onClose={() => {}} />);
    expect(screen.queryByTestId('history-segment-versions')).toBeNull();
    expect(screen.getByTestId('execution-history')).toBeTruthy();
  });

  it('closes via the X button', () => {
    const onClose = vi.fn();
    render(<MobileHistoryOverlay {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('history-close-button'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('NodePalette surfaces', () => {
  it('mobile overlay mode is a pure Add Node surface — no history tabs', () => {
    render(<NodePalette forceVisible onAddNode={() => {}} automationId="auto-1" homeId="home-1" onVersionRestored={() => {}} />);
    expect(screen.queryByText('Executions')).toBeNull();
    expect(screen.queryByText('Versions')).toBeNull();
  });

  it('desktop sidebar keeps the three tabs for saved automations', () => {
    render(<NodePalette onAddNode={() => {}} automationId="auto-1" homeId="home-1" onVersionRestored={() => {}} />);
    expect(screen.getByText('Nodes')).toBeTruthy();
    expect(screen.getByText('Executions')).toBeTruthy();
    expect(screen.getByText('Versions')).toBeTruthy();
  });
});
