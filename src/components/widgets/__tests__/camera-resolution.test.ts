import { describe, expect, it } from 'vitest';
import { resolveWidgetType } from '../resolve-widget-type';

describe('camera profile classification', () => {
  // Service combinations reported by the managed relay, without identifying
  // information. Most cameras have no category or camera service at all.
  it.each([
    ['microphone', 'motion_sensor', 'doorbell', 'battery'],
    ['microphone', 'motion_sensor', 'doorbell', 'camera_operating_mode'],
    ['speaker', 'motion_sensor', 'doorbell'],
  ])('preserves a video doorbell and its snapshot surface (%j)', (...serviceTypes) => {
    expect(resolveWidgetType({ category: '', serviceTypes, camera: { snapshot: true, stream: true } }).widgetType).toBe('doorbell');
  });

  it.each([
    ['camera_operating_mode', 'microphone', 'motion_sensor'],
    ['motion_sensor', 'microphone', 'battery', 'lightbulb'],
    ['speaker', 'camera_operating_mode', 'microphone', 'motion_sensor'],
    ['motion_sensor', 'microphone', 'camera_operating_mode'],
    ['accessory_information'],
    ['motion_sensor', 'occupancy_sensor'],
  ])('shows a camera rather than an incidental service (%j)', (...serviceTypes) => {
    expect(resolveWidgetType({ category: '', serviceTypes, camera: { snapshot: true, stream: true } }).widgetType).toBe('camera');
  });

  it('preserves legacy category-based cameras and ordinary lights', () => {
    expect(resolveWidgetType({ category: 'IP Camera', serviceTypes: ['microphone', 'motion_sensor'] }).widgetType).toBe('camera');
    expect(resolveWidgetType({ serviceTypes: ['lightbulb'] }).widgetType).toBe('lightbulb');
  });

  it('recognises a raw HomeKit doorbell service UUID', () => {
    expect(resolveWidgetType({ serviceTypes: ['00000121-0000-1000-8000-0026BB765291'], camera: { snapshot: true, stream: false } }).widgetType).toBe('doorbell');
  });
});
