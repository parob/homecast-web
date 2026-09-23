// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackgroundImage } from '../BackgroundImage';

vi.mock('@/lib/config', () => ({ config: { apiUrl: 'https://api.example.com' } }));
vi.mock('@/lib/colorUtils', () => ({
  PRESET_SOLID_COLORS: {}, PRESET_GRADIENTS: {}, PRESET_IMAGES: {},
  getAutoPresetId: () => '',
  analyzeLoadedImage: () => 0.5,
  analyzeLoadedImageBand: () => 0.5,
  getImageTopColor: (_image: unknown, _brightness: number, box: { scale: number }) => box.scale === 1 ? '#112233' : '#334455',
  getImageEdgeColor: () => '#888888',
}));

afterEach(() => { cleanup(); vi.useRealTimers(); });

const background = (name: string) => ({
  type: 'custom' as const, customUrl: `https://images.example.com/${name}.jpg`, blur: 7, brightness: 50,
});

describe('wallpaper across room navigation', () => {
  it('keeps the decoded outgoing image on screen while the next one loads', () => {
    const home = background('home');
    const { container, rerender } = render(<BackgroundImage settings={home} />);
    const outgoing = container.querySelector('img')!;
    fireEvent.load(outgoing);
    rerender(<BackgroundImage settings={background('room')} />);

    expect(container.querySelector(`img[src="${home.customUrl}"]`)).toBe(outgoing);
    expect(outgoing.parentElement?.className).toContain('opacity-100');
    expect(outgoing.parentElement?.parentElement?.style.opacity).toBe('1');
  });

  it('remembers a successful display-only load instead of failing CORS again on every visit', () => {
    const settings = background('display-only');
    const first = render(<BackgroundImage settings={settings} />);
    fireEvent.error(first.container.querySelector('img')!);
    fireEvent.load(first.container.querySelector('img')!);
    first.unmount();

    const onReady = vi.fn();
    const second = render(<BackgroundImage settings={settings} onReady={onReady} />);
    const image = second.container.querySelector('img')!;
    expect(image.hasAttribute('crossorigin')).toBe(false);
    // A cached URL does not mean this new DOM image has painted yet.
    expect(onReady).not.toHaveBeenCalled();
    fireEvent.load(image);
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('keeps pixel sampling on a cached image whose host permits it', () => {
    const settings = background('sampleable');
    const first = render(<BackgroundImage settings={settings} />);
    fireEvent.load(first.container.querySelector('img')!);
    first.unmount();
    const onReady = vi.fn();
    const second = render(<BackgroundImage settings={settings} onReady={onReady} />);
    const image = second.container.querySelector('img')!;
    expect(image.crossOrigin).toBe('anonymous');
    expect(onReady).not.toHaveBeenCalled();
    fireEvent.load(image);
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('can return to the outgoing wallpaper before the next image finishes loading', () => {
    const settings = background('quick-return');
    const onReady = vi.fn();
    const { container, rerender } = render(<BackgroundImage settings={settings} onReady={onReady} />);
    const image = container.querySelector('img')!;
    Object.defineProperties(image, { complete: { value: true }, naturalHeight: { value: 100 } });
    fireEvent.load(image);
    rerender(<BackgroundImage settings={background('still-loading')} onReady={onReady} />);
    onReady.mockClear();
    rerender(<BackgroundImage settings={settings} onReady={onReady} />);
    expect(container.querySelector(`img[src="${settings.customUrl}"]`)).toBe(image);
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('updates the edge colour when blur changes the visible crop of a cached image', () => {
    const settings = background('blur-crop');
    const onTopColorChange = vi.fn();
    const { container, rerender } = render(<BackgroundImage settings={settings} onTopColorChange={onTopColorChange} />);
    const image = container.querySelector('img')!;
    Object.defineProperties(image, { complete: { value: true }, naturalHeight: { value: 100 } });
    fireEvent.load(image);
    expect(onTopColorChange).toHaveBeenLastCalledWith('#334455');
    rerender(<BackgroundImage settings={{ ...settings, blur: 0 }} onTopColorChange={onTopColorChange} />);
    // The URL did not change, so another load event will never arrive.
    expect(container.querySelector('img')).toBe(image);
    expect(onTopColorChange).toHaveBeenLastCalledWith('#112233');
  });

  it('retains the loading deadline after starting an image transition', () => {
    vi.useFakeTimers();
    const onReady = vi.fn();
    const { rerender } = render(<BackgroundImage settings={background('deadline-home')} onReady={onReady} />);
    rerender(<BackgroundImage settings={background('deadline-room')} onReady={onReady} />);
    act(() => vi.advanceTimersByTime(2000));
    expect(onReady).toHaveBeenCalledOnce();
  });
});
