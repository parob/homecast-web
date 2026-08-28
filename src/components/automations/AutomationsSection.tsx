import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { AnimatedCollapse } from '@/components/ui/animated-collapse';
import { Plus, ChevronRight, Check } from 'lucide-react';
import { useLayoutEdit } from '@/contexts/LayoutEditContext';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AutomationCard } from './AutomationCard';
import { AutomationDetailDialog } from './AutomationDetailDialog';
import { AutomationFormDialog } from './AutomationFormDialog';
// Lazy: pulls in the whole flow editor (@xyflow/react) — only load once the user opens it
const AutomationEditorDialog = lazy(() => import('@/components/automation-editor/AutomationEditorDialog'));
import { GET_AUTOMATIONS, HC_AUTOMATIONS } from '@/lib/graphql/queries';
import { useRelayCannotEdit } from '@/hooks/useRelayCannotEdit';
import { DraggableGrid } from '@/components/shared/DraggableGrid';
import { SortableItem } from '@/components/shared/SortableItem';
import { DragHandleArea } from '@/components/shared/DragHandleArea';
import {
  applyAutomationCardOrder,
  automationCardKey,
  isAutomationVisible,
} from '@/lib/automation-cards';
import { SAVE_HC_AUTOMATION, DELETE_HC_AUTOMATION } from '@/lib/graphql/mutations';
import type { HomeKitAutomation, GetAutomationsResponse, HomeLayoutData } from '@/lib/graphql/types';
import type { Automation } from '@/automation/types/automation';

/** StoredEntityInfo rows as the HC_AUTOMATIONS document selects them. */
interface HcEntity {
  entityId: string;
  dataJson: string;
  updatedAt: string;
}

interface AutomationsSectionProps {
  homeId: string;
  compact?: boolean;
  isDarkBackground?: boolean;
  /** Controlled expansion (pill in the summary row drives it). */
  open: boolean;
  // When set, render this fixed list instead of fetching real automations.
  // Used by the tutorial demo flow so the Automations step always has rows.
  demoAutomations?: HomeKitAutomation[];
  /** The home's stored arrangement and hidden list. */
  homeLayout?: HomeLayoutData | null;
  /** Persist the card arrangement. Absent where the layout can't be written. */
  onReorderCards?: (order: string[]) => void;
  /** Turn one automation's card off for this home, or back on. */
  onToggleAutomationHidden?: (key: string, visible: boolean) => void;
  /**
   * The desktop "Show Hidden Items" toggle. Desktop has no Edit Layout to
   * enter, so this is the only thing that can put a hidden automation back on
   * screen to be right-clicked.
   */
  showHidden?: boolean;
}

/**
 * Compact bubble button for the sensor-summary row. Toggles the
 * AutomationsSection content rendered elsewhere on the page.
 */
export function AutomationsPill({ homeId, open, onToggle, isDarkBackground, hideAccessoryCounts, demoAutomations }: {
  homeId: string;
  open: boolean;
  onToggle: () => void;
  isDarkBackground?: boolean;
  /** The "Show counts" display setting, inverted. Same toggle the sidebar obeys. */
  hideAccessoryCounts?: boolean;
  demoAutomations?: HomeKitAutomation[];
}) {
  const { data } = useQuery<GetAutomationsResponse>(GET_AUTOMATIONS, {
    variables: { homeId },
    skip: !homeId || !!demoAutomations,
    fetchPolicy: 'cache-first',
    errorPolicy: 'ignore',
  });
  const { data: hcData } = useQuery<{ hcAutomations: HcEntity[] }>(HC_AUTOMATIONS, {
    variables: { homeId },
    skip: !homeId || !!demoAutomations,
    fetchPolicy: 'cache-first',
    errorPolicy: 'all',
  });
  const raw = demoAutomations ?? (data?.automations || []);
  const relayNeedsUpdate = raw.some(a => a.id === '__relay_update_required__');
  const hkCount = relayNeedsUpdate ? 0 : raw.length;
  const hcCount = (hcData?.hcAutomations || []).length;
  // Always render for a real home — hiding at zero made the section (and the
  // "Create" button inside it) unreachable, so a home with no automations had no
  // way to create its first one.
  const count = hkCount + hcCount;
  if (!homeId && !demoAutomations) return null;

  return (
    <button
      type="button"
      data-tour="automations"
      onClick={onToggle}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
        isDarkBackground
          ? (open ? 'bg-white/25 text-white' : 'bg-black/25 text-white/90 hover:bg-black/35')
          : (open ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground hover:bg-muted/80')
      }`}
    >
      <span>Automations{!hideAccessoryCounts && count > 0 ? ` ${count}` : ''}</span>
      <ChevronRight className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} />
    </button>
  );
}

/** One cell of the Automations grid, from whichever engine owns it. */
type AutomationCard =
  | { kind: 'hk'; id: string; automation: HomeKitAutomation }
  | { kind: 'hc'; id: string; hc: Automation };

const cardKey = (c: AutomationCard) => automationCardKey(c.kind, c.id);

export function AutomationsSection({
  homeId, compact, isDarkBackground, open: expanded, demoAutomations,
  homeLayout, onReorderCards, onToggleAutomationHidden, showHidden,
}: AutomationsSectionProps) {
  const { editMode, touchMode } = useLayoutEdit();
  /**
   * The arrangement you just dragged, held until the saved one catches up.
   *
   * Not a nicety — see the same field in ScenesSection for why the drop
   * animation lands in the wrong place without it.
   */
  const [optimisticOrder, setOptimisticOrder] = useState<string[] | null>(null);
  const [selectedAutomation, setSelectedAutomation] = useState<HomeKitAutomation | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<HomeKitAutomation | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  // Once opened, stays mounted so the close animation still plays
  const [editorMounted, setEditorMounted] = useState(false);
  const openEditor = () => { setEditorMounted(true); setEditorOpen(true); };
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
  const { data: hcData, loading: hcLoading, refetch: hcRefetch } = useQuery<{ hcAutomations: HcEntity[] }>(HC_AUTOMATIONS, {
    variables: { homeId },
    skip: !homeId || !expanded || !!demoAutomations,
    fetchPolicy: 'cache-first',
    errorPolicy: 'all',
  });

  const rawAutomations = demoAutomations ?? (data?.automations || []);
  const relayNeedsUpdate = rawAutomations.some(a => a.id === '__relay_update_required__');
  const automations = relayNeedsUpdate ? [] : rawAutomations;

  // Proactive: relay's Apple ID is view-only in this home (undefined = unknown/old relay).
  // Demo data has no relay behind it, so the check is skipped there.
  const relayCannotEdit = useRelayCannotEdit(demoAutomations ? undefined : homeId);

  const hcAutomations = useMemo(() => {
    const entities = hcData?.hcAutomations || [];
    return entities.map((e) => {
      try {
        return JSON.parse(e.dataJson) as Automation;
      } catch {
        return { id: e.entityId, name: 'Unnamed', enabled: true } as Automation;
      }
    });
  }, [hcData]);

  /**
   * The two engines' automations as one ordered, filtered list.
   *
   * They share a grid and an order but no id space — a HomeKit automation id is
   * a UUID, a Homecast one is an engine id — so the key is prefixed. Same shape
   * as the Scenes grid; see lib/automation-cards.ts.
   */
  const hiddenAutomations = homeLayout?.visibility?.hiddenAutomations;
  const savedOrder = homeLayout?.automationCardOrder;
  const cards = useMemo(() => {
    const all: AutomationCard[] = [
      ...automations.map(a => ({ kind: 'hk' as const, id: a.id, automation: a })),
      ...hcAutomations.map(hc => ({ kind: 'hc' as const, id: hc.id, hc })),
    ];
    // You cannot bring back what you cannot see, and hiding is only offered on
    // the card itself — so whatever reveals hidden cards is what makes unhiding
    // reachable at all. Touch reveals by entering Edit Layout; desktop never
    // enters that mode and reveals with Show Hidden Items instead.
    const reveal = editMode || !!showHidden;
    const visible = reveal
      ? all
      : all.filter(c => isAutomationVisible(hiddenAutomations, cardKey(c)));
    return applyAutomationCardOrder(visible, optimisticOrder ?? savedOrder, cardKey);
  }, [automations, hcAutomations, hiddenAutomations, savedOrder, optimisticOrder, editMode, showHidden]);

  // Let go once the saved order is the source of truth again.
  useEffect(() => { setOptimisticOrder(null); }, [savedOrder]);

  const itemIds = cards.map(cardKey);
  // The tutorial's fixed list is not the user's to rearrange.
  const canReorder = !demoAutomations && !!onReorderCards;

  const isLoading = loading || hcLoading;
  const totalCount = automations.length + hcAutomations.length;
  // Note: deliberately NOT hidden when empty. The section holds the only "Create"
  // button, so collapsing it at zero left no way to create a first automation.
  const isEmpty = !isLoading && totalCount === 0 && !relayNeedsUpdate;

  const renderCard = (card: AutomationCard) => {
    const key = cardKey(card);
    const hidden = !isAutomationVisible(hiddenAutomations, key);
    const onToggleHidden = onToggleAutomationHidden && !demoAutomations
      ? () => onToggleAutomationHidden(key, hidden)
      : undefined;
    return card.kind === 'hk' ? (
      <AutomationCard
        automation={card.automation}
        onClick={() => handleCardClick(card.automation)}
        onUpdated={() => refetch()}
        editMode={editMode}
        touchMode={touchMode}
        compact={compact}
        isDarkBackground={isDarkBackground}
        isHidden={hidden}
        onToggleHidden={onToggleHidden}
      />
    ) : (
      <AutomationCard
        hcAutomation={card.hc}
        onClick={() => handleHcAutomationClick(card.hc)}
        onToggle={() => handleToggleHcAutomation(card.hc)}
        editMode={editMode}
        touchMode={touchMode}
        compact={compact}
        isDarkBackground={isDarkBackground}
        isHidden={hidden}
        onToggleHidden={onToggleHidden}
      />
    );
  };

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
    openEditor();
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
      <AnimatedCollapse open={expanded}>
        <div className={compact ? 'mb-3' : 'mb-6'}>
          {relayNeedsUpdate && (
            <p className={`text-xs mb-2 ${isDarkBackground ? 'text-white/40' : 'text-muted-foreground/50'}`}>
              HomeKit automations require a relay update. Homecast automations are unaffected.
            </p>
          )}
          {/* No notice here: the HomeKit option below is already disabled and
              labelled "View-only", so a paragraph restating it is noise. The
              fix lives in Settings → the home, where you can act on it. */}
          {isEmpty && (
            <p className={`text-xs mb-2 ${isDarkBackground ? 'text-white/40' : 'text-muted-foreground/50'}`}>
              No automations yet. Automations run your home for you — on a schedule, when a device
              changes, or on logic Apple Home can't express.
            </p>
          )}
          {/* Wider minimum track than the scenes grid: automation names are
              descriptive sentences, and the card also carries a trigger summary,
              a toggle and a delete button on the same row. */}
          <DraggableGrid
            itemIds={itemIds}
            onReorder={(order) => { setOptimisticOrder(order); onReorderCards?.(order); }}
            enabled={canReorder}
            touchMode={touchMode}
            renderDragOverlay={(activeId) => {
              const card = cards.find(c => cardKey(c) === activeId);
              return card ? <div className="w-full opacity-90">{renderCard(card)}</div> : null;
            }}
          >
          <div className={
            compact
              ? 'grid items-start gap-2 grid-cols-[repeat(auto-fill,minmax(210px,1fr))]'
              : 'grid items-start gap-4 grid-cols-[repeat(auto-fill,minmax(360px,1fr))]'
          }>
            {cards.map(card => (
              <SortableItem key={cardKey(card)} id={cardKey(card)} disabled={!canReorder}>
                <DragHandleArea>{renderCard(card)}</DragHandleArea>
              </SortableItem>
            ))}

            {/* New automation button — same height as cards. Creating is not
                arranging: it would add a card to the grid you are rearranging.
                Outside the SortableItems, and last in an auto-fill grid, so
                removing it moves nothing that is being dragged. */}
            {!editMode && <button
              type="button"
              data-testid="new-automation-button"
              onClick={() => setNewTypeOpen(true)}
              className={`w-full flex items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed transition-colors ${compact ? 'p-2.5' : 'p-4'} ${
                isDarkBackground
                  ? 'border-white/15 text-white/40 hover:border-white/30 hover:text-white/60'
                  : 'border-muted-foreground/20 text-muted-foreground/50 hover:border-muted-foreground/40 hover:text-muted-foreground'
              }`}
            >
              <Plus className={`${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} />
              <span className={`${compact ? 'text-xs' : 'text-sm'}`}>Create</span>
            </button>}
          </div>
          </DraggableGrid>
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
      {editorMounted && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}

      {/* New automation type picker dialog */}
      <Dialog open={newTypeOpen} onOpenChange={setNewTypeOpen}>
        <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogTitle className="px-5 pt-5 pb-2 text-base font-semibold">Create Automation</DialogTitle>
          <div className="grid grid-cols-2 gap-3 px-5 pb-5">
            {/* HomeKit option */}
            <button
              type="button"
              data-testid="new-homekit-automation"
              disabled={relayNeedsUpdate || relayCannotEdit}
              onClick={() => { setNewTypeOpen(false); setEditingAutomation(null); setFormOpen(true); }}
              className={`flex flex-col items-center text-center rounded-xl border p-4 transition-all ${
                relayNeedsUpdate || relayCannotEdit
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
              <Button variant="outline" size="sm" className="mt-4 w-full" disabled={relayNeedsUpdate || relayCannotEdit}>
                {relayNeedsUpdate ? 'Relay update required' : relayCannotEdit ? 'View-only' : 'Create'}
              </Button>
            </button>

            {/* Homecast option */}
            <button
              type="button"
              data-testid="new-advanced-automation"
              onClick={() => { setNewTypeOpen(false); setEditingHcAutomation(undefined); openEditor(); }}
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
