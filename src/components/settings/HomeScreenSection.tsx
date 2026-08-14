import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { useHomeLayout } from '@/hooks/useEntityLayout';
import type { HomeLayoutData } from '@/hooks/useEntityLayout';
import {
  SUMMARY_SECTION_ORDER,
  SUMMARY_SECTION_META,
  isSummarySectionVisible,
  withSummarySectionVisibility,
  type SummarySectionId,
} from '@/lib/summary-sections';
import { describeError } from '@/lib/describe-error';

/**
 * Per-home control over the summary row at the top of the home view — which
 * pills appear. Which Actions sit *inside* the Actions pill is a page of its
 * own (`home/HomeActionsSection`); the two used to be stacked here, and the
 * Actions list was long enough to bury everything below it.
 *
 * Both sets are stored in the home's layout blob (the same `stored_entities`
 * row as its accessory layout) as *hidden* lists, so a home that predates this
 * setting shows everything with no migration.
 *
 * Unlike the MQTT and Analytics switches, these are optimistic: `useHomeLayout`
 * writes the Apollo cache before it mutates, so a flip lands on the dashboard
 * behind the dialog in the same tick. Don't add a refetch.
 */
export function HomeScreenSection({ home }: { home: { id: string; name: string } }) {
  const { layout, updateLayout, loading } = useHomeLayout(home.id);

  type Visibility = HomeLayoutData['visibility'];
  const save = (mutate: (visibility: Visibility) => Visibility) =>
    updateLayout(prev => ({ ...prev, visibility: mutate(prev?.visibility) }))
      .catch(e => toast.error('Could not save', { description: describeError(e) }));

  const setSection = (id: SummarySectionId, visible: boolean) =>
    save(v => ({ ...v, hiddenSummarySections: withSummarySectionVisibility(v?.hiddenSummarySections, id, visible) }));

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Home Screen</p>
      {SUMMARY_SECTION_ORDER.map(id => (
        <div key={id} className="flex items-center justify-between gap-3 py-1">
          <div className="min-w-0">
            <p className="text-sm font-medium">{SUMMARY_SECTION_META[id].label}</p>
            <p className="text-xs text-muted-foreground">{SUMMARY_SECTION_META[id].description}</p>
          </div>
          <Switch
            checked={isSummarySectionVisible(layout, id)}
            disabled={loading}
            onCheckedChange={(checked) => setSection(id, checked)}
          />
        </div>
      ))}
    </div>
  );
}
