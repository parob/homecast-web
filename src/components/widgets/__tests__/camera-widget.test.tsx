// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { CameraWidget } from '../CameraWidget';
import { DoorbellWidget } from '../DoorbellWidget';
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
  id: 'CAM-1', homeId: 'HOME-1', name: 'Kitchen Camera', roomName: 'Kitchen', isReachable: true, category: 'IP Camera',
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
  baseProps.onToggle.mockClear();
  community = false;
  camerasEnabled = true;
});

describe('CameraWidget hero', () => {
  it('shows snapshots on an expanded video doorbell too', async () => {
    request.mockResolvedValue({ jpeg: 'QUJD', mimeType: 'image/jpeg', capturedAt: new Date().toISOString(), width: 720, height: 1280 });
    render(<DoorbellWidget {...baseProps} accessory={camera({ name: 'Front Door', category: '' })} expanded />);
    expect(await screen.findByAltText('Front Door snapshot')).toBeTruthy();
    expect(request).toHaveBeenCalledWith('camera.snapshot', expect.objectContaining({ accessoryId: 'CAM-1', homeId: 'HOME-1' }));
  });

  it.each([{ expanded: false }, { expanded: true, compact: true }])('does not poll a collapsed or compact doorbell (%j)', (props) => {
    render(<DoorbellWidget {...baseProps} accessory={camera()} {...props} />);
    expect(request).not.toHaveBeenCalled();
  });

  it('does not poll doorbells without home opt-in', () => {
    camerasEnabled = false;
    render(<DoorbellWidget {...baseProps} accessory={camera()} expanded />);
    expect(request).not.toHaveBeenCalled();
  });

  it('does not poll doorbells in Community mode', () => {
    community = true;
    render(<DoorbellWidget {...baseProps} accessory={camera()} expanded />);
    expect(request).not.toHaveBeenCalled();
  });
  it('asks the relay for a still when expanded and shows it', async () => {
    request.mockResolvedValue({
      accessoryId: 'CAM-1', mimeType: 'image/jpeg', jpeg: 'QUJD', capturedAt: new Date().toISOString(),
      width: 1280, height: 720, cached: false,
    });
    render(<CameraWidget {...baseProps} accessory={camera()} expanded />);
    await waitFor(() => expect(request).toHaveBeenCalledWith('camera.snapshot', expect.objectContaining({ accessoryId: 'CAM-1', homeId: 'HOME-1' })));
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

  it('explains failed capture without claiming macOS permission is missing, and stops asking', async () => {
    request.mockRejectedValue({ code: 'SCREEN_RECORDING_DENIED', message: 'denied' });
    render(<CameraWidget {...baseProps} accessory={camera()} expanded />);
    expect(await screen.findByText(/Restart Homecast/)).toBeTruthy();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('camera controls', () => {
  const withControl = (type: string, value: unknown) => camera({
    services: [{ id: 's', name: 'Mode', serviceType: 'camera_operating_mode', characteristics: [
      { id: 'c', characteristicType: type, value, isReadable: true, isWritable: true },
    ] }],
  });

  it.each(['active', '00000225-0000-1000-8000-0026BB765291', 'periodic_snapshots_active'])('never treats %s as camera power', (type) => {
    render(<CameraWidget {...baseProps} accessory={withControl(type, 0)} />);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByText('Off')).toBeNull();
    expect(screen.getByText('Camera')).toBeTruthy();
  });

  it.each([undefined, null, ''])('does not turn an unknown active value (%s) into Off', (value) => {
    render(<CameraWidget {...baseProps} accessory={withControl('homekit_camera_active', value)} />);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByText('Off')).toBeNull();
  });

  it.each(['homekit_camera_active', '0000021D-0000-1000-8000-0026BB765291'])('uses the actual camera characteristic and passes its CURRENT value: %s', (type) => {
    render(<CameraWidget {...baseProps} accessory={withControl(type, true)} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(baseProps.onToggle).toHaveBeenCalledWith('CAM-1', type, true);
  });

  it('still displays an explicitly disabled camera as Off', () => {
    render(<CameraWidget {...baseProps} accessory={withControl('homekit_camera_active', false)} />);
    expect(screen.getByText('Off')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch'));
    expect(baseProps.onToggle).toHaveBeenCalledWith('CAM-1', 'homekit_camera_active', false);
  });
});
