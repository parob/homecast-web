import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { useHomeLayout } from '@/hooks/useEntityLayout';
import {
  SUMMARY_SECTION_META,
  isSummarySectionVisible,
  withSummarySectionVisibility,
} from '@/lib/summary-sections';
import { describeError } from '@/lib/describe-error';

/**
 * The one per-home Home Screen switch left: Homecast's derived scenes.
 *
 * Apple Home scenes have no switch — the user made them, so they always show
 * unless hidden individually on their cards. Status readings are app-wide, on
 * Settings → Display.
 */
export function HomeScreenSection({ home }: { home: { id: string; name: string } }) {
  const { layout, updateLayout, loading } = useHomeLayout(home.id);
  const meta = SUMMARY_SECTION_META.actions;

  const setVisible = (visible: boolean) =>
    updateLayout(prev => ({
      ...prev,
      visibility: {
        ...prev?.visibility,
        hiddenSummarySections: withSummarySectionVisibility(prev?.visibility?.hiddenSummarySections, 'actions', visible),
      },
    })).catch(e => toast.error('Could not save', { description: describeError(e) }));

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Home Screen</p>
      <div className="flex items-center justify-between gap-3 py-1">
        <div className="min-w-0">
          <p className="text-sm font-medium">{meta.label}</p>
          <p className="text-xs text-muted-foreground">{meta.description}</p>
        </div>
        <Switch
          checked={isSummarySectionVisible(layout, 'actions')}
          disabled={loading}
          onCheckedChange={setVisible}
        />
      </div>
    </div>
  );
}
