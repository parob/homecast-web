import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

interface DisplaySectionProps {
  hideInfoDevices: boolean;
  toggleHideInfoDevices: (value: boolean) => void;
  hideAccessoryCounts: boolean;
  toggleHideAccessoryCounts: (value: boolean) => void;
  groupByRoom: boolean;
  toggleGroupByRoom: (value: boolean) => void;
  groupByType: boolean;
  toggleGroupByType: (value: boolean) => void;
  layoutMode: 'grid' | 'masonry';
  changeLayoutMode: (mode: 'grid' | 'masonry') => void;
  fullWidth: boolean;
  toggleFullWidth: (value: boolean) => void;
  compactMode: boolean;
  toggleCompactMode: (value: boolean) => void;
  fontSize: 'small' | 'medium' | 'large';
  changeFontSize: (size: 'small' | 'medium' | 'large') => void;
  iconStyle: 'standard' | 'colourful';
  changeIconStyle: (style: 'standard' | 'colourful') => void;
  autoBackgrounds: boolean;
  toggleAutoBackgrounds: (value: boolean) => void;
  settingSaveError: string | null;
  isInMacApp: boolean;
  isInMobileApp: boolean;
}

export function DisplaySection({
  hideInfoDevices,
  toggleHideInfoDevices,
  hideAccessoryCounts,
  toggleHideAccessoryCounts,
  groupByRoom,
  toggleGroupByRoom,
  groupByType,
  toggleGroupByType,
  layoutMode,
  changeLayoutMode,
  fullWidth,
  toggleFullWidth,
  compactMode,
  toggleCompactMode,
  fontSize,
  changeFontSize,
  iconStyle,
  changeIconStyle,
  autoBackgrounds,
  toggleAutoBackgrounds,
  settingSaveError,
  isInMacApp,
  isInMobileApp,
}: DisplaySectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Hide info-only devices</p>
          <p className="text-xs text-muted-foreground">Hide bridges, range extenders, and non-controllable devices</p>
        </div>
        <div className="relative flex items-center">
          {settingSaveError === 'hideInfoDevices' && (
            <div className="absolute right-full mr-2 whitespace-nowrap rounded bg-destructive px-2 py-1 text-xs text-destructive-foreground shadow-lg">
              Failed to save
            </div>
          )}
          <Switch
            checked={hideInfoDevices}
            onCheckedChange={toggleHideInfoDevices}
          />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Show counts</p>
          <p className="text-xs text-muted-foreground">Show accessory counts in sidebar and room headers</p>
        </div>
        <div className="relative flex items-center">
          {settingSaveError === 'hideAccessoryCounts' && (
            <div className="absolute right-full mr-2 whitespace-nowrap rounded bg-destructive px-2 py-1 text-xs text-destructive-foreground shadow-lg">
              Failed to save
            </div>
          )}
          <Switch
            checked={!hideAccessoryCounts}
            onCheckedChange={(checked) => toggleHideAccessoryCounts(!checked)}
          />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Group by room</p>
          <p className="text-xs text-muted-foreground">Show room headers and group accessories by room</p>
        </div>
        <div className="relative flex items-center">
          {settingSaveError === 'groupByRoom' && (
            <div className="absolute right-full mr-2 whitespace-nowrap rounded bg-destructive px-2 py-1 text-xs text-destructive-foreground shadow-lg">
              Failed to save
            </div>
          )}
          <Switch
            checked={groupByRoom}
            onCheckedChange={toggleGroupByRoom}
          />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Group by type</p>
          <p className="text-xs text-muted-foreground">Group accessories by type</p>
          {groupByType && (
            <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">Rearranging accessories is disabled when grouping by type</p>
          )}
        </div>
        <div className="relative flex items-center">
          {settingSaveError === 'groupByType' && (
            <div className="absolute right-full mr-2 whitespace-nowrap rounded bg-destructive px-2 py-1 text-xs text-destructive-foreground shadow-lg">
              Failed to save
            </div>
          )}
          <Switch
            checked={groupByType}
            onCheckedChange={toggleGroupByType}
          />
        </div>
      </div>

      <div className="border-t pt-4" />

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Layout</p>
            <p className="text-xs text-muted-foreground">How widgets are arranged on the page</p>
          </div>
          {settingSaveError === 'layoutMode' && (
            <div className="whitespace-nowrap rounded bg-destructive px-2 py-1 text-xs text-destructive-foreground shadow-lg">
              Failed to save
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant={layoutMode === 'grid' ? 'default' : 'outline'}
            size="sm"
            onClick={() => changeLayoutMode('grid')}
            className="flex-1"
          >
            Grid
          </Button>
          <Button
            variant={layoutMode === 'masonry' ? 'default' : 'outline'}
            size="sm"
            onClick={() => changeLayoutMode('masonry')}
            className="flex-1"
          >
            Masonry
          </Button>
        </div>
        {compactMode && (
          <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded px-2 py-1">Layout options only take effect when not in compact mode</p>
        )}
      </div>
      {!isInMacApp && !isInMobileApp && (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Full width</p>
            <p className="text-xs text-muted-foreground">Expand the portal to fill the full browser width</p>
          </div>
          <div className="relative flex items-center">
            {settingSaveError === 'fullWidth' && (
              <div className="absolute right-full mr-2 whitespace-nowrap rounded bg-destructive px-2 py-1 text-xs text-destructive-foreground shadow-lg">
                Failed to save
              </div>
            )}
            <Switch
              checked={fullWidth}
              onCheckedChange={toggleFullWidth}
            />
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Compact view</p>
          <p className="text-xs text-muted-foreground">Show smaller widget cards</p>
        </div>
        <div className="relative flex items-center">
          {settingSaveError === 'compactMode' && (
            <div className="absolute right-full mr-2 whitespace-nowrap rounded bg-destructive px-2 py-1 text-xs text-destructive-foreground shadow-lg">
              Failed to save
            </div>
          )}
          <Switch
            checked={compactMode}
            onCheckedChange={toggleCompactMode}
          />
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Text size</p>
            <p className="text-xs text-muted-foreground">Scale text and UI elements</p>
          </div>
          {settingSaveError === 'fontSize' && (
            <div className="whitespace-nowrap rounded bg-destructive px-2 py-1 text-xs text-destructive-foreground shadow-lg">
              Failed to save
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant={fontSize === 'small' ? 'default' : 'outline'}
            size="sm"
            onClick={() => changeFontSize('small')}
            className="flex-1"
          >
            Small
          </Button>
          <Button
            variant={fontSize === 'medium' ? 'default' : 'outline'}
            size="sm"
            onClick={() => changeFontSize('medium')}
            className="flex-1"
          >
            Medium
          </Button>
          <Button
            variant={fontSize === 'large' ? 'default' : 'outline'}
            size="sm"
            onClick={() => changeFontSize('large')}
            className="flex-1"
          >
            Large
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Icon style</p>
            <p className="text-xs text-muted-foreground">Color scheme for widget icons</p>
          </div>
          {settingSaveError === 'iconStyle' && (
            <div className="whitespace-nowrap rounded bg-destructive px-2 py-1 text-xs text-destructive-foreground shadow-lg">
              Failed to save
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant={iconStyle === 'standard' ? 'default' : 'outline'}
            size="sm"
            onClick={() => changeIconStyle('standard')}
            className="flex-1"
          >
            Standard
          </Button>
          <Button
            variant={iconStyle === 'colourful' ? 'default' : 'outline'}
            size="sm"
            onClick={() => changeIconStyle('colourful')}
            className="flex-1"
          >
            Colourful
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Auto backgrounds</p>
          <p className="text-xs text-muted-foreground">Automatically assign backgrounds based on entity</p>
        </div>
        {settingSaveError === 'autoBackgrounds' && (
          <div className="whitespace-nowrap rounded bg-destructive px-2 py-1 text-xs text-destructive-foreground shadow-lg">
            Failed to save
          </div>
        )}
        <Switch
          checked={autoBackgrounds}
          onCheckedChange={toggleAutoBackgrounds}
        />
      </div>
    </div>
  );
}
