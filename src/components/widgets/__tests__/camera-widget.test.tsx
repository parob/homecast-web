// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { CameraWidget } from '../CameraWidget';
import type { HomeKitAccessory } from '@/lib/graphql/types';

// jsdom has no matchMedia; the mobile hook asks for it at render.
window.matchMedia = window.matchMedia || (((query: string) => ({
  matches: false, media: query, onchange: null,
  addListener: () => {}, removeListener: () => {},
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia);

// The camera hero is a cloud-relay feature: stills are captured by the relay
// Mac's engine window. These tests pin the three gates that decide whether the
// hero exists at all, and that a still from the relay lands in the image.

const request = vi.fn();
vi.mock('@/server/connection', () => ({ serverConnection: { request: (...a: unknown[]) => request(...a) } }));

let community = false;
let camerasEnabled = true;
vi.mock('@/hooks/useHomeCamerasEnabled', () => ({ useHomeCamerasEnabled: () => camerasEnabled }));
vi.mock('@/lib/config', () => ({
  get isCommunity() { return community; },
  config: { version: 'test', isStaging: false },
}));
vi.mock('@/lib/accessoryRefresh', () => ({ requestAccessoryRefresh: vi.fn() }));
vi.mock('@/contexts/DealsContext', () => ({
  useDeals: () => ({ isTracked: () => false, openPriceHistory: vi.fn() }),
}));
vi.mock('@/contexts/HistoryContext', () => ({
  useHistory: () => ({
    historyAvailable: () => true,
    analyticsAvailable: true,
    analyticsAvailableFor: () => true,
    openHistory: vi.fn(),
    openGroupHistory: vi.fn(),
    openAnalytics: vi.fn(),
  }),
}));
vi.mock('../VirtualAccessoryEditContext', () => ({
  useVirtualAccessoryEditor: () => undefined,
  useVirtualAccessoryRemover: () => undefined,
}));

const camera = (extra: Partial<HomeKitAccessory> = {}): HomeKitAccessory => ({
  id: 'CAM-1', name: 'Kitchen Camera', roomName: 'Kitchen', isReachable: true, category: 'IP Camera',
  services: [{
    id: 's', name: 'Camera', serviceType: 'camera_operating_mode',
    characteristics: [{ id: 'c', characteristicType: 'homekit_camera_active', value: true, isReadable: true, isWritable: false }],
  }],
  camera: { snapshot: true, stream: true },
  ...extra,
});

const baseProps = {
  onToggle: vi.fn(),
  onSlider: vi.fn(),
  getEffectiveValue: (_id: string, _type: string, v: unknown) => v,
} as const;

beforeEach(() => {
  request.mockReset();
  community = false;
  camerasEnabled = true;
});

describe('CameraWidget hero', () => {
  it('asks the relay for a still when expanded and shows it', async () => {
    request.mockResolvedValue({
      accessoryId: 'CAM-1', mimeType: 'image/jpeg', jpeg: 'QUJD', capturedAt: new Date().toISOString(),
      width: 1280, height: 720, cached: false,
    });
    render(<CameraWidget {...baseProps} accessory={camera()} expanded />);
    await waitFor(() => expect(request).toHaveBeenCalledWith('camera.snapshot', expect.objectContaining({ accessoryId: 'CAM-1' })));
    const img = await screen.findByAltText('Kitchen Camera snapshot');
    expect(img.getAttribute('src')).toBe('data:image/jpeg;base64,QUJD');
    expect(screen.getByText(/Captured just now/)).toBeTruthy();
  });

  it('never asks while collapsed', () => {
    render(<CameraWidget {...baseProps} accessory={camera()} />);
    expect(request).not.toHaveBeenCalled();
  });

  it('has no hero for a relay that reports no camera capability', () => {
    render(<CameraWidget {...baseProps} accessory={camera({ camera: undefined })} expanded />);
    expect(request).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Refresh snapshot')).toBeNull();
  });

  it('has no hero until the owner switches cameras on for the home', () => {
    camerasEnabled = false;
    render(<CameraWidget {...baseProps} accessory={camera()} expanded />);
    expect(request).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Refresh snapshot')).toBeNull();
  });

  it('has no hero in Community mode — there is no engine window to capture', () => {
    community = true;
    render(<CameraWidget {...baseProps} accessory={camera()} expanded />);
    expect(request).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Refresh snapshot')).toBeNull();
  });

  it('tells the person what to do when the relay lacks Screen Recording, and stops asking', async () => {
    request.mockRejectedValue({ code: 'SCREEN_RECORDING_DENIED', message: 'denied' });
    render(<CameraWidget {...baseProps} accessory={camera()} expanded />);
    expect(await screen.findByText(/Grant Screen Recording/)).toBeTruthy();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
