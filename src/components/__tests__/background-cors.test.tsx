// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackgroundImage } from '../BackgroundImage';

vi.mock('@/lib/config', () => ({ config: { apiUrl: 'https://api.example.com' } }));
vi.mock('@/lib/colorUtils', () => ({
  PRESET_SOLID_COLORS: {}, PRESET_GRADIENTS: {}, PRESET_IMAGES: {},
  getAutoPresetId: () => '',
  analyzeLoadedImage: () => 0.5,
  analyzeLoadedImageBand: () => 0.5,
  getImageTopColor: () => '#888888',
}));

afterEach(cleanup);

describe('wallpaper when the host refuses pixel sampling', () => {
  it('retries for display and shows the wallpaper after a CORS failure', async () => {
    const onReady = vi.fn();
    const { container } = render(<BackgroundImage settings={{ type: 'custom', customUrl: 'https://images.example.com/room.jpg' }} onReady={onReady} />);
    const first = container.querySelector('img')!;
    expect(first.getAttribute('crossorigin')).toBe('anonymous');
    fireEvent.error(first);
    const fallback = container.querySelector('img')!;
    expect(fallback).not.toBe(first);
    expect(fallback.hasAttribute('crossorigin')).toBe(false);
    fireEvent.load(fallback);
    await waitFor(() => expect(fallback.parentElement?.className).toContain('opacity-100'));
    expect(onReady).toHaveBeenCalled();
  });

  it('stops retrying if the image also fails without sampling', async () => {
    const onReady = vi.fn();
    const { container } = render(<BackgroundImage settings={{ type: 'custom', customUrl: 'https://images.example.com/missing.jpg' }} onReady={onReady} />);
    fireEvent.error(container.querySelector('img')!);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    await waitFor(() => expect(onReady).toHaveBeenCalled());
  });
});
