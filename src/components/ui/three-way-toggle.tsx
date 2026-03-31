import * as React from "react";
import { cn } from "@/lib/utils";
import { LockKeyholeOpen, LockKeyhole } from "lucide-react";

export type ThreeWayState = "off" | "public" | "protected";

interface ThreeWayToggleProps {
  value: ThreeWayState;
  onChange: (value: ThreeWayState) => void;
  className?: string;
}

export function ThreeWayToggle({ value, onChange, className }: ThreeWayToggleProps) {
  const handleClick = (newValue: ThreeWayState) => {
    onChange(newValue);
  };

  return (
    <div
      className={cn(
        "flex items-center h-8 rounded-full bg-muted p-1 gap-0.5",
        className
      )}
    >
      <button
        type="button"
        onClick={() => handleClick("off")}
        className={cn(
          "flex items-center justify-center px-3 h-6 rounded-full transition-all text-sm font-medium",
          value === "off"
            ? "bg-background shadow-sm text-foreground"
            : "text-muted-foreground hover:text-foreground/70"
        )}
        title="Off"
      >
        Off
      </button>
      <button
        type="button"
        onClick={() => handleClick("public")}
        className={cn(
          "flex items-center justify-center w-8 h-6 rounded-full transition-all",
          value === "public"
            ? "bg-amber-500/20 shadow-sm text-amber-600 dark:text-amber-400"
            : "text-muted-foreground hover:text-foreground/70"
        )}
        title="Public (no authentication)"
      >
        <LockKeyholeOpen className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => handleClick("protected")}
        className={cn(
          "flex items-center justify-center w-8 h-6 rounded-full transition-all",
          value === "protected"
            ? "bg-green-500/20 shadow-sm text-green-600 dark:text-green-400"
            : "text-muted-foreground hover:text-foreground/70"
        )}
        title="Protected (requires authentication)"
      >
        <LockKeyhole className="h-4 w-4" />
      </button>
    </div>
  );
}
