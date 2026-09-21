import React from 'react';
import { createRoot } from 'react-dom/client';
import { LockWidget } from '../../src/components/widgets/LockWidget';
import { BackgroundContext } from '../../src/contexts/BackgroundContext';
import '../../src/index.css';

/**
 * The reporter's screen, reduced to the one tile: an unlocked, battery-powered
 * lock expanded over a dark wallpaper (parob/homecast-cloud#167).
 *
 * The real LockWidget, so the `detail` string and the ink rule that has to
 * reach it are the ones production renders. `BackgroundContext` is provided by
 * hand because the wallpaper is what puts the tile in its light-ink tone, and
 * there is no wallpaper to load here.
 */
const char = (type: string, value: string | number, writable = true) => ({
  id: type,
  characteristicType: type,
  value: String(value),
  isReadable: true,
  isWritable: writable,
});

const lock = {
  id: 'acc-aqara-lock',
  homeId: 'ink-home',
  name: 'Aqara Smart Lock U200',
  roomName: 'Front Door',
  isReachable: true,
  services: [
    {
      id: 'svc-lock',
      name: 'Aqara Smart Lock U200',
      serviceType: 'lock_mechanism',
      characteristics: [
        char('lock_current_state', 0, false),
        char('lock_target_state', 0),
      ],
    },
    {
      id: 'svc-battery',
      name: 'Battery',
      serviceType: 'battery',
      characteristics: [
        char('battery_level', 100, false),
        char('status_low_battery', 0, false),
      ],
    },
  ],
};

createRoot(document.getElementById('root')!).render(
  // The wallpaper's own colour, not a token: the tile is glass, and what shows
  // through it is what the ink has to survive.
  <BackgroundContext.Provider
    value={{ hasBackground: true, isDarkBackground: true, effectiveLuminance: 0.06 }}
  >
    <main style={{ background: '#11140f', minHeight: '100vh', padding: 24 }}>
      <div style={{ width: 340 }} data-tile="lock">
        <LockWidget
          accessory={lock}
          expanded
          onToggle={() => {}}
          onSlider={() => {}}
          onExpandToggle={() => {}}
          iconStyle="standard"
        />
      </div>
    </main>
  </BackgroundContext.Provider>,
);
