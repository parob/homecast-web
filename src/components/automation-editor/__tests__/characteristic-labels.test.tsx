// @vitest-environment jsdom
//
// The characteristic dropdown listed raw HomeKit types — "power_state" rather
// than "Power State". The stored value must stay raw (it is what gets saved and
// sent to the relay), so this pins the split: readable label, raw value.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@/lib/config', () => ({
  isCommunity: false,
  getCommunityMode: () => null,
  isRelayMode: () => false,
  isClientMode: () => false,
  isRelaySetupComplete: () => false,
  config: { isCommunity: false, apiBase: 'https://api.test', graphqlUrl: 'https://api.test/', wsUrl: 'wss://api.test/ws' },
}));

import { CharacteristicPicker } from '../panels/EntityPicker';
import { characteristicLabel, characteristicValueLabel } from '../entity-labels';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = ResizeObserverStub;

afterEach(cleanup);

describe('characteristicLabel', () => {
  it('humanises snake_case HomeKit types', () => {
    expect(characteristicLabel('power_state')).toBe('Power State');
    expect(characteristicLabel('current_temperature')).toBe('Current Temperature');
    expect(characteristicLabel('battery_level')).toBe('Battery Level');
  });

  it('is safe on empty input', () => {
    expect(characteristicLabel(undefined)).toBe('');
    expect(characteristicLabel('')).toBe('');
  });
});

describe('characteristicValueLabel', () => {
  it('reads switch values as On/Off rather than 1/0', () => {
    // "Power State → 1" made the reader do the translation.
    expect(characteristicValueLabel('power_state', 1)).toBe('On');
    expect(characteristicValueLabel('power_state', 0)).toBe('Off');
    expect(characteristicValueLabel('power_state', true)).toBe('On');
    expect(characteristicValueLabel('active', false)).toBe('Off');
  });

  it('keeps units for non-switch characteristics', () => {
    expect(characteristicValueLabel('brightness', 50)).toBe('50%');
    expect(characteristicValueLabel('current_temperature', 21)).toBe('21.0°C');
  });

  it('returns empty for an unset value so summaries omit the arrow', () => {
    expect(characteristicValueLabel('power_state', undefined)).toBe('');
    expect(characteristicValueLabel('power_state', null)).toBe('');
  });
});

describe('CharacteristicPicker', () => {
  it('shows the readable label for the selected characteristic', () => {
    render(
      <CharacteristicPicker
        value="power_state"
        characteristics={[{ type: 'power_state' }, { type: 'brightness' }]}
        onChange={() => {}}
      />,
    );

    const trigger = screen.getByTestId('characteristic-select');
    expect(trigger.textContent).toContain('Power State');
    expect(trigger.textContent).not.toContain('power_state');
  });

  it('still reports the raw type when a characteristic is chosen', () => {
    const onChange = vi.fn();
    render(
      <CharacteristicPicker
        value="power_state"
        characteristics={[{ type: 'power_state' }, { type: 'brightness' }]}
        onChange={onChange}
      />,
    );

    // Open the listbox and pick the other option by its readable label.
    fireEvent.keyDown(screen.getByTestId('characteristic-select'), { key: 'Enter' });
    const option = screen.getByText('Brightness');
    fireEvent.click(option);

    expect(onChange).toHaveBeenCalledWith('brightness');
  });
});
