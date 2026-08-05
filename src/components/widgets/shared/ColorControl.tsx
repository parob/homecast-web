import React, { useState } from 'react';
import { Palette } from 'lucide-react';
import { Slider } from '@/components/ui/slider';

interface ColorControlProps {
  /** Hue in degrees (0-360) */
  hue: number;
  /** Saturation percentage (0-100) */
  saturation: number;
  onCommitHue: (value: number) => void;
  onCommitSaturation: (value: number) => void;
  disabled?: boolean;
}

const HUE_GRADIENT =
  'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)';

/**
 * Hue + saturation picker for colour-capable lights. Only rendered in the
 * expanded overlay — the inline card keeps the read-only swatch, which is all
 * a glance needs.
 */
export const ColorControl: React.FC<ColorControlProps> = ({
  hue,
  saturation,
  onCommitHue,
  onCommitSaturation,
  disabled = false,
}) => {
  const [dragHue, setDragHue] = useState<number | null>(null);
  const [dragSat, setDragSat] = useState<number | null>(null);

  const previewHue = dragHue ?? hue;
  const previewSat = dragSat ?? saturation;
  const satGradient = `linear-gradient(to right, hsl(${previewHue} 0% 75%), hsl(${previewHue} 100% 50%))`;

  return (
    <div className={`space-y-2 ${disabled ? 'cursor-not-allowed' : ''}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Palette className="h-4 w-4" />
          <span>Color</span>
        </div>
        <div
          className="h-5 w-5 rounded-full border border-border shrink-0"
          style={{ backgroundColor: `hsl(${previewHue} ${previewSat}% 50%)` }}
        />
      </div>

      <Slider
        value={[previewHue]}
        min={0}
        max={360}
        step={1}
        onValueChange={(v) => setDragHue(v[0])}
        onValueCommit={(v) => {
          setDragHue(null);
          onCommitHue(v[0]);
        }}
        disabled={disabled}
        size="lg"
        fixedGradient
        trackColorClass="bg-transparent"
        trackBgClass="bg-muted/25"
        trackFillStyle={{ backgroundImage: HUE_GRADIENT }}
        trackBgStyle={{ backgroundImage: HUE_GRADIENT }}
        className={disabled ? 'cursor-not-allowed' : ''}
      />

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Saturation</span>
        <span className="text-sm font-medium">{Math.round(previewSat)}%</span>
      </div>

      <Slider
        value={[previewSat]}
        min={0}
        max={100}
        step={1}
        onValueChange={(v) => setDragSat(v[0])}
        onValueCommit={(v) => {
          setDragSat(null);
          onCommitSaturation(v[0]);
        }}
        disabled={disabled}
        size="lg"
        fixedGradient
        trackColorClass="bg-transparent"
        trackBgClass="bg-muted/25"
        trackFillStyle={{ backgroundImage: satGradient }}
        trackBgStyle={{ backgroundImage: satGradient }}
        className={disabled ? 'cursor-not-allowed' : ''}
      />
    </div>
  );
};
