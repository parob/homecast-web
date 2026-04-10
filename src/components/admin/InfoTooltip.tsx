import { Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface InfoTooltipProps {
  children: React.ReactNode;
  /** Optional override for the icon className (e.g., size) */
  iconClassName?: string;
}

/**
 * Small info icon that reveals helper text on hover/focus.
 * Use next to section titles to keep card content uncluttered.
 */
export function InfoTooltip({ children, iconClassName = 'h-3.5 w-3.5' }: InfoTooltipProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            aria-label="More info"
          >
            <Info className={iconClassName} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
