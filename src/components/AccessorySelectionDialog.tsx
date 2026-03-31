import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Check } from 'lucide-react';
import { AccessoryPicker } from '@/components/AccessoryPicker';
import type { HomeKitAccessory, HomeKitHome, HomeKitServiceGroup } from '@/lib/graphql/types';

/** Compute how many "slots" the current selection uses.
 *  Each selected service group = 1 slot. Each individual accessory (not in a selected group) = 1 slot. */
function computeUsedSlots(
  selectedIds: Set<string>,
  selectedGroupIds: Set<string>,
  serviceGroups: HomeKitServiceGroup[],
): number {
  const groupCoveredIds = new Set<string>();
  for (const group of serviceGroups) {
    if (selectedGroupIds.has(group.id)) {
      for (const id of group.accessoryIds) groupCoveredIds.add(id);
    }
  }
  let individualCount = 0;
  for (const id of selectedIds) {
    if (!groupCoveredIds.has(id)) individualCount++;
  }
  return selectedGroupIds.size + individualCount;
}

interface AccessorySelectionDialogProps {
  open: boolean;
  onSave: (selectedIds: string[], selectedServiceGroupIds: string[]) => Promise<void>;
  limit: number;
  allAccessories: HomeKitAccessory[];
  homes: HomeKitHome[];
  initialSelection?: string[];
  initialServiceGroupSelection?: string[];
  onCancel?: () => void;
  serviceGroups?: HomeKitServiceGroup[];
}

export const AccessorySelectionDialog = memo(function AccessorySelectionDialog({
  open,
  onSave,
  limit,
  allAccessories,
  homes,
  initialSelection,
  initialServiceGroupSelection,
  onCancel,
  serviceGroups = [],
}: AccessorySelectionDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedServiceGroupIds, setSelectedServiceGroupIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // Ref so state updater callbacks can read the latest group selection
  const selectedServiceGroupIdsRef = useRef(selectedServiceGroupIds);
  useEffect(() => { selectedServiceGroupIdsRef.current = selectedServiceGroupIds; }, [selectedServiceGroupIds]);

  const usedSlots = useMemo(
    () => computeUsedSlots(selectedIds, selectedServiceGroupIds, serviceGroups),
    [selectedIds, selectedServiceGroupIds, serviceGroups],
  );

  const serviceGroupHomeMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of serviceGroups) {
      if (group.homeId) map.set(group.id, group.homeId);
    }
    return map;
  }, [serviceGroups]);

  // Initialize selection from props
  useEffect(() => {
    if (initialSelection && initialSelection.length > 0) {
      const ids = new Set(initialSelection);
      setSelectedIds(ids);
      // Use explicit service group selection if provided, otherwise derive from accessory IDs
      if (initialServiceGroupSelection && initialServiceGroupSelection.length > 0) {
        setSelectedServiceGroupIds(new Set(initialServiceGroupSelection));
      } else {
        const groupIds = new Set<string>();
        for (const group of serviceGroups) {
          if (group.accessoryIds.length > 0 && group.accessoryIds.every(id => ids.has(id))) {
            groupIds.add(group.id);
          }
        }
        setSelectedServiceGroupIds(groupIds);
      }
    } else {
      setSelectedIds(new Set());
      setSelectedServiceGroupIds(new Set());
    }
  }, [initialSelection, initialServiceGroupSelection, open, serviceGroups]);

  const toggleAccessory = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        // This is an individual accessory (not in a group row), so adding costs 1 slot
        const currentSlots = computeUsedSlots(prev, selectedServiceGroupIdsRef.current, serviceGroups);
        if (currentSlots >= limit) return prev;
        next.add(id);
      }
      return next;
    });
  }, [limit, serviceGroups]);

  const toggleServiceGroup = useCallback((groupId: string) => {
    const group = serviceGroups.find(g => g.id === groupId);
    if (!group) return;

    setSelectedServiceGroupIds(prev => {
      const next = new Set(prev);
      const wasSelected = next.has(groupId);

      if (wasSelected) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }

      // Update individual accessory IDs accordingly
      setSelectedIds(prevIds => {
        const nextIds = new Set(prevIds);
        if (wasSelected) {
          for (const id of group.accessoryIds) nextIds.delete(id);
        } else {
          // Adding a group costs 1 slot — check slot-based limit
          const tentativeSlots = computeUsedSlots(prevIds, next, serviceGroups);
          if (tentativeSlots > limit) {
            next.delete(groupId);
            return prevIds;
          }
          for (const id of group.accessoryIds) nextIds.add(id);
        }
        return nextIds;
      });

      return next;
    });
  }, [serviceGroups, limit]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onSave(Array.from(selectedIds), Array.from(selectedServiceGroupIds));
    } finally {
      setSaving(false);
    }
  }, [selectedIds, selectedServiceGroupIds, onSave]);

  // Dialog is non-dismissable when there's no existing selection (first-time setup)
  const canDismiss = initialSelection && initialSelection.length > 0;

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen && canDismiss) {
      onCancel?.();
    }
  }, [onCancel, canDismiss]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-[95%] sm:max-w-[500px] max-h-[85vh] flex flex-col p-0 gap-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={canDismiss ? undefined : (e) => e.preventDefault()}
        onEscapeKeyDown={canDismiss ? undefined : (e) => e.preventDefault()}
        onInteractOutside={canDismiss ? undefined : (e) => e.preventDefault()}
        hideCloseButton={!canDismiss}
      >
        <DialogHeader className="shrink-0 px-6 pt-6 pb-3">
          <DialogTitle>Select Your Accessories</DialogTitle>
          <DialogDescription>
            Your free plan includes {limit} accessories. Choose which ones you'd like to include.
          </DialogDescription>
        </DialogHeader>
        <AccessoryPicker
          accessories={allAccessories}
          homes={homes}
          selectedIds={selectedIds}
          onToggle={toggleAccessory}
          limit={limit}
          usedSlots={usedSlots}
          serviceGroups={serviceGroups}
          selectedServiceGroupIds={selectedServiceGroupIds}
          onToggleServiceGroup={toggleServiceGroup}
          serviceGroupHomeMap={serviceGroupHomeMap}
        />
        <DialogFooter className="shrink-0 px-6 pb-6 pt-2 border-t">
          <div className="flex gap-2 w-full justify-end">
            {canDismiss && onCancel && (
              <Button variant="outline" onClick={onCancel} disabled={saving}>
                Cancel
              </Button>
            )}
            <Button onClick={handleSave} disabled={saving || selectedIds.size === 0}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
              Save ({usedSlots}/{limit})
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
