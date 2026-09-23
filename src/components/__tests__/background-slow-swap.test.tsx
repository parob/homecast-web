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
  getImageTopColor: () => '#888888',
  getImageEdgeColor: () => '#888888',
}));

afterEach(() => { cleanup(); vi.useRealTimers(); });

const background = (name: string) => ({
  type: 'custom' as const, customUrl: `https://images.example.com/${name}.jpg`, blur: 7, brightness: 50,
});

/** The BackgroundLayer box, whose inline opacity drives the crossfade. */
const layerOf = (img: HTMLImageElement) => img.parentElement!.parentElement!;

describe('a wallpaper that is slow rather than broken', () => {
  it('holds the outgoing wallpaper past the loading deadline instead of blanking', () => {
    vi.useFakeTimers();
    const home = background('home');
    const { container, rerender } = render(<BackgroundImage settings={home} />);
    const outgoing = container.querySelector('img')!;
    fireEvent.load(outgoing);

    rerender(<BackgroundImage settings={background('slow')} />);
    // The incoming image never loads — a slow link, not a failure.
    act(() => { vi.advanceTimersByTime(2_500); });

    const stillThere = container.querySelector<HTMLImageElement>(`img[src="${home.customUrl}"]`);
    expect(stillThere).not.toBeNull();
    expect(stillThere!.parentElement?.className).toContain('opacity-100');
    expect(layerOf(stillThere!).style.opacity).toBe('1');
  });

  it('still reports readiness at the deadline, so nothing upstream waits on a slow image', () => {
    vi.useFakeTimers();
    const onReady = vi.fn();
    const { container, rerender } = render(<BackgroundImage settings={background('home')} onReady={onReady} />);
    fireEvent.load(container.querySelector('img')!);
    onReady.mockClear();

    rerender(<BackgroundImage settings={background('slow')} onReady={onReady} />);
    expect(onReady).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(2_500); });
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('does not report a null measurement for a wallpaper that is still on screen', () => {
    vi.useFakeTimers();
    const onLuminanceChange = vi.fn();
    const onTopColorChange = vi.fn();
    const onVisibleImageChange = vi.fn();
    const props = { onLuminanceChange, onTopColorChange, onVisibleImageChange };
    const { container, rerender } = render(<BackgroundImage settings={background('home')} {...props} />);
    fireEvent.load(container.querySelector('img')!);
    onLuminanceChange.mockClear();
    onTopColorChange.mockClear();
    expect(onVisibleImageChange).toHaveBeenCalledWith(container.querySelector("img"));
    onVisibleImageChange.mockClear();

    rerender(<BackgroundImage settings={background('slow')} {...props} />);
    act(() => { vi.advanceTimersByTime(2_500); });

    // The old wallpaper is what is painted; its measurement must stand.
    expect(onLuminanceChange).not.toHaveBeenCalled();
    expect(onTopColorChange).not.toHaveBeenCalled();
    expect(onVisibleImageChange).not.toHaveBeenCalled();
  });

  it('completes the crossfade when the slow image finally arrives', () => {
    vi.useFakeTimers();
    const onLuminanceChange = vi.fn();
    const slow = background('slow');
    const { container, rerender } = render(<BackgroundImage settings={background('home')} onLuminanceChange={onLuminanceChange} />);
    fireEvent.load(container.querySelector('img')!);
    rerender(<BackgroundImage settings={slow} onLuminanceChange={onLuminanceChange} />);
    act(() => { vi.advanceTimersByTime(2_500); });
    onLuminanceChange.mockClear();

    const incoming = container.querySelector<HTMLImageElement>(`img[src="${slow.customUrl}"]`)!;
    fireEvent.load(incoming);

    expect(incoming.parentElement?.className).toContain('opacity-100');
    expect(layerOf(incoming).style.opacity).toBe('1');
    expect(onLuminanceChange).toHaveBeenCalledWith(0.5);
    // ...and the outgoing layer is torn down on the usual 500ms fade.
    act(() => { vi.advanceTimersByTime(600); });
    expect(container.querySelectorAll('img')).toHaveLength(1);
  });

  it('still completes when the image genuinely fails, rather than holding forever', () => {
    vi.useFakeTimers();
    const broken = background('broken');
    const { container, rerender } = render(<BackgroundImage settings={background('home')} />);
    fireEvent.load(container.querySelector('img')!);
    rerender(<BackgroundImage settings={broken} />);

    const incoming = container.querySelector<HTMLImageElement>(`img[src="${broken.customUrl}"]`)!;
    fireEvent.error(incoming);            // drops to display-only
    fireEvent.error(container.querySelector<HTMLImageElement>(`img[src="${broken.customUrl}"]`)!);
    act(() => { vi.advanceTimersByTime(600); });

    expect(container.querySelector(`img[src="${broken.customUrl}"]`)).toBeNull();
  });
});
