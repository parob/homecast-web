import { describe, it, expect } from 'vitest';
import { inferServiceType, mqttToAccessory, mqttPublishFor } from '../widget-adapter';

// The payloads the cloud bridge actually publishes for a virtual accessory —
// one key, named after the characteristic. Captured from production.
const VIRTUAL_PAYLOADS: Array<[string, string, string, unknown]> = [
  // payload,                 inferred type,      virtualType,      value
  ['{"number": 0}',           'virtual_number',   'input_number',   0],
  ['{"count": 3}',            'virtual_count',    'counter',        3],
  ['{"mode": "Home"}',        'virtual_mode',     'input_select',   'Home'],
  ['{"timer": "idle"}',       'virtual_timer',    'timer',          'idle'],
  ['{"text": "yo"}',          'virtual_text',     'input_text',     'yo'],
  ['{"datetime": ""}',        'virtual_datetime', 'input_datetime', ''],
];

describe('virtual accessories in the MQTT browser', () => {
  it.each(VIRTUAL_PAYLOADS)(
    'renders %s as a virtual widget',
    (payload, expectedType, virtualType, value) => {
      const out = mqttToAccessory(`homecast/home-1111/helper-abcd`, payload, true);
      // Before these were mapped, inferServiceType returned 'unknown' and
      // mqttToAccessory returned null — the inspector showed no widget at all.
      expect(out, `${payload} produced no accessory`).not.toBeNull();
      expect(out!.type).toBe(expectedType);

      const acc = out!.accessory as unknown as Record<string, unknown>;
      expect(acc.isVirtual).toBe(true);
      expect(acc.virtualType).toBe(virtualType);
      // resolve-widget-type selects the virtual widget off this prefix
      expect(out!.accessory.services![0].serviceType).toMatch(/^virtual/);

      const char = out!.accessory.services![0].characteristics![0];
      expect(char.characteristicType).toBe(expectedType);
      expect(char.value).toBe(value);
      // A helper exists to be set — a read-only control would be pointless
      expect(char.isWritable).toBe(true);
    },
  );

  it('feeds the timer widget its running state, which over MQTT is the value', () => {
    const running = mqttToAccessory('homecast/home-1111/timer-abcd', '{"timer": "active"}', true);
    expect((running!.accessory as unknown as Record<string, unknown>).virtualTimerState).toBe('active');
    const idle = mqttToAccessory('homecast/home-1111/timer-abcd', '{"timer": "idle"}', true);
    expect((idle!.accessory as unknown as Record<string, unknown>).virtualTimerState).toBe('idle');
  });

  it('publishes a widget change back under the key the bridge accepts', () => {
    expect(mqttPublishFor('virtual_mode', 'virtual_mode', 'Away')).toEqual({ key: 'mode', value: 'Away' });
    expect(mqttPublishFor('virtual_count', 'virtual_count', 7)).toEqual({ key: 'count', value: 7 });
    expect(mqttPublishFor('virtual_text', 'virtual_text', 'hi')).toEqual({ key: 'text', value: 'hi' });
  });

  it('leaves a boolean helper looking like the switch it is', () => {
    // It publishes plain `on`, indistinguishable from a real switch — and it
    // renders identically either way, so there is nothing to disambiguate.
    expect(inferServiceType({ on: false })).toBe('switch');
  });

  it('does not mistake a real accessory for a virtual one', () => {
    expect(inferServiceType({ on: true, brightness: 40 })).toBe('lightbulb');
    expect(inferServiceType({ current_temp: 20.5 })).toBe('temperature_sensor');
    expect(inferServiceType({ locked: 1 })).toBe('lock');
    expect(inferServiceType({ active: 1, speed: 30 })).toBe('fan');
  });
});
