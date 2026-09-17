import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { useHomeLayout } from '@/hooks/useEntityLayout';
import type { HomeLayoutData } from '@/hooks/useEntityLayout';
import {
  SUMMARY_PILL_ORDER,
  SCENES_CONTENT_ORDER,
  SUMMARY_PILL_LABEL,
  SUMMARY_SECTION_META,
  isSummarySectionVisible,
  withSummarySectionVisibility,
  type SummarySectionId,
} from '@/lib/summary-sections';
import { describeError } from '@/lib/describe-error';

/**
 * Home-level visibility for room scenes and inline status readings. Individual
 * scenes hide on their cards; Automations is always reachable from the menu.
 * Keep both scene content flags so existing visibility choices still apply.
 */
export function HomeScreenSection({ home }: { home: { id: string; name: string } }) {
  const { layout, updateLayout, loading } = useHomeLayout(home.id);

  type Visibility = HomeLayoutData['visibility'];
  const save = (mutate: (visibility: Visibility) => Visibility) =>
    updateLayout(prev => ({ ...prev, visibility: mutate(prev?.visibility) }))
      .catch(e => toast.error('Could not save', { description: describeError(e) }));

  const setSection = (id: SummarySectionId, visible: boolean) =>
    save(v => ({ ...v, hiddenSummarySections: withSummarySectionVisibility(v?.hiddenSummarySections, id, visible) }));

  const row = (id: SummarySectionId, label: string, description: string, indented = false) => (
    <div key={id} className={`flex items-center justify-between gap-3 py-1 ${indented ? 'pl-4' : ''}`}>
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        checked={isSummarySectionVisible(layout, id)}
        disabled={loading}
        onCheckedChange={(checked) => setSection(id, checked)}
      />
    </div>
  );

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Home Screen</p>
      {SUMMARY_PILL_ORDER.filter(id => id !== 'automations').map(id => (
        id === 'scenes' ? (
          <div key={id} className="space-y-1">
            <p className="text-sm font-medium">{SUMMARY_PILL_LABEL[id]}</p>
            {SCENES_CONTENT_ORDER.map(contentId =>
              row(contentId, SUMMARY_SECTION_META[contentId].label, SUMMARY_SECTION_META[contentId].description, true))}
          </div>
        ) : row(id, SUMMARY_SECTION_META[id].label, SUMMARY_SECTION_META[id].description)
      ))}
    </div>
  );
}
