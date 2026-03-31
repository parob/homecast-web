import * as React from "react";
import { cn } from "@/lib/utils";

interface SliderProps {
  value?: number[];
  defaultValue?: number[];
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onValueChange?: (value: number[]) => void;
  onValueCommit?: (value: number[]) => void;
  className?: string;
  /** Custom class for the filled track portion */
  trackColorClass?: string;
  /** Custom class for the thumb border */
  thumbColorClass?: string;
  /** Custom class for the track background */
  trackBgClass?: string;
  /** When true, gradient fills won't scale with slider position */
  fixedGradient?: boolean;
}

const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ className, value, defaultValue, min = 0, max = 100, step = 1, disabled, onValueChange, onValueCommit, trackColorClass, thumbColorClass, trackBgClass, fixedGradient, ...props }, ref) => {
    const externalValue = value?.[0] ?? defaultValue?.[0] ?? min;
    const [internalValue, setInternalValue] = React.useState(externalValue);
    const [isDragging, setIsDragging] = React.useState(false);
    const intervalRef = React.useRef<NodeJS.Timeout | null>(null);
    const lastCommittedRef = React.useRef<number>(externalValue);

    // Sync internal value with external value when not dragging
    React.useEffect(() => {
      if (!isDragging) {
        setInternalValue(externalValue);
        lastCommittedRef.current = externalValue;
      }
    }, [externalValue, isDragging]);

    // Set up interval to commit value every 500ms while dragging
    React.useEffect(() => {
      if (isDragging) {
        intervalRef.current = setInterval(() => {
          if (lastCommittedRef.current !== internalValue) {
            lastCommittedRef.current = internalValue;
            onValueCommit?.([internalValue]);
          }
        }, 500);
      } else {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    }, [isDragging, internalValue, onValueCommit]);

    const displayValue = isDragging ? internalValue : externalValue;
    const percentage = ((displayValue - min) / (max - min)) * 100;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = parseFloat(e.target.value);
      setInternalValue(newValue);
      setIsDragging(true);
      onValueChange?.([newValue]);
    };

    const handleCommit = (e: React.MouseEvent<HTMLInputElement> | React.TouchEvent<HTMLInputElement>) => {
      const newValue = parseFloat((e.target as HTMLInputElement).value);
      setIsDragging(false);
      // Always commit final value on release
      onValueCommit?.([newValue]);
      lastCommittedRef.current = newValue;
    };

    const cursorStyle = disabled ? 'not-allowed' : 'pointer';

    return (
      <div className={cn("relative flex w-full items-center h-[18px]", className)} style={{ cursor: cursorStyle }}>
        <input
          ref={ref}
          type="range"
          min={min}
          max={max}
          step={step}
          value={displayValue}
          disabled={disabled}
          onChange={handleChange}
          onMouseUp={handleCommit}
          onTouchEnd={handleCommit}
          className="absolute w-full h-full opacity-0 z-10"
          style={{ cursor: cursorStyle }}
          {...props}
        />
        <div className={cn("relative h-[18px] w-full grow overflow-hidden rounded-full", trackBgClass || "bg-muted")} style={{ cursor: cursorStyle }}>
          {/* Background track - lighter version of fill color */}
          <div
            className={cn("absolute inset-0 rounded-full opacity-30", trackColorClass || "bg-primary")}
          />
          {/* Filled portion */}
          <div
            className={cn("absolute h-full rounded-full transition-all", trackColorClass || "bg-primary")}
            style={{
              width: `${percentage}%`,
              ...(fixedGradient && percentage > 0 ? { backgroundSize: `${10000 / percentage}% 100%` } : {})
            }}
          />
        </div>
      </div>
    );
  }
);
Slider.displayName = "Slider";

export { Slider };
