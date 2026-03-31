import { useState, useCallback, useEffect, useMemo } from 'react';
import { useQuery } from '@apollo/client/react';
import type { BackgroundSettings, BackgroundPreset, GetUserBackgroundsResponse } from '@/lib/graphql/types';
import { GET_USER_BACKGROUNDS } from '@/lib/graphql/queries';
import { PRESET_SOLID_COLORS, PRESET_GRADIENTS, PRESET_IMAGES, getAutoPresetId } from '@/lib/colorUtils';
import { selectFile, dataURLtoFile } from '@/lib/nativeFilePicker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Upload, RotateCcw, Check, Lightbulb, Power, ChevronDown, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

import { config } from '@/lib/config';

const API_URL = config.apiUrl;

interface BackgroundSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentSettings?: BackgroundSettings | null;
  onSave: (settings: BackgroundSettings) => Promise<void>;
  onSaveToAllHomes?: (settings: BackgroundSettings) => Promise<void>;
  onSaveToAllRooms?: (settings: BackgroundSettings) => Promise<void>;
  onSaveToAllCollections?: (settings: BackgroundSettings) => Promise<void>;
  onSaveToAllGroups?: (settings: BackgroundSettings) => Promise<void>;
  entityName?: string; // e.g., "Living Room", "My Home"
  entityType?: 'home' | 'room' | 'collection' | 'roomGroup';
  // Auto backgrounds support - pre-populate dialog with auto background when no explicit background is set
  autoBackgroundsEnabled?: boolean;
  entityId?: string;
}

// Build presets from colorUtils
const localPresets: BackgroundPreset[] = [
  // Solid Colors (first so they appear at the top)
  ...Object.entries(PRESET_SOLID_COLORS).map(([id, color]) => ({
    id,
    name: id.replace('solid-', '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    url: color, // Store the color value in url field
    category: 'Solid Colors',
  })),
  // Gradients
  ...Object.entries(PRESET_GRADIENTS).map(([id, url]) => ({
    id,
    name: id.replace('gradient-', '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    url,
    category: 'Gradients',
  })),
  // Images
  ...Object.entries(PRESET_IMAGES).map(([id, url]) => {
    const category = id.startsWith('nature-') ? 'Nature' : 'Abstract';
    const name = id.replace(/^(nature-|abstract-)/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return { id, name, url, category };
  }),
];

// Default background settings
const defaultSettings: BackgroundSettings = {
  type: 'none',
  blur: 20,
  brightness: 50,
};

export function BackgroundSettingsDialog({
  open,
  onOpenChange,
  currentSettings,
  onSave,
  onSaveToAllHomes,
  onSaveToAllRooms,
  onSaveToAllCollections,
  onSaveToAllGroups,
  entityName,
  entityType = 'home',
  autoBackgroundsEnabled,
  entityId,
}: BackgroundSettingsDialogProps) {
  // Local state for form
  const [settings, setSettings] = useState<BackgroundSettings>(currentSettings || defaultSettings);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Fetch user's uploaded backgrounds (silently ignore errors if backend doesn't support this yet)
  const { data: userBackgroundsData, loading: loadingUserBackgrounds, refetch: refetchUserBackgrounds } = useQuery<GetUserBackgroundsResponse>(
    GET_USER_BACKGROUNDS,
    {
      fetchPolicy: 'cache-and-network',
      errorPolicy: 'ignore',  // Don't throw if query not supported yet
    }
  );
  const userBackgrounds = userBackgroundsData?.userBackgrounds ?? [];

  // Group presets by category
  const presetsByCategory = useMemo(() => {
    const grouped: Record<string, BackgroundPreset[]> = {};
    for (const preset of localPresets) {
      if (!grouped[preset.category]) {
        grouped[preset.category] = [];
      }
      grouped[preset.category].push(preset);
    }
    return grouped;
  }, []);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      // Compute initial settings: use explicit settings, or auto background if enabled
      let initialSettings = currentSettings;
      if ((!currentSettings || currentSettings.type === 'none') && autoBackgroundsEnabled && entityId) {
        // Pre-populate with auto background
        const autoPresetId = getAutoPresetId(entityId);
        initialSettings = {
          type: 'preset',
          presetId: autoPresetId,
          blur: 10,
          brightness: 50,
        };
      }
      setSettings(initialSettings || defaultSettings);
      setPreviewUrl(null);
      // Refresh user backgrounds when dialog opens
      refetchUserBackgrounds();
    }
  }, [open, currentSettings, autoBackgroundsEnabled, entityId, refetchUserBackgrounds]);

  // Get the current background preview
  const currentBackgroundPreview = useMemo(() => {
    if (previewUrl) return { type: 'image' as const, url: previewUrl };
    if (settings.type === 'none') return null;
    if (settings.type === 'preset' && settings.presetId) {
      // Solid color preset
      if (settings.presetId.startsWith('solid-')) {
        // solid-white means "no background" for widget rendering
        if (settings.presetId === 'solid-white') return null;
        return { type: 'solid' as const, color: PRESET_SOLID_COLORS[settings.presetId] };
      }
      if (settings.presetId.startsWith('gradient-')) {
        return { type: 'gradient' as const, value: PRESET_GRADIENTS[settings.presetId] };
      }
      // Image preset
      if (PRESET_IMAGES[settings.presetId]) {
        return { type: 'image' as const, url: PRESET_IMAGES[settings.presetId] };
      }
    }
    if (settings.type === 'custom' && settings.customUrl) {
      return { type: 'image' as const, url: settings.customUrl };
    }
    return null;
  }, [settings, previewUrl]);

  const handlePresetSelect = useCallback((presetId: string) => {
    setSettings(prev => ({
      ...prev,
      type: 'preset',
      presetId,
      customUrl: undefined,
    }));
    setPreviewUrl(null);
  }, []);

  const handleUploadClick = useCallback(async () => {
    setIsUploading(true);
    try {
      // Use native file picker (Mac Catalyst) or HTML fallback (browser)
      const selectedFile = await selectFile({
        accept: ['image/jpeg', 'image/png', 'image/webp'],
        maxSize: 5 * 1024 * 1024, // 5MB
      });

      // Show preview immediately
      setPreviewUrl(selectedFile.data);

      // Convert data URL to File for upload
      const file = dataURLtoFile(selectedFile.data, selectedFile.name);

      // Upload the file
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_URL}/rest/background`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('homecast-token')}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      const result = await response.json();

      // Ensure the URL is absolute (server may return relative path)
      const imageUrl = result.url.startsWith('http') ? result.url : `${API_URL}${result.url}`;

      setSettings(prev => ({
        ...prev,
        type: 'custom',
        presetId: undefined,
        customUrl: imageUrl,
      }));

      // Clear preview URL so we use the actual uploaded URL
      setPreviewUrl(null);

      // Refresh user backgrounds list
      refetchUserBackgrounds();

      toast.success('Image uploaded');
    } catch (err) {
      // Don't show error toast if user just cancelled
      if (err instanceof Error && err.message === 'cancelled') {
        return;
      }
      console.error('Upload failed:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to upload image');
      setPreviewUrl(null);
    } finally {
      setIsUploading(false);
    }
  }, [refetchUserBackgrounds]);

  const handleDeleteBackground = useCallback(async (filename: string, url: string) => {
    try {
      const response = await fetch(`${API_URL}/rest/background?filename=${encodeURIComponent(filename)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('homecast-token')}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Delete failed');
      }

      // If the deleted background was currently selected, clear the selection
      if (settings.type === 'custom' && settings.customUrl === url) {
        setSettings(defaultSettings);
      }

      // Refresh the list
      refetchUserBackgrounds();
      toast.success('Background deleted');
    } catch (err) {
      console.error('Delete failed:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to delete background');
    }
  }, [settings, refetchUserBackgrounds]);

  const handleClearBackground = useCallback(() => {
    setSettings(defaultSettings);
    setPreviewUrl(null);
  }, []);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await onSave(settings);
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to save background settings:', err);
      toast.error('Failed to save background settings');
    } finally {
      setIsSaving(false);
    }
  }, [settings, onSave, onOpenChange]);

  const handleSaveToAll = useCallback(async (saveHandler: ((settings: BackgroundSettings) => Promise<void>) | undefined, label: string) => {
    if (!saveHandler) return;
    setIsSaving(true);
    try {
      await saveHandler(settings);
      toast.success(`Background applied to ${label}`);
      onOpenChange(false);
    } catch (err) {
      console.error(`Failed to apply background to ${label}:`, err);
      toast.error(`Failed to apply background to ${label}`);
    } finally {
      setIsSaving(false);
    }
  }, [settings, onOpenChange]);

  // Determine which "apply to all" options to show based on entity type
  const applyToAllOptions = useMemo(() => {
    const options: { label: string; handler: () => void }[] = [];

    if (entityType === 'home' && onSaveToAllHomes) {
      options.push({
        label: 'Apply to All Homes',
        handler: () => handleSaveToAll(onSaveToAllHomes, 'all homes'),
      });
    }

    if (entityType === 'room' && onSaveToAllRooms) {
      options.push({
        label: 'Apply to All Rooms',
        handler: () => handleSaveToAll(onSaveToAllRooms, 'all rooms'),
      });
    }

    if (entityType === 'collection' && onSaveToAllCollections) {
      options.push({
        label: 'Apply to All Collections',
        handler: () => handleSaveToAll(onSaveToAllCollections, 'all collections'),
      });
    }

    if (entityType === 'roomGroup' && onSaveToAllGroups) {
      options.push({
        label: 'Apply to All Groups',
        handler: () => handleSaveToAll(onSaveToAllGroups, 'all groups'),
      });
    }

    return options;
  }, [entityType, onSaveToAllHomes, onSaveToAllRooms, onSaveToAllCollections, onSaveToAllGroups, handleSaveToAll]);

  const handleClose = useCallback(() => {
    if (!isSaving && !isUploading) {
      // Clean up preview URL
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      onOpenChange(false);
    }
  }, [isSaving, isUploading, previewUrl, onOpenChange]);

  const entityLabel = entityType === 'roomGroup' ? 'group' : entityType;
  const entityTypeLabel = entityType === 'roomGroup' ? 'Group' : entityType === 'collection' ? 'Collection' : entityType === 'room' ? 'Room' : 'Home';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{entityTypeLabel} Background</DialogTitle>
          <DialogDescription>
            {entityName
              ? `Set a custom background for "${entityName}" (${entityLabel}). This background will be visible when viewing this ${entityLabel}.`
              : `Set a custom background for this ${entityLabel}.`
            }
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4 py-2">
          {/* Preview */}
          <div className="relative h-44 rounded-lg overflow-hidden border bg-muted">
            {currentBackgroundPreview ? (
              <>
                {currentBackgroundPreview.type === 'solid' ? (
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundColor: currentBackgroundPreview.color,
                    }}
                  />
                ) : currentBackgroundPreview.type === 'gradient' ? (
                  <div
                    className="absolute inset-0"
                    style={{
                      background: currentBackgroundPreview.value,
                      filter: settings.blur > 0 ? `blur(${settings.blur}px)` : undefined,
                      transform: settings.blur > 0 ? 'scale(1.1)' : undefined,
                    }}
                  />
                ) : (
                  <img
                    src={currentBackgroundPreview.url}
                    alt="Background preview"
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{
                      filter: settings.blur > 0 ? `blur(${settings.blur}px)` : undefined,
                      transform: settings.blur > 0 ? 'scale(1.1)' : undefined,
                    }}
                  />
                )}
                {/* Brightness overlay - darken when <50, brighten when >50 */}
                {settings.brightness !== 50 && (
                  <div
                    className={`absolute inset-0 ${settings.brightness < 50 ? 'bg-black' : 'bg-white'}`}
                    style={{ opacity: Math.abs(settings.brightness - 50) / 50 }}
                  />
                )}
                {/* Sample widgets overlay */}
                {(() => {
                  // Match real app logic: most backgrounds are considered dark unless brightness is very high
                  // Real app uses luminance < 0.8 threshold; typical images have ~0.4 luminance
                  // With 0.4 luminance: brightness 80+ needed to reach 0.8 effective luminance
                  const isDarkBg = settings.brightness < 80;
                  const cardBg = isDarkBg
                    ? 'bg-black/30 backdrop-blur-xl border-white/20'
                    : 'bg-white/70 backdrop-blur-xl border-white/50';
                  const textColor = isDarkBg ? 'text-white' : '';
                  const mutedText = isDarkBg ? 'text-white/60' : 'text-muted-foreground';

                  return (
                    <div className="absolute inset-0 flex items-center justify-center gap-3 p-4">
                      {/* Mock Light Widget - On */}
                      <div className={`w-32 rounded-xl shadow-lg border p-3 ${cardBg}`}>
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                            <Lightbulb className="h-4 w-4" />
                          </div>
                          <Switch
                            checked={true}
                            className="scale-75"
                            checkedColorClass="bg-amber-500"
                          />
                        </div>
                        <div className={`text-xs font-medium truncate ${textColor}`}>Ceiling Light</div>
                        <div className={`text-[10px] ${mutedText}`}>80%</div>
                      </div>
                      {/* Mock Switch Widget - Off */}
                      <div className={`w-32 rounded-xl shadow-lg border p-3 ${cardBg}`}>
                        <div className="flex items-start justify-between mb-2">
                          <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${isDarkBg ? 'bg-white/10 text-white/50' : 'bg-muted text-muted-foreground'}`}>
                            <Power className="h-4 w-4" />
                          </div>
                          <Switch
                            checked={false}
                            className="scale-75"
                            uncheckedColorClass={isDarkBg ? 'bg-white/20' : undefined}
                            uncheckedThumbClass={isDarkBg ? 'bg-white/70' : undefined}
                          />
                        </div>
                        <div className={`text-xs font-medium truncate ${textColor}`}>Smart Plug</div>
                        <div className={`text-[10px] ${mutedText}`}>Off</div>
                      </div>
                    </div>
                  );
                })()}
              </>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center gap-3 p-4 bg-muted">
                {/* Show widgets on plain background when no background set */}
                <Card className="w-32 bg-card shadow-sm">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                        <Lightbulb className="h-4 w-4" />
                      </div>
                      <Switch checked={true} className="scale-75" checkedColorClass="bg-amber-500" />
                    </div>
                    <div className="text-xs font-medium truncate">Ceiling Light</div>
                    <div className="text-[10px] text-muted-foreground">80%</div>
                  </CardContent>
                </Card>
                <Card className="w-32 bg-card shadow-sm">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <Power className="h-4 w-4" />
                      </div>
                      <Switch checked={false} className="scale-75" />
                    </div>
                    <div className="text-xs font-medium truncate">Smart Plug</div>
                    <div className="text-[10px] text-muted-foreground">Off</div>
                  </CardContent>
                </Card>
              </div>
            )}
            {isUploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/80">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            )}
          </div>

          {/* Presets */}
          <div className="flex-1 overflow-hidden">
            <ScrollArea className="h-[280px] rounded-md border p-2">
              <div className="space-y-4">
                {/* Upload button and user's uploaded backgrounds */}
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 px-1">
                    My Uploads
                  </h4>
                  <div className="grid grid-cols-5 gap-2">
                    {/* Upload new button */}
                    <button
                      className={cn(
                        'relative aspect-square rounded-lg overflow-hidden border-2 transition-all bg-muted',
                        'border-dashed border-muted-foreground/30 hover:border-muted-foreground/50'
                      )}
                      onClick={handleUploadClick}
                      disabled={isUploading || isSaving}
                      title="Upload Image"
                    >
                      <div className="absolute inset-0 flex items-center justify-center">
                        {isUploading ? (
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        ) : (
                          <Upload className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                    </button>
                    {/* Loading placeholder */}
                    {loadingUserBackgrounds && userBackgrounds.length === 0 && (
                      <div className="relative aspect-square rounded-lg overflow-hidden border-2 border-transparent bg-muted flex items-center justify-center">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    )}
                    {/* User's uploaded backgrounds */}
                    {userBackgrounds.map((bg) => {
                      const isSelected = settings.type === 'custom' && settings.customUrl === bg.url;
                      return (
                        <div key={bg.url} className="relative group">
                          <button
                            className={cn(
                              'relative aspect-square rounded-lg overflow-hidden border-2 transition-all w-full',
                              isSelected
                                ? 'border-primary ring-2 ring-primary/20'
                                : 'border-transparent hover:border-muted-foreground/30'
                            )}
                            onClick={() => {
                              setSettings(prev => ({
                                ...prev,
                                type: 'custom',
                                presetId: undefined,
                                customUrl: bg.url,
                              }));
                              setPreviewUrl(null);
                            }}
                            disabled={isUploading || isSaving}
                            title={bg.filename}
                          >
                            <img
                              src={bg.thumbnailUrl}
                              alt={bg.filename}
                              className="absolute inset-0 w-full h-full object-cover"
                              loading="lazy"
                            />
                            {isSelected && (
                              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                <Check className="h-4 w-4 text-white" />
                              </div>
                            )}
                          </button>
                          {/* Delete button - shows on hover */}
                          <button
                            className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity flex items-center justify-center shadow-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteBackground(bg.filename, bg.url);
                            }}
                            disabled={isUploading || isSaving}
                            title="Delete background"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {Object.entries(presetsByCategory).map(([category, presets]) => (
                  <div key={category}>
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 px-1">
                      {category}
                    </h4>
                    <div className="grid grid-cols-5 gap-2">
                      {presets.map((preset) => {
                        const isSelected = settings.type === 'preset' && settings.presetId === preset.id;
                        const isSolid = preset.id.startsWith('solid-');
                        const isGradient = preset.id.startsWith('gradient-');
                        const isWhite = preset.id === 'solid-white';

                        return (
                          <button
                            key={preset.id}
                            className={cn(
                              'relative aspect-square rounded-lg overflow-hidden border-2 transition-all',
                              isSelected
                                ? 'border-primary ring-2 ring-primary/20'
                                : 'border-transparent hover:border-muted-foreground/30',
                              // White needs a visible border when not selected
                              isWhite && !isSelected && 'border-gray-200'
                            )}
                            onClick={() => handlePresetSelect(preset.id)}
                            disabled={isUploading || isSaving}
                            title={preset.name}
                          >
                            {isSolid ? (
                              <div
                                className="absolute inset-0"
                                style={{ backgroundColor: preset.url }}
                              />
                            ) : isGradient ? (
                              <div
                                className="absolute inset-0"
                                style={{ background: preset.url }}
                              />
                            ) : (
                              <img
                                src={preset.url}
                                alt={preset.name}
                                className="absolute inset-0 w-full h-full object-cover"
                                loading="lazy"
                              />
                            )}
                            {isSelected && (
                              <div className={cn(
                                "absolute inset-0 flex items-center justify-center",
                                isWhite ? "bg-black/10" : "bg-black/30"
                              )}>
                                <Check className={cn("h-4 w-4", isWhite ? "text-gray-600" : "text-white")} />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Blur and Dim sliders */}
          {settings.type !== 'none' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Blur</Label>
                  <span className="text-xs text-muted-foreground">{settings.blur}</span>
                </div>
                <Slider
                  value={[settings.blur]}
                  min={0}
                  max={30}
                  step={1}
                  onValueChange={([value]) => setSettings(prev => ({ ...prev, blur: value }))}
                  disabled={isUploading || isSaving}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Brightness</Label>
                  <span className="text-xs text-muted-foreground">{settings.brightness}%</span>
                </div>
                <Slider
                  value={[settings.brightness]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={([value]) => setSettings(prev => ({ ...prev, brightness: value }))}
                  disabled={isUploading || isSaving}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="ghost"
            onClick={handleClearBackground}
            disabled={isSaving || isUploading || settings.type === 'none'}
            className="sm:mr-auto"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset to Default
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose} disabled={isSaving || isUploading}>
              Cancel
            </Button>
            {applyToAllOptions.length > 0 ? (
              <div className="flex">
                <Button
                  onClick={handleSave}
                  disabled={isSaving || isUploading}
                  className="rounded-r-none"
                >
                  {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Save
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      disabled={isSaving || isUploading}
                      className="rounded-l-none border-l border-primary-foreground/20 px-2"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="z-[10100]">
                    <DropdownMenuItem onClick={handleSave}>
                      Save for This {entityTypeLabel}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {applyToAllOptions.map((option) => (
                      <DropdownMenuItem key={option.label} onClick={option.handler}>
                        {option.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : (
              <Button onClick={handleSave} disabled={isSaving || isUploading}>
                {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default BackgroundSettingsDialog;
