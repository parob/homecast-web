// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { CameraWidget } from '../CameraWidget';
import { DoorbellWidget } from '../DoorbellWidget';
import { AccessoryWidget } from '../AccessoryWidget';
import { useState } from 'react';
import type { HomeKitAccessory } from '@/lib/graphql/types';
import { clearCameraSnapshots, setCameraSnapshotAccount } from '@/lib/camera-snapshot-cache';

// jsdom has no matchMedia; the mobile hook asks for it at render.
window.matchMedia = window.matchMedia || (((query: string) => ({
  matches: false, media: query, onchange: null,
  addListener: () => {}, removeListener: () => {},
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia);
globalThis.ResizeObserver = class {
  observe() {} unobserve() {} disconnect() {}
} as unknown as typeof ResizeObserver;
// Start tiles offscreen. Tests explicitly reveal them when checking preview
// polling, independently of opening the full-size viewer.
const observers = new Set<(entries: { isIntersecting: boolean }[]) => void>();
globalThis.IntersectionObserver = class {
  constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) { observers.add(callback); }
  observe() {} unobserve() {}
  disconnect() { observers.delete(this.callback); }
} as unknown as typeof IntersectionObserver;
const revealTiles = () => act(() => observers.forEach(callback => callback([{ isIntersecting: true }])));

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
  clearCameraSnapshots();
  setCameraSnapshotAccount('test-account');
  observers.clear();
  request.mockReset();
  baseProps.onToggle.mockClear();
  community = false;
  camerasEnabled = true;
});

describe('CameraWidget hero', () => {
  it.each([CameraWidget, DoorbellWidget])('opens snapshots when the full-size layout supplies no expansion wrapper', async (Component) => {
    request.mockResolvedValue({ jpeg: 'QUJD', mimeType: 'image/jpeg', capturedAt: new Date().toISOString(), width: 720, height: 1280 });
    const entryCamera = camera({ name: 'Entry Camera' });
    entryCamera.services = entryCamera.services.map(service => ({ ...service, name: entryCamera.name }));
    render(<Component {...baseProps} accessory={entryCamera} compact={false} />);
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Entry Camera'));
    expect(await screen.findByAltText('Entry Camera snapshot')).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(1);
    // The full-size tile now opens the same floating viewer as a compact one.
    // A visible close control works without reaching the original tile.
    fireEvent.click(screen.getByRole('button', { name: 'Close camera' }));
    await waitFor(() => expect(screen.queryByAltText('Entry Camera snapshot')).toBeNull());
  });

  it.each([
    ['Front Door', ['microphone', 'motion_sensor', 'doorbell', 'battery']],
    ['Doorbell Camera', ['doorbell', 'camera_operating_mode', 'speaker', 'motion_sensor']],
    ['Apartment Front Door', ['motion_sensor', 'camera_operating_mode', 'speaker', 'doorbell']],
  ] as const)('opens the camera from the actual %s doorbell tile', async (name, services) => {
    request.mockResolvedValue({ jpeg: 'QUJD', mimeType: 'image/jpeg', capturedAt: new Date().toISOString(), width: 720, height: 1280 });
    const accessory = camera({ name, category: '', services: services.map((serviceType, i) => ({
      id: `service-${i}`, name: serviceType === 'motion_sensor' ? 'Motion' : name, serviceType, characteristics: [],
    })) });
    // The dashboard owns compact expansion. Exercise the selector and card
    // click, not just an already-expanded DoorbellWidget in isolation.
    function Tile() {
      const [expanded, setExpanded] = useState(false);
      return <div onClick={() => setExpanded(true)}>
        <AccessoryWidget {...baseProps} accessory={accessory} compact={!expanded} expanded={expanded} />
      </div>;
    }
    render(<Tile />);
    expect(screen.getByText('Doorbell camera')).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(name));
    expect(await screen.findByAltText(`${name} snapshot`)).toBeTruthy();
    expect(request).toHaveBeenCalledWith('camera.snapshot', expect.objectContaining({ accessoryId: 'CAM-1', homeId: 'HOME-1' }));
  });

  it('still labels an audio-only doorbell as Doorbell', () => {
    render(<DoorbellWidget {...baseProps} accessory={camera({ camera: undefined })} />);
    expect(screen.getByText('Doorbell')).toBeTruthy();
    expect(screen.queryByText('Doorbell camera')).toBeNull();
  });

  it('shows snapshots on an expanded video doorbell too', async () => {
    request.mockResolvedValue({ jpeg: 'QUJD', mimeType: 'image/jpeg', capturedAt: new Date().toISOString(), width: 720, height: 1280 });
    render(<DoorbellWidget {...baseProps} accessory={camera({ name: 'Front Door', category: '' })} expanded />);
    expect(await screen.findByAltText('Front Door snapshot')).toBeTruthy();
    expect(request).toHaveBeenCalledWith('camera.snapshot', expect.objectContaining({ accessoryId: 'CAM-1', homeId: 'HOME-1' }));
  });

  it.each([{ expanded: false }, { expanded: true, compact: true }])('does not poll an offscreen collapsed or compact doorbell (%j)', (props) => {
    render(<DoorbellWidget {...baseProps} accessory={camera()} {...props} />);
    expect(request).not.toHaveBeenCalled();
  });

  it('does not poll doorbells without home opt-in', () => {
    camerasEnabled = false;
    render(<DoorbellWidget {...baseProps} accessory={camera()} expanded />);
    expect(request).not.toHaveBeenCalled();
  });

  it.each([CameraWidget, DoorbellWidget])('keeps inline previews closed when camera images are disabled', (Component) => {
    camerasEnabled = false;
    render(<Component {...baseProps} accessory={camera()} compact={false} />);
    fireEvent.click(screen.getByRole('heading', { name: 'Camera' }));
    expect(request).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Refresh snapshot')).toBeNull();
  });

  it.each([CameraWidget, DoorbellWidget])('does not open inline previews while arranging tiles', (Component) => {
    render(<Component {...baseProps} accessory={camera()} compact={false} editMode />);
    fireEvent.click(screen.getByRole('heading', { name: 'Camera' }));
    expect(request).not.toHaveBeenCalled();
  });

  it('leaves externally controlled expansion to its owner', () => {
    const onExpandToggle = vi.fn();
    render(<DoorbellWidget {...baseProps} accessory={camera()} compact={false} expanded={false} onExpandToggle={onExpandToggle} />);
    fireEvent.click(screen.getByRole('heading', { name: 'Camera' }));
    expect(onExpandToggle).toHaveBeenCalledOnce();
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
    expect(screen.getByText(/Requested just now/)).toBeTruthy();
    expect(screen.getByText(/HomeKit may return an older image/)).toBeTruthy();
  });

  it('labels a stream-backed still with the actual capture time', async () => {
    request.mockResolvedValue({ jpeg: 'QUJD', capturedAt: new Date().toISOString(), width: 1280, height: 720, source: 'stream' });
    render(<CameraWidget {...baseProps} accessory={camera()} expanded />);
    expect(await screen.findByText(/Captured just now/)).toBeTruthy();
    expect(screen.queryByText(/HomeKit may return an older image/)).toBeNull();
  });

  it('preserves portrait dimensions and does not force a doorbell into a 16:9 box', async () => {
    request.mockResolvedValue({ jpeg: 'QUJD', capturedAt: new Date().toISOString(), width: 320, height: 439, source: 'stream' });
    render(<DoorbellWidget {...baseProps} accessory={camera({ name: 'Front Door' })} expanded />);
    const img = await screen.findByAltText('Front Door snapshot');
    expect(img.getAttribute('width')).toBe('320');
    expect(img.getAttribute('height')).toBe('439');
    expect(img.className).toContain('object-contain');
    expect(img.closest('.aspect-video')).toBeNull();
  });

  it('does not ask while a collapsed tile is offscreen', () => {
    render(<CameraWidget {...baseProps} accessory={camera()} />);
    expect(request).not.toHaveBeenCalled();
  });

  it.each([CameraWidget, DoorbellWidget])('shows a full-bleed still only after the tile becomes visible', async (Component) => {
    request.mockResolvedValue({ jpeg: 'QUJD', capturedAt: new Date().toISOString(), width: 320, height: 439, source: 'stream' });
    const { container } = render(<Component {...baseProps} accessory={camera()} compact />);
    expect(request).not.toHaveBeenCalled();
    revealTiles();
    await waitFor(() => expect(container.querySelector('[data-camera-tile-preview] img')).not.toBeNull());
    expect(request).toHaveBeenCalledWith('camera.snapshot', expect.objectContaining({ maxWidth: 480, maxAgeSec: 55 }));
    const image = container.querySelector('[data-camera-tile-preview] img') as HTMLImageElement;
    expect(image.className).toContain('object-cover');
    expect(image.style.objectPosition).toBe('center 23%');
    expect(screen.getByLabelText('Snapshot captured just now')).toBeTruthy();
    expect(screen.queryByLabelText('Refresh snapshot')).toBeNull();
  });

  it.each([{ editMode: true }, { editModeType: 'ui' as const }, { isHidden: true }, { isHiddenUi: true }])('does not wake a visible camera while editing or revealed as hidden (%j)', (props) => {
    render(<CameraWidget {...baseProps} accessory={camera()} compact {...props} />);
    revealTiles();
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

  it.each([CameraWidget, DoorbellWidget])('never offers a power switch or On/Off status on a collapsed camera tile', (Component) => {
    for (const compact of [true, false]) {
      for (const value of [true, false]) {
        const { unmount } = render(<Component {...baseProps} accessory={withControl('homekit_camera_active', value)} compact={compact} />);
        expect(screen.queryByRole('switch')).toBeNull();
        expect(screen.queryByText(/^(On|Off)$/)).toBeNull();
        expect(baseProps.onToggle).not.toHaveBeenCalled();
        unmount();
      }
    }
  });

  it.each([
    ['homekit_camera_active', 'HomeKit camera access'],
    ['0000021D-0000-1000-8000-0026BB765291', 'HomeKit camera access'],
    ['camera_operating_mode_indicator', 'Status light'],
    ['0000021B-0000-1000-8000-0026BB765291', 'Status light'],
  ])('labels %s explicitly in the opened controls only', (type, label) => {
    camerasEnabled = false;
    render(<CameraWidget {...baseProps} accessory={withControl(type, true)} expanded />);
    fireEvent.click(screen.getByRole('switch', { name: label }));
    expect(baseProps.onToggle).toHaveBeenCalledWith('CAM-1', type, true);
    expect(screen.queryByText(/^(On|Off)$/)).toBeNull();
  });

  it('keeps doorbell status light and HomeKit access controls distinct', () => {
    camerasEnabled = false;
    const accessory = withControl('camera_operating_mode_indicator', false);
    accessory.services[0].characteristics.push({ id: 'access', characteristicType: 'homekit_camera_active', value: true, isReadable: true, isWritable: true });
    render(<DoorbellWidget {...baseProps} accessory={accessory} expanded />);
    fireEvent.click(screen.getByRole('switch', { name: 'Status light' }));
    expect(baseProps.onToggle).toHaveBeenLastCalledWith('CAM-1', 'camera_operating_mode_indicator', false);
    fireEvent.click(screen.getByRole('switch', { name: 'HomeKit camera access' }));
    expect(baseProps.onToggle).toHaveBeenLastCalledWith('CAM-1', 'homekit_camera_active', true);
  });

  it.each([undefined, null, ''])('does not guess an unknown status-light setting (%s)', (value) => {
    camerasEnabled = false;
    render(<CameraWidget {...baseProps} accessory={withControl('camera_operating_mode_indicator', value)} expanded />);
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('does not offer writes for a read-only mode or unreachable camera', () => {
    camerasEnabled = false;
    const { unmount } = render(<CameraWidget {...baseProps} accessory={camera()} expanded />);
    expect(screen.queryByRole('switch')).toBeNull();
    unmount();
    render(<CameraWidget {...baseProps} accessory={{ ...withControl('camera_operating_mode_indicator', false), isReachable: false }} expanded />);
    expect(screen.getByRole('switch', { name: 'Status light' }).hasAttribute('disabled')).toBe(true);
  });
});
