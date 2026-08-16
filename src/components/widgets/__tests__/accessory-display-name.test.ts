import { describe, it, expect } from 'vitest';
import { getAccessoryDisplayName, getPrimaryServiceType, getServiceByType } from '../types';
import type { HomeKitAccessory } from '@/lib/graphql/types';

const svc = (serviceType: string, name: string) => ({
  id: `svc-${serviceType}-${name}`,
  name,
  serviceType,
  characteristics: [],
});

const acc = (name: string, services: ReturnType<typeof svc>[]): HomeKitAccessory => ({
  id: 'acc-1',
  name,
  isReachable: true,
  services,
});

const LOCK_MANAGEMENT = '00000044-0000-1000-8000-0026BB765291';

// Every fixture below is a real accessory, copied from an accessories.list the
// relay actually answered — the audit that settled the rule ran over 645 of
// them and changed 14. These are the ones that decided each condition.
describe('getAccessoryDisplayName', () => {
  it('takes the service name when the accessory kept the manufacturer\'s', () => {
    expect(getAccessoryDisplayName(acc('Nuki_19F252BD', [
      svc(LOCK_MANAGEMENT, 'Nuki_19F252BD'),
      svc('accessory_information', 'Nuki_19F252BD'),
      svc('lock', 'Front Door Lock'),
      svc('battery', 'Nuki_19F252BD'),
    ]))).toBe('Front Door Lock');
  });

  it('ignores the transport and history services an Eve accessory carries', () => {
    expect(getAccessoryDisplayName(acc('Eve MotionBlinds 29BB', [
      svc('window_covering', 'Bedroom 2 Blinds'),
      svc('wifi_transport', 'Eve MotionBlinds 29BB'),
      svc('thread_transport', 'Eve MotionBlinds 29BB'),
      svc('accessory_information', 'Eve MotionBlinds 29BB'),
      svc('eve_history', 'Eve MotionBlinds 29BB'),
      svc('battery', 'Eve MotionBlinds 29BB'),
    ]))).toBe('Bedroom 2 Blinds');
  });

  it('keeps a name the user set on the accessory itself', () => {
    // Accessory Information still says "Hue Bulb", so "Living Room Pendant" is
    // a deliberate rename and beats what the lightbulb service reports.
    expect(getAccessoryDisplayName(acc('Living Room Pendant', [
      svc('accessory_information', 'Hue Bulb'),
      svc('lightbulb', 'Hue Bulb'),
    ]))).toBe('Living Room Pendant');
  });

  it('keeps the accessory name when only its disambiguating suffix differs', () => {
    expect(getAccessoryDisplayName(acc('Hue color spot 8', [
      svc('accessory_information', 'Hue color spot'),
      svc('lightbulb', 'Hue color spot'),
    ]))).toBe('Hue color spot 8');
  });

  it('does not let a sub-service rename a multi-purpose accessory', () => {
    // The Nest Cam's motion service is called "Motion". Nothing about that is
    // the name of the camera.
    expect(getAccessoryDisplayName(acc('Front Yard Camera', [
      svc('speaker', 'Front Yard Camera'),
      svc('microphone', 'Front Yard Camera'),
      svc('accessory_information', 'Front Yard Camera'),
      svc('motion_sensor', 'Motion'),
    ]))).toBe('Front Yard Camera');
  });

  it('leaves an accessory whose services each have their own name alone', () => {
    // Nest Protect: smoke, CO and occupancy all named after the accessory's
    // room. Picking any one of them would be picking a part for the whole.
    expect(getAccessoryDisplayName(acc('Bedroom', [
      svc('accessory_information', 'Bedroom'),
      svc('occupancy_sensor', 'Bedroom Occupancy'),
      svc('battery', 'Bedroom'),
      svc('smoke_sensor', 'Bedroom Smoke Sensor'),
      svc('carbon_monoxide_sensor', 'Bedroom CO Sensor'),
    ]))).toBe('Bedroom');
  });

  it('leaves a two-switch accessory alone', () => {
    expect(getAccessoryDisplayName(acc('County Hall Central Switch', [
      svc('switch', 'Resume Heating Schedule'),
      svc('switch', 'Heating'),
      svc('accessory_information', 'County Hall Central Switch'),
    ]))).toBe('County Hall Central Switch');
  });

  it('is idempotent — the relay and the bridge both run it', () => {
    const resolved = acc('Front Door Lock', [
      svc(LOCK_MANAGEMENT, 'Nuki_19F252BD'),
      svc('accessory_information', 'Nuki_19F252BD'),
      svc('lock', 'Front Door Lock'),
    ]);
    expect(getAccessoryDisplayName(resolved)).toBe('Front Door Lock');
  });

  it('keeps the accessory name when every service agrees with it', () => {
    expect(getAccessoryDisplayName(acc('Kitchen Spot 8', [
      svc('accessory_information', 'Kitchen Spot 8'),
      svc('lightbulb', 'Kitchen Spot 8'),
    ]))).toBe('Kitchen Spot 8');
  });

  it('falls back to the accessory when no service is named', () => {
    expect(getAccessoryDisplayName(acc('Bridge 5C00', [
      svc('accessory_information', ''),
      svc('thread_transport', '   '),
    ]))).toBe('Bridge 5C00');
  });
});

describe('lock_management is no longer confused with the lock', () => {
  const nuki = acc('Nuki_19F252BD', [
    svc(LOCK_MANAGEMENT, 'Nuki_19F252BD'),
    svc('lock', 'Front Door Lock'),
  ]);

  it('still resolves the accessory as a lock', () => {
    expect(getPrimaryServiceType(nuki)).toBe('lock');
  });

  it('returns the lock mechanism, not the management service', () => {
    expect(getServiceByType(nuki, 'lock')?.name).toBe('Front Door Lock');
  });
});
