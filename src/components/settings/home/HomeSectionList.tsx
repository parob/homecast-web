import { ChevronRight, LayoutGrid, Zap, Workflow, Bell, ShieldCheck, LineChart, Radio } from 'lucide-react';
import {
  HOME_SETTINGS_SECTION_META,
  type HomeSettingsSectionId,
} from '@/lib/home-settings-sections';

/**
 * The home's sub-sections as a tappable list.
 *
 * Desktop navigates these from the sidebar's third level, so this renders only
 * where there is no sidebar — on mobile the rows *are* the navigation. Styled
 * to match the dialog's own menu rows so the two levels feel like one stack.
 */

const SECTION_ICONS: Record<HomeSettingsSectionId, typeof LayoutGrid> = {
  'home-screen': LayoutGrid,
  actions: Zap,
  automations: Workflow,
  notifications: Bell,
  reliability: ShieldCheck,
  analytics: LineChart,
  mqtt: Radio,
};

export function HomeSectionList({
  sections,
  onSelect,
}: {
  sections: HomeSettingsSectionId[];
  onSelect: (id: HomeSettingsSectionId) => void;
}) {
  if (sections.length === 0) return null;

  return (
    <div className="-mx-6 border-t">
      {sections.map(id => {
        const Icon = SECTION_ICONS[id];
        const meta = HOME_SETTINGS_SECTION_META[id];
        return (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className="w-full flex items-center gap-3 px-6 py-2.5 text-sm hover:bg-muted/50 transition-colors border-b last:border-b-0"
          >
            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="flex-1 min-w-0 text-left">
              <span className="block">{meta.label}</span>
              <span className="block text-xs text-muted-foreground">{meta.description}</span>
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </button>
        );
      })}
    </div>
  );
}
