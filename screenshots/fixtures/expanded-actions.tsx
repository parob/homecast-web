import React from 'react';
import { createRoot } from 'react-dom/client';
import { Video } from 'lucide-react';
import { WidgetCard } from '../../src/components/widgets/WidgetCard';
import { SharedHistoryProvider } from '../../src/contexts/HistoryContext';
import { PinnedTabsProvider } from '../../src/contexts/PinnedTabsContext';
import { VirtualAccessoryEditProvider } from '../../src/components/widgets/VirtualAccessoryEditContext';
import type { HomeKitAccessory } from '../../src/native/homekit-bridge';
import '../../src/index.css';

/**
 * The real expanded panel, at the width it was reported from, so the action
 * row can be photographed and measured rather than described.
 *
 * Every action in the cluster is reached through the context that really gates
 * it — Analytics through `SharedHistoryProvider`, Pin through
 * `PinnedTabsProvider`, Edit and Delete through `VirtualAccessoryEditProvider`
 * — because the point of the fixture is the list `WidgetCard` builds, not a
 * list handed to `ExpandedActionBar` by the test. Price & Deals is the one
 * exception: its gate is an Apollo query, and a sixth pill proves nothing the
 * fifth doesn't.
 *
 * `?virtual=1` adds Edit and Delete, which is the widest the cluster ever gets.
 * `?sizes=1` offers the three tile sizes, which is what put a Size button in
 * the row on the screen this fixture is a picture of.
 * `?immersive=1` is the landscape camera, where the row shares its line with
 * the accessory's name and the close control rather than sitting under a hero.
 */

const params = new URLSearchParams(location.search);
const virtual = params.get('virtual') === '1';
const sizes = params.get('sizes') === '1';
const immersive = params.get('immersive') === '1';

const accessory: HomeKitAccessory = {
  id: 'front-door',
  homeId: 'panel-home',
  name: 'Front Door',
  roomName: 'Entrance',
  category: 'camera',
  isReachable: true,
  camera: { snapshot: true, stream: true },
  // One recordable characteristic is what `historyAvailable` looks for.
  services: [
    {
      id: 'front-door-battery',
      name: 'Front Door',
      serviceType: 'battery',
      characteristics: [
        {
          id: 'front-door-battery-level',
          characteristicType: 'battery_level',
          value: 87,
          isReadable: true,
          isWritable: false,
        },
      ],
    },
  ],
};

const virtualActions = {
  edit: (id: string) => (virtual && id === accessory.id ? () => {} : undefined),
  remove: (id: string) => (virtual && id === accessory.id ? () => {} : undefined),
  definition: () => undefined,
  timer: () => undefined,
};

const pinned = {
  enabled: true,
  isPinned: () => false,
  isFull: false,
  toggle: () => {},
};

/** A block hero, so the panel has something above the row the way a camera does. */
const hero = (
  <div
    data-panel-hero
    style={{
      width: '100%',
      height: 150,
      borderRadius: 12,
      background: 'linear-gradient(160deg, #2d4a6b 0%, #7d8fa3 55%, #3c3128 100%)',
    }}
  />
);

function Panel() {
  return (
    <WidgetCard
      title="Front Door"
      subtitle="Doorbell camera"
      icon={<Video />}
      expanded
      isReachable
      accessory={accessory}
      hero={hero}
      heroShape="block"
      heroStack
      heroImmersive={immersive}
      headerAction={immersive ? <button aria-label="Close" style={{ width: 28, height: 28, borderRadius: 999, background: 'rgba(255,255,255,0.2)' }} /> : undefined}
      size="regular"
      sizeOptions={sizes ? ['regular', 'large', 'tall'] : undefined}
      onSizeChange={() => {}}
      onShare={() => {}}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <SharedHistoryProvider enabled homeId={accessory.homeId} onOpenHistory={() => {}}>
    <PinnedTabsProvider value={pinned}>
      <VirtualAccessoryEditProvider value={virtualActions}>
        {/* 440px was the reported viewport; the panel's own inset is the
            dashboard's, so the content box here is the one on that phone. */}
        <main style={{ padding: 16, width: immersive ? Number(params.get('w') ?? 844) : 440 }} data-panel-frame>
          <Panel />
        </main>
      </VirtualAccessoryEditProvider>
    </PinnedTabsProvider>
  </SharedHistoryProvider>,
);
