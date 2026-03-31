import React from 'react';
import type { HomeKitAccessory } from '@/lib/graphql/types';
import { WidgetProps } from './types';
import { resolveWidgetType } from './resolve-widget-type';

// Import all widgets directly (not from barrel export to avoid circular deps)
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

interface AccessoryWidgetProps extends WidgetProps {
  accessory: HomeKitAccessory;
  hideInfoDevices?: boolean;
  expanded?: boolean;
}

/**
 * Custom comparison for AccessoryWidget memoization
 * Only re-render if meaningful props changed
 */
const accessoryWidgetPropsAreEqual = (
  prevProps: AccessoryWidgetProps,
  nextProps: AccessoryWidgetProps
): boolean => {
  // Check accessory identity and key state
  if (prevProps.accessory.id !== nextProps.accessory.id) return false;
  if (prevProps.accessory.isReachable !== nextProps.accessory.isReachable) return false;

  // Check if services/characteristics changed (shallow comparison of values)
  const prevServices = prevProps.accessory.services || [];
  const nextServices = nextProps.accessory.services || [];
  if (prevServices.length !== nextServices.length) return false;

  for (let i = 0; i < prevServices.length; i++) {
    const prevChars = prevServices[i].characteristics || [];
    const nextChars = nextServices[i].characteristics || [];
    if (prevChars.length !== nextChars.length) return false;

    for (let j = 0; j < prevChars.length; j++) {
      if (prevChars[j].value !== nextChars[j].value) return false;
    }
  }

  // Check other props that affect rendering
  if (prevProps.compact !== nextProps.compact) return false;
  if (prevProps.iconStyle !== nextProps.iconStyle) return false;
  if (prevProps.expanded !== nextProps.expanded) return false;
  if (prevProps.hideInfoDevices !== nextProps.hideInfoDevices) return false;
  if (prevProps.editMode !== nextProps.editMode) return false;
  if (prevProps.editModeType !== nextProps.editModeType) return false;
  if (prevProps.isHiddenUi !== nextProps.isHiddenUi) return false;
  if (prevProps.homeName !== nextProps.homeName) return false;
  if (prevProps.isHidden !== nextProps.isHidden) return false;
  if (prevProps.hideLabel !== nextProps.hideLabel) return false;
  if (prevProps.showHiddenItems !== nextProps.showHiddenItems) return false;
  // onShare, onHide, onToggleShowHidden are intentionally excluded from comparison —
  // they are closures that change identity every render but their behavior only depends
  // on props already compared above (accessory.id, selectedHomeId, showHiddenItems).
  if (prevProps.disabled !== nextProps.disabled) return false;

  return true;
};

/**
 * Smart widget selector - automatically picks the right widget based on accessory type.
 * Uses resolveWidgetType() as the single source of truth for widget type selection.
 */
const AccessoryWidgetInner: React.FC<AccessoryWidgetProps> = (props) => {
  const { accessory, hideInfoDevices } = props;

  const { widgetType, sensorType, deviceType } = resolveWidgetType({
    category: accessory.category,
    serviceTypes: (accessory.services || []).map(s => s.serviceType),
  });

  if (widgetType === 'info' || widgetType === 'hidden') {
    if (hideInfoDevices) {
      return null;
    }
    return <InfoWidget {...props} />;
  }

  switch (widgetType) {
    case 'lightbulb':
      return <LightbulbWidget {...props} />;
    case 'switch':
      return <SwitchWidget {...props} />;
    case 'outlet':
      return <OutletWidget {...props} />;
    case 'thermostat':
      return <ThermostatWidget {...props} />;
    case 'lock':
      return <LockWidget {...props} />;
    case 'fan':
      return <FanWidget {...props} />;
    case 'air_purifier':
      return <AirPurifierWidget {...props} />;
    case 'humidifier':
      return <HumidifierWidget {...props} />;
    case 'window_covering':
      return <WindowCoveringWidget {...props} />;
    case 'garage_door':
      return <GarageDoorWidget {...props} />;
    case 'door_window':
      return <DoorWindowWidget {...props} deviceType={deviceType || 'door'} />;
    case 'contact_sensor':
      return <ContactSensorWidget {...props} />;
    case 'speaker':
      return <SpeakerWidget {...props} />;
    case 'security_system':
      return <SecuritySystemWidget {...props} />;
    case 'doorbell':
      return <DoorbellWidget {...props} />;
    case 'valve':
      return <ValveWidget {...props} />;
    case 'irrigation':
      return <IrrigationWidget {...props} />;
    case 'camera':
      return <CameraWidget {...props} />;
    case 'smoke_alarm':
      return <SmokeAlarmWidget {...props} />;
    case 'motion_sensor':
      return <MotionSensorWidget {...props} />;
    case 'multi_sensor':
      return <MultiSensorWidget {...props} />;
    case 'sensor':
      return <SensorWidget {...props} sensorType={sensorType} />;
    case 'button':
      return <ButtonWidget {...props} />;
    case 'remote':
      return <RemoteWidget {...props} />;
    default:
      return <SwitchWidget {...props} />;
  }
};

// Memoized AccessoryWidget - prevents re-renders when props haven't meaningfully changed
export const AccessoryWidget = React.memo(AccessoryWidgetInner);
