// Import all widgets
import { LightbulbWidget } from './LightbulbWidget';
import { SwitchWidget } from './SwitchWidget';
import { OutletWidget } from './OutletWidget';
import { ThermostatWidget } from './ThermostatWidget';
import { LockWidget } from './LockWidget';
import { FanWidget } from './FanWidget';
import { WindowCoveringWidget } from './WindowCoveringWidget';
import { GarageDoorWidget } from './GarageDoorWidget';
import { SpeakerWidget } from './SpeakerWidget';
import { SecuritySystemWidget } from './SecuritySystemWidget';
import { SensorWidget } from './SensorWidget';
import { DoorWindowWidget } from './DoorWindowWidget';
import { DoorbellWidget } from './DoorbellWidget';
import { ValveWidget } from './ValveWidget';
import { AirPurifierWidget } from './AirPurifierWidget';
import { HumidifierWidget } from './HumidifierWidget';
import { IrrigationWidget } from './IrrigationWidget';
import { InfoWidget } from './InfoWidget';
import { CameraWidget } from './CameraWidget';
import { MultiSensorWidget } from './MultiSensorWidget';
import { ButtonWidget } from './ButtonWidget';
import { RemoteWidget } from './RemoteWidget';
import { ContactSensorWidget } from './ContactSensorWidget';
import { SmokeAlarmWidget } from './SmokeAlarmWidget';
import { MotionSensorWidget } from './MotionSensorWidget';
import { ServiceGroupWidget } from './ServiceGroupWidget';

// Re-export types and utilities
export * from './types';
export { resolveWidgetType } from './resolve-widget-type';
export type { WidgetType, ResolveWidgetTypeResult } from './resolve-widget-type';
export { WidgetCard, WidgetInteractionContext } from './WidgetCard';
export { getRoomIcon } from './roomIcons';

// AccessoryWidget lives in its own file to avoid circular dependency
// (ServiceGroupWidget imports AccessoryWidget, and this file imports ServiceGroupWidget)
export { AccessoryWidget } from './AccessoryWidget';

// Export individual widgets for direct use
export {
  LightbulbWidget,
  SwitchWidget,
  OutletWidget,
  ThermostatWidget,
  LockWidget,
  FanWidget,
  WindowCoveringWidget,
  GarageDoorWidget,
  SpeakerWidget,
  SecuritySystemWidget,
  SensorWidget,
  DoorWindowWidget,
  DoorbellWidget,
  ValveWidget,
  AirPurifierWidget,
  HumidifierWidget,
  IrrigationWidget,
  InfoWidget,
  CameraWidget,
  MultiSensorWidget,
  ButtonWidget,
  RemoteWidget,
  ContactSensorWidget,
  SmokeAlarmWidget,
  MotionSensorWidget,
  ServiceGroupWidget,
};
