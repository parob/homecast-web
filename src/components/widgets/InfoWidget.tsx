import React, { memo } from 'react';
import { Info, Wifi, Router } from 'lucide-react';
import { WidgetCard } from './WidgetCard';
import { WidgetProps, getCharacteristic } from './types';

const CATEGORY_ICONS: Record<string, React.FC<{ className?: string }>> = {
  'bridge': Router,
  'range extender': Wifi,
  'rangeextender': Wifi,
};

export const InfoWidget: React.FC<WidgetProps> = memo(({
  accessory,
  compact,
  onExpandToggle,
  onDebug,
  
  iconStyle,
  
  
  editMode,
  editModeType,
  isHiddenUi,
  homeName,
  disableTooltip,
  onRemove,
  removeLabel,
  onHide,
  hideLabel,
  isHidden,
  showHiddenItems,
  onToggleShowHidden,
  onShare,
  locationSubtitle,
}) => {
  const categoryLower = accessory.category?.toLowerCase() || '';
  const Icon = CATEGORY_ICONS[categoryLower] || Info;

  // Get any readable info from accessory_information service
  const firmwareChar = getCharacteristic(accessory, 'firmware_revision');
  const manufacturerChar = getCharacteristic(accessory, 'manufacturer');
  const modelChar = getCharacteristic(accessory, 'model');

  const infoItems = [
    manufacturerChar?.value && `${manufacturerChar.value}`,
    modelChar?.value && `${modelChar.value}`,
    firmwareChar?.value && `v${firmwareChar.value}`,
  ].filter(Boolean);

  // Map category to service type for colors
  const serviceType = categoryLower === 'bridge' ? 'bridge' : undefined;

  return (
    <WidgetCard
      title={accessory.name}
      subtitle={infoItems.length > 0 ? infoItems.join(' · ') : accessory.category}
      icon={<Icon className="h-4 w-4" />}
      iconStyle={iconStyle}
      serviceType={serviceType}
      isOn={accessory.isReachable}
      isReachable={accessory.isReachable}
      accessory={accessory}
      compact={compact}
      onExpandToggle={onExpandToggle}
      onDebug={onDebug}
      
      
      
      editMode={editMode}
      editModeType={editModeType}
      isHiddenUi={isHiddenUi}
      homeName={homeName}
      disableTooltip={disableTooltip}
      onRemove={onRemove}
      removeLabel={removeLabel}
      onHide={onHide}
      hideLabel={hideLabel}
      isHidden={isHidden}
      showHiddenItems={showHiddenItems}
      onToggleShowHidden={onToggleShowHidden}
      onShare={onShare}
      locationSubtitle={locationSubtitle}
    />
  );
});
