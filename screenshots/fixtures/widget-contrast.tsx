import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BackgroundImage } from '../../src/components/BackgroundImage';
import { BackgroundContext } from '../../src/contexts/BackgroundContext';
import { WidgetWrapper } from '../../src/components/widgets/WidgetWrapper';
import { useBackgroundDarkness } from '../../src/hooks/useBackgroundDarkness';
import { PRESET_SOLID_COLORS, PRESET_GRADIENTS, PRESET_IMAGES } from '../../src/lib/colorUtils';
import '../../src/index.css';

// Identical painted pixels through all three production analysis paths.
PRESET_SOLID_COLORS['solid-test-mid'] = '#bbbbbb';
PRESET_GRADIENTS['gradient-test-mid'] = 'linear-gradient(#bbbbbb, #bbbbbb)';
PRESET_IMAGES['image-test-mid'] = '/screenshots/fixtures/flat-mid.svg';
const query = new URLSearchParams(location.search);
const presetId = query.get('preset') ?? 'solid-test-mid';
const settings = { type: 'preset' as const, presetId, brightness: Number(query.get('brightness') ?? 50), blur: 0 };

function Fixture() {
  const [wallpaperImage, setWallpaperImage] = useState<HTMLImageElement | null>(null);
  const [imageLuminance, setImageLuminance] = useState<number | null>(null);
  const background = useBackgroundDarkness(settings, imageLuminance);
  return (
    <BackgroundContext.Provider value={{ ...background, wallpaperImage, wallpaperBrightness: settings.brightness }}>
      <main style={{ minHeight: query.has('scroll') ? '200vh' : '100vh', padding: 24 }} data-luminance={background.luminance}>
        <BackgroundImage settings={settings} onVisibleImageChange={setWallpaperImage} onLuminanceChange={setImageLuminance} />
        <div className="relative space-y-4" style={{ maxWidth: 360, marginTop: query.has('scroll') ? innerHeight * 0.6 : 0 }}>
          {[{ label: 'Off', isOn: false }, { label: 'Dimmed', isOn: true, intensity: 0 }, { label: 'On', isOn: true, intensity: 1 }].map(tile => (
            <div key={tile.label} data-tile={tile.label}>
              <WidgetWrapper {...tile}>
                <div className="p-5 text-foreground">
                  <h3 className="text-base font-medium">Living room light</h3>
                  <p className="text-sm text-muted-foreground">{tile.label}</p>
                </div>
              </WidgetWrapper>
            </div>
          ))}
        </div>
      </main>
    </BackgroundContext.Provider>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
