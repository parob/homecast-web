import { Info } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface InfoTooltipProps {
  children: React.ReactNode;
  /** Optional override for the icon className (e.g., size) */
  iconClassName?: string;
}

/**
 * Small info icon that reveals helper text on click.
 *
 * Uses Popover (click-based) rather than Tooltip (hover-only) so it
 * works on touch devices and doesn't depend on mouse hover.
 */
export function InfoTooltip({ children, iconClassName = 'h-3.5 w-3.5' }: InfoTooltipProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          aria-label="More info"
        >
          <Info className={iconClassName} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-72 text-xs leading-relaxed">
        {children}
      </PopoverContent>
    </Popover>
  );
}
