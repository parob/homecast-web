import { useMemo, useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { PRESET_SOLID_COLORS, PRESET_GRADIENTS, PRESET_IMAGES, getAutoPresetId, analyzeLoadedImage, getImageTopColor } from '@/lib/colorUtils';
import type { BackgroundSettings } from '@/lib/graphql/types';

import { config } from '@/lib/config';

const API_URL = config.apiUrl;

// Simple in-memory image cache to prevent repeated network requests
const imageCache = new Map<string, HTMLImageElement>();

function preloadImage(url: string): Promise<HTMLImageElement> {
  // Check if already cached
  const cached = imageCache.get(url);
  if (cached) {
    return Promise.resolve(cached);
  }

  // Load and cache
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      imageCache.set(url, img);
      resolve(img);
    };
    img.onerror = reject;
    img.src = url;
  });
}

function isImageCached(url: string): boolean {
  return imageCache.has(url);
}

// Ensure URL is absolute (handles relative paths from API)
function toAbsoluteUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('http')) return url;
  return `${API_URL}${url}`;
}

interface BackgroundImageProps {
  settings?: BackgroundSettings | null;
  className?: string;
  entityId?: string;
  autoBackgroundsEnabled?: boolean;
  onReady?: () => void;
  /** Reports image luminance when the visible background changes. null for solid/gradient/none (handled synchronously by useBackgroundDarkness). */
  onLuminanceChange?: (luminance: number | null) => void;
  /** Reports average color of the top row of the loaded image (hex string). null for non-image backgrounds. */
  onTopColorChange?: (color: string | null) => void;
}

// Get a unique key for background image/gradient (excludes brightness/blur since those don't need crossfade)
function getBackgroundKey(settings?: BackgroundSettings | null): string {
  if (!settings || settings.type === 'none') return 'none';
  if (settings.type === 'preset' && settings.presetId) return `preset:${settings.presetId}`;
  if (settings.type === 'custom' && settings.customUrl) return `custom:${settings.customUrl}`;
  return 'none';
}

/**
 * Renders a blurred background image with configurable blur and brightness effects.
 * Supports preset gradients/images and custom uploaded images.
 * Brightness: 50 = no change, <50 = darker, >50 = brighter
 * Uses crossfade technique to smoothly transition between backgrounds.
 */
export function BackgroundImage({ settings, className, entityId, autoBackgroundsEnabled, onReady, onLuminanceChange, onTopColorChange }: BackgroundImageProps) {
  // Compute effective settings: explicit > auto > none
  // solid-white is special: it means "no background" and overrides auto-backgrounds
  const effectiveSettings = useMemo((): BackgroundSettings | null => {
    // If explicit background is set (preset or custom), use it
    if (settings && (settings.type === 'preset' || settings.type === 'custom')) {
      // solid-white means "no background" - return null to skip rendering
      if (settings.presetId === 'solid-white') {
        return null;
      }
      return settings;
    }
    // If auto backgrounds enabled and we have an entity ID, generate auto preset
    if (autoBackgroundsEnabled && entityId) {
      const autoPresetId = getAutoPresetId(entityId);
      return {
        type: 'preset',
        presetId: autoPresetId,
        blur: 10,
        brightness: 50,
      };
    }
    // No background
    return settings || null;
  }, [settings, autoBackgroundsEnabled, entityId]);

  // Track current and previous backgrounds for crossfade
  const [currentBg, setCurrentBg] = useState<BackgroundSettings | null>(effectiveSettings || null);
  const [prevBg, setPrevBg] = useState<BackgroundSettings | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [newBgReady, setNewBgReady] = useState(true);
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const fallbackTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const onReadyCalledRef = useRef(false);

  // Track luminance and top color from the current image layer
  const pendingLuminanceRef = useRef<number | null>(null);
  const pendingTopColorRef = useRef<string | null>(null);

  // Helper to call onReady only once per background change
  const callOnReady = () => {
    if (!onReadyCalledRef.current) {
      onReadyCalledRef.current = true;
      onReady?.();
    }
  };

  // On initial mount, if there's no background or it's a solid/gradient, call onReady immediately
  useEffect(() => {
    const isSolid = effectiveSettings?.presetId?.startsWith('solid-');
    const isGradient = effectiveSettings?.presetId?.startsWith('gradient-');
    if (!effectiveSettings || effectiveSettings.type === 'none' || isSolid || isGradient) {
      callOnReady();
      onLuminanceChange?.(null);
      onTopColorChange?.(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect when settings change
  const currentKey = getBackgroundKey(effectiveSettings);
  const activeKey = getBackgroundKey(currentBg);

  useEffect(() => {
    if (currentKey !== activeKey) {
      // Clear any pending timeouts
      if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
      if (fallbackTimeoutRef.current) clearTimeout(fallbackTimeoutRef.current);

      // Reset onReady flag for new background
      onReadyCalledRef.current = false;
      pendingLuminanceRef.current = null;
      pendingTopColorRef.current = null;

      // Settings changed - start crossfade
      const isSolid = effectiveSettings?.presetId?.startsWith('solid-');
      const isGradient = effectiveSettings?.presetId?.startsWith('gradient-');

      // For gradients and solid colors, transition immediately (no loading needed)
      if (isSolid || isGradient || !effectiveSettings || effectiveSettings.type === 'none') {
        setPrevBg(currentBg);
        setCurrentBg(effectiveSettings || null);
        setIsTransitioning(true);
        setNewBgReady(true);

        // For solid colors, gradients, and no background - ready immediately
        callOnReady();
        // Report null — solids/gradients are computed synchronously by useBackgroundDarkness / getDominantColor
        onLuminanceChange?.(null);
        onTopColorChange?.(null);

        // Clear previous after transition
        transitionTimeoutRef.current = setTimeout(() => {
          setPrevBg(null);
          setIsTransitioning(false);
        }, 500);
      } else {
        // For images, wait for load (with fallback timeout)
        setPrevBg(currentBg);
        setCurrentBg(effectiveSettings);
        setIsTransitioning(true);
        setNewBgReady(false);

        // Fallback: show image after 2 seconds even if onLoad hasn't fired
        fallbackTimeoutRef.current = setTimeout(() => {
          setNewBgReady(true);
          callOnReady();
          // Report whatever we have (may be null if image never loaded)
          onLuminanceChange?.(pendingLuminanceRef.current);
          onTopColorChange?.(pendingTopColorRef.current);
          transitionTimeoutRef.current = setTimeout(() => {
            setPrevBg(null);
            setIsTransitioning(false);
          }, 500);
        }, 2000);
      }
    }

    return () => {
      if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
      if (fallbackTimeoutRef.current) clearTimeout(fallbackTimeoutRef.current);
    };
  }, [currentKey, activeKey, effectiveSettings, currentBg]); // eslint-disable-line react-hooks/exhaustive-deps

  // Called by ImageBackground when it has analyzed the loaded image
  const handleImageLuminance = (luminance: number) => {
    pendingLuminanceRef.current = luminance;
  };

  const handleImageTopColor = (color: string) => {
    pendingTopColorRef.current = color;
  };

  // When new image is ready, complete the transition
  const handleNewBgReady = () => {
    // Clear fallback timeout since image loaded successfully
    if (fallbackTimeoutRef.current) clearTimeout(fallbackTimeoutRef.current);
    setNewBgReady(true);
    callOnReady();
    // Report luminance and top color now that the image is visible
    onLuminanceChange?.(pendingLuminanceRef.current);
    onTopColorChange?.(pendingTopColorRef.current);
    transitionTimeoutRef.current = setTimeout(() => {
      setPrevBg(null);
      setIsTransitioning(false);
    }, 500);
  };

  return (
    <div
      className={cn(
        'fixed inset-0 overflow-hidden pointer-events-none',
        className
      )}
      aria-hidden="true"
    >
      {/* Previous background (fades out) */}
      {prevBg && prevBg.type !== 'none' && (
        <BackgroundLayer
          settings={prevBg}
          brightness={effectiveSettings?.brightness ?? 50}
          blur={effectiveSettings?.blur ?? 20}
          opacity={isTransitioning && newBgReady ? 0 : 1}
        />
      )}

      {/* Current background (fades in) */}
      {currentBg && currentBg.type !== 'none' && (
        <BackgroundLayer
          settings={currentBg}
          brightness={effectiveSettings?.brightness ?? 50}
          blur={effectiveSettings?.blur ?? 20}
          opacity={!isTransitioning || newBgReady ? 1 : 0}
          onImageLoad={handleNewBgReady}
          onImageLuminance={handleImageLuminance}
          onImageTopColor={handleImageTopColor}
        />
      )}
    </div>
  );
}

interface BackgroundLayerProps {
  settings: BackgroundSettings;
  brightness: number;
  blur: number;
  opacity: number;
  onImageLoad?: () => void;
  onImageLuminance?: (luminance: number) => void;
  onImageTopColor?: (color: string) => void;
}

function BackgroundLayer({ settings, brightness, blur, opacity, onImageLoad, onImageLuminance, onImageTopColor }: BackgroundLayerProps) {
  const isSolid = settings.type === 'preset' && settings.presetId?.startsWith('solid-');
  const isGradient = settings.type === 'preset' && settings.presetId?.startsWith('gradient-');

  return (
    <div
      className="absolute inset-0 transition-opacity duration-500"
      style={{ opacity }}
    >
      {isSolid ? (
        <SolidBackground
          presetId={settings.presetId!}
          brightness={brightness}
        />
      ) : isGradient ? (
        <GradientBackground
          presetId={settings.presetId!}
          blur={blur}
          brightness={brightness}
        />
      ) : (
        <ImageBackground
          url={settings.type === 'custom' ? settings.customUrl : undefined}
          presetId={settings.type === 'preset' ? settings.presetId : undefined}
          blur={blur}
          brightness={brightness}
          onLoad={onImageLoad}
          onLuminanceReady={onImageLuminance}
          onTopColorReady={onImageTopColor}
        />
      )}
    </div>
  );
}

interface SolidBackgroundProps {
  presetId: string;
  brightness: number;
}

function SolidBackground({ presetId, brightness }: SolidBackgroundProps) {
  const color = PRESET_SOLID_COLORS[presetId] || PRESET_SOLID_COLORS['solid-white'];

  return (
    <>
      {/* Solid color background */}
      <div
        className="absolute inset-0 transition-all duration-500"
        style={{
          backgroundColor: color,
        }}
      />
      {/* Brightness overlay - darken when <50, brighten when >50 */}
      <div
        className={`absolute inset-0 transition-opacity duration-300 ${brightness < 50 ? 'bg-black' : 'bg-white'}`}
        style={{ opacity: brightness === 50 ? 0 : Math.abs(brightness - 50) / 50 }}
      />
    </>
  );
}

interface GradientBackgroundProps {
  presetId: string;
  blur: number;
  brightness: number;
}

function GradientBackground({ presetId, blur, brightness }: GradientBackgroundProps) {
  const gradient = PRESET_GRADIENTS[presetId] || PRESET_GRADIENTS['gradient-blue'];

  return (
    <>
      {/* Gradient background */}
      <div
        className="absolute inset-0 transition-all duration-500"
        style={{
          background: gradient,
          filter: blur > 0 ? `blur(${blur}px)` : undefined,
          // Scale up slightly to hide blur edge artifacts
          transform: blur > 0 ? 'scale(1.1)' : undefined,
        }}
      />
      {/* Brightness overlay - darken when <50, brighten when >50 */}
      <div
        className={`absolute inset-0 transition-opacity duration-300 ${brightness < 50 ? 'bg-black' : 'bg-white'}`}
        style={{ opacity: brightness === 50 ? 0 : Math.abs(brightness - 50) / 50 }}
      />
    </>
  );
}

interface ImageBackgroundProps {
  url?: string;
  presetId?: string;
  blur: number;
  brightness: number;
  onLoad?: () => void;
  onLuminanceReady?: (luminance: number) => void;
  onTopColorReady?: (color: string) => void;
}

function ImageBackground({
  url,
  presetId,
  blur,
  brightness,
  onLoad,
  onLuminanceReady,
  onTopColorReady,
}: ImageBackgroundProps) {
  // Determine the image URL (ensure custom URLs are absolute)
  const imageUrl = toAbsoluteUrl(url) || (presetId ? PRESET_IMAGES[presetId] : null);

  // Check if image is already cached - if so, mark as loaded immediately
  const isCached = imageUrl ? isImageCached(imageUrl) : false;
  const [isLoaded, setIsLoaded] = useState(isCached);
  const [hasError, setHasError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const onLoadCalledRef = useRef(false);

  // Reset loaded state when URL changes (but check cache first)
  const urlKey = imageUrl || '';
  useEffect(() => {
    onLoadCalledRef.current = false;
    if (imageUrl) {
      const cached = isImageCached(imageUrl);
      setIsLoaded(cached);
      setHasError(false);

      // If cached, notify parent immediately
      if (cached && !onLoadCalledRef.current) {
        onLoadCalledRef.current = true;
        // Analyze luminance from cached image
        const cachedImg = imageCache.get(imageUrl);
        if (cachedImg) {
          onLuminanceReady?.(analyzeLoadedImage(cachedImg));
          onTopColorReady?.(getImageTopColor(cachedImg));
        }
        onLoad?.();
      }
    } else {
      setIsLoaded(false);
      setHasError(false);
    }
  }, [urlKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Check if image is already complete (loaded before onLoad attached)
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current?.naturalHeight > 0 && !onLoadCalledRef.current) {
      onLoadCalledRef.current = true;
      if (imageUrl) {
        preloadImage(imageUrl).catch(() => {});
      }
      setIsLoaded(true);
      onLuminanceReady?.(analyzeLoadedImage(imgRef.current));
      onTopColorReady?.(getImageTopColor(imgRef.current));
      onLoad?.();
    }
  });

  // Call onLoad if there's no valid URL (so parent doesn't wait forever)
  useEffect(() => {
    if ((!imageUrl || hasError) && !onLoadCalledRef.current) {
      onLoadCalledRef.current = true;
      onLoad?.();
    }
  }, [imageUrl, hasError, onLoad]);

  // Retry loading when network comes back online
  useEffect(() => {
    if (!hasError) return;
    const retry = () => {
      onLoadCalledRef.current = false;
      setHasError(false);
    };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [hasError]);

  const handleLoad = () => {
    if (onLoadCalledRef.current) return; // Prevent double-calling
    onLoadCalledRef.current = true;
    // Cache the image URL on successful load
    if (imageUrl) {
      preloadImage(imageUrl).catch(() => {});
    }
    setIsLoaded(true);
    // Analyze luminance and top color from the loaded image element
    if (imgRef.current) {
      onLuminanceReady?.(analyzeLoadedImage(imgRef.current));
      onTopColorReady?.(getImageTopColor(imgRef.current));
    }
    onLoad?.();
  };

  if (!imageUrl || hasError) {
    return null;
  }

  return (
    <>
      {/* Image background */}
      <div
        className={cn(
          'absolute inset-0 transition-opacity duration-300',
          isLoaded ? 'opacity-100' : 'opacity-0'
        )}
        style={{
          filter: blur > 0 ? `blur(${blur}px)` : undefined,
          // Scale up slightly to hide blur edge artifacts
          transform: blur > 0 ? 'scale(1.1)' : undefined,
        }}
      >
        <img
          ref={imgRef}
          src={imageUrl}
          alt=""
          crossOrigin="anonymous"
          className="w-full h-full object-cover"
          onLoad={handleLoad}
          onError={() => setHasError(true)}
        />
      </div>
      {/* Brightness overlay - darken when <50, brighten when >50 */}
      <div
        className={`absolute inset-0 transition-opacity duration-300 ${brightness < 50 ? 'bg-black' : 'bg-white'}`}
        style={{ opacity: isLoaded && brightness !== 50 ? Math.abs(brightness - 50) / 50 : 0 }}
      />
    </>
  );
}

export default BackgroundImage;
