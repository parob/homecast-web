import { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { AnimatedCollapse } from '@/components/ui/animated-collapse';
import { Plus, ChevronRight, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AutomationCard } from './AutomationCard';
import { AutomationDetailDialog } from './AutomationDetailDialog';
import { AutomationFormDialog } from './AutomationFormDialog';
import AutomationEditorDialog from '@/components/automation-editor/AutomationEditorDialog';
import { GET_AUTOMATIONS, HC_AUTOMATIONS } from '@/lib/graphql/queries';
import { SAVE_HC_AUTOMATION, DELETE_HC_AUTOMATION } from '@/lib/graphql/mutations';
import type { HomeKitAutomation, GetAutomationsResponse } from '@/lib/graphql/types';
import type { Automation } from '@/automation/types/automation';

interface AutomationsSectionProps {
  homeId: string;
  compact?: boolean;
  isDarkBackground?: boolean;
  hideAccessoryCounts?: boolean;
  // When set, render this fixed list instead of fetching real automations.
  // Used by the tutorial demo flow so the Automations step always has rows.
  demoAutomations?: HomeKitAutomation[];
}

export function AutomationsSection({ homeId, compact, isDarkBackground, hideAccessoryCounts, demoAutomations }: AutomationsSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [selectedAutomation, setSelectedAutomation] = useState<HomeKitAutomation | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<HomeKitAutomation | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingHcAutomation, setEditingHcAutomation] = useState<Automation | undefined>(undefined);
  const [newTypeOpen, setNewTypeOpen] = useState(false);

  const [saveHcAutomation] = useMutation(SAVE_HC_AUTOMATION);
  const [deleteHcAutomation] = useMutation(DELETE_HC_AUTOMATION);

  // HomeKit native automations
  const { data, loading, refetch } = useQuery<GetAutomationsResponse>(
    GET_AUTOMATIONS,
    {
      variables: { homeId },
      skip: !homeId || !!demoAutomations,
      fetchPolicy: 'cache-first',
      errorPolicy: 'ignore',
    }
  );

  // Homecast-managed automations — only fetch when section is expanded
  const { data: hcData, loading: hcLoading, refetch: hcRefetch } = useQuery(HC_AUTOMATIONS, {
    variables: { homeId },
    skip: !homeId || !expanded || !!demoAutomations,
    fetchPolicy: 'cache-first',
    errorPolicy: 'all',
  });

  const rawAutomations = demoAutomations ?? (data?.automations || []);
  const relayNeedsUpdate = rawAutomations.some(a => a.id === '__relay_update_required__');
  const automations = relayNeedsUpdate ? [] : rawAutomations;

  const hcAutomations = useMemo(() => {
    const entities = hcData?.hcAutomations || [];
    return entities.map((e: { entityId: string; dataJson: string; updatedAt: string }) => {
      try {
        return JSON.parse(e.dataJson) as Automation;
      } catch {
        return { id: e.entityId, name: 'Unnamed', enabled: true } as Automation;
      }
    });
  }, [hcData]);

  const isLoading = loading || hcLoading;
  const totalCount = automations.length + hcAutomations.length;
  const hasContent = totalCount > 0 || relayNeedsUpdate;
  // Hide (but don't unmount) if query completed with nothing to show.
  // Unmounting (return null) would kill any open dialog state.
  const hidden = !isLoading && !hasContent;

  const handleCardClick = (automation: HomeKitAutomation) => {
    setSelectedAutomation(automation);
    setDetailOpen(true);
  };

  const handleEdit = () => {
    setDetailOpen(false);
    setEditingAutomation(selectedAutomation);
    setTimeout(() => setFormOpen(true), 150);
  };

  const handleSaved = () => {
    refetch();
    setFormOpen(false);
    setEditingAutomation(null);
  };

  const handleDeleted = () => {
    refetch();
    setSelectedAutomation(null);
  };

  const handleHcAutomationClick = (automation: Automation) => {
    setEditingHcAutomation(automation);
    setEditorOpen(true);
  };

  const handleToggleHcAutomation = async (automation: Automation) => {
    const updated = { ...automation, enabled: !automation.enabled };
    try {
      await saveHcAutomation({
        variables: { homeId, automationId: automation.id, data: JSON.stringify(updated) },
      });
      hcRefetch();
    } catch {
      toast.error('Failed to update');
    }
  };

  return (
    <>
      {/* Header */}
      <div className={`flex items-center gap-2 ${compact ? 'mb-1.5 mt-1' : 'mb-3 mt-2'} ${hidden ? 'hidden' : ''}`}>
        <button
          onClick={() => !isLoading && setExpanded(!expanded)}
          className={`flex items-center gap-1 text-sm font-semibold selectable text-left transition-opacity hover:opacity-100 ${isDarkBackground ? 'text-white/70 hover:text-white' : 'text-muted-foreground/70 hover:text-muted-foreground'}`}
        >
          Automations{!hideAccessoryCounts && totalCount > 0 ? ` (${totalCount})` : ''}
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          )}
        </button>
      </div>

      <AnimatedCollapse open={expanded && !hidden}>
        <div className={compact ? 'mb-3' : 'mb-6'}>
          {relayNeedsUpdate && (
            <p className={`text-xs mb-2 ${isDarkBackground ? 'text-white/40' : 'text-muted-foreground/50'}`}>
              HomeKit automations require a relay update. Homecast automations are unaffected.
            </p>
          )}
          <div className={
            compact
              ? 'grid items-start gap-2 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]'
              : 'grid items-start gap-4 grid-cols-[repeat(auto-fill,minmax(320px,1fr))]'
          }>
            {/* HomeKit native automations */}
            {automations.map(automation => (
              <AutomationCard
                key={automation.id}
                automation={automation}
                onClick={() => handleCardClick(automation)}
                onUpdated={() => refetch()}
                compact={compact}
                isDarkBackground={isDarkBackground}
              />
            ))}

            {/* Homecast-managed automations */}
            {hcAutomations.map((hc: Automation) => (
              <AutomationCard
                key={`hc-${hc.id}`}
                hcAutomation={hc}
                onClick={() => handleHcAutomationClick(hc)}
                onToggle={() => handleToggleHcAutomation(hc)}
                compact={compact}
                isDarkBackground={isDarkBackground}
              />
            ))}

            {/* New automation button — same height as cards */}
            <button
              type="button"
              data-testid="new-automation-button"
              onClick={() => setNewTypeOpen(true)}
              className={`w-full flex items-center justify-center gap-1.5 rounded-[20px] border-2 border-dashed transition-colors ${compact ? 'p-2.5' : 'p-4'} ${
                isDarkBackground
                  ? 'border-white/15 text-white/40 hover:border-white/30 hover:text-white/60'
                  : 'border-muted-foreground/20 text-muted-foreground/50 hover:border-muted-foreground/40 hover:text-muted-foreground'
              }`}
            >
              <Plus className={`${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} />
              <span className={`${compact ? 'text-xs' : 'text-sm'}`}>New</span>
            </button>
          </div>
        </div>
      </AnimatedCollapse>

      {/* Detail dialog */}
      {selectedAutomation && (
        <AutomationDetailDialog
          open={detailOpen}
          onOpenChange={setDetailOpen}
          automation={selectedAutomation}
          onEdit={handleEdit}
          onDeleted={handleDeleted}
          onUpdated={() => refetch()}
        />
      )}

      {/* Create/Edit HomeKit automation dialog */}
      <AutomationFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        homeId={homeId}
        automation={editingAutomation}
        onSaved={handleSaved}
      />

      {/* Homecast flow editor dialog */}
      <AutomationEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        homeId={homeId}
        existingAutomation={editingHcAutomation}
        onSaved={() => {
          hcRefetch();
          setEditorOpen(false);
        }}
        onDelete={async (id) => {
          await deleteHcAutomation({ variables: { automationId: id } });
          hcRefetch();
          toast.success('Automation deleted');
        }}
      />

      {/* New automation type picker dialog */}
      <Dialog open={newTypeOpen} onOpenChange={setNewTypeOpen}>
        <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogTitle className="px-5 pt-5 pb-2 text-base font-semibold">Create New Automation</DialogTitle>
          <div className="grid grid-cols-2 gap-3 px-5 pb-5">
            {/* HomeKit option */}
            <button
              type="button"
              data-testid="new-homekit-automation"
              disabled={relayNeedsUpdate}
              onClick={() => { setNewTypeOpen(false); setEditingAutomation(null); setFormOpen(true); }}
              className={`flex flex-col items-center text-center rounded-xl border p-4 transition-all ${
                relayNeedsUpdate
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:border-primary/40 hover:shadow-sm'
              }`}
            >
              <img src="/homekit_logo.png" alt="HomeKit" className="h-10 w-10 mb-3" />
              <div className="text-sm font-semibold mb-1">HomeKit</div>
              <p className="text-[11px] text-muted-foreground mb-3">
                Simple trigger and action rules that run natively on your Apple Home hub.
              </p>
              <ul className="text-[11px] text-muted-foreground space-y-1 text-left w-full">
                <li className="flex items-start gap-1.5"><Check className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground/60" /> Runs on Apple Home hub</li>
                <li className="flex items-start gap-1.5"><Check className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground/60" /> Single trigger and action</li>
                <li className="flex items-start gap-1.5"><Check className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground/60" /> Time and device triggers</li>
                <li className="flex items-start gap-1.5"><Check className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground/60" /> Works without relay</li>
              </ul>
              <Button variant="outline" size="sm" className="mt-4 w-full" disabled={relayNeedsUpdate}>
                {relayNeedsUpdate ? 'Relay update required' : 'Create'}
              </Button>
            </button>

            {/* Homecast option */}
            <button
              type="button"
              data-testid="new-advanced-automation"
              onClick={() => { setNewTypeOpen(false); setEditingHcAutomation(undefined); setEditorOpen(true); }}
              className="flex flex-col items-center text-center rounded-xl border p-4 transition-all hover:border-primary/40 hover:shadow-sm"
            >
              <img src="/icon-192.png" alt="Homecast" className="h-10 w-10 rounded-lg mb-3" />
              <div className="text-sm font-semibold mb-1">Homecast</div>
              <p className="text-[11px] text-muted-foreground mb-3">
                Visual flow editor with multiple triggers, conditions, logic, and actions.
              </p>
              <ul className="text-[11px] text-muted-foreground space-y-1 text-left w-full">
                <li className="flex items-start gap-1.5"><Check className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground/60" /> Runs on Homecast Relay</li>
                <li className="flex items-start gap-1.5"><Check className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground/60" /> Multiple triggers and actions</li>
                <li className="flex items-start gap-1.5"><Check className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground/60" /> IF/ELSE logic and conditions</li>
                <li className="flex items-start gap-1.5"><Check className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground/60" /> HTTP requests and webhooks</li>
              </ul>
              <Button variant="outline" size="sm" className="mt-4 w-full">Create</Button>
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
