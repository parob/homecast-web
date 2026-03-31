import { useState } from 'react';
import { useMutation } from '@apollo/client/react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Pencil, Trash2, Clock, Zap, Sunrise, MapPin, User } from 'lucide-react';
import { AutomationTriggerSummary } from './AutomationTriggerSummary';
import { charLabel, formatValue } from './format';
import { DELETE_AUTOMATION, SET_AUTOMATION_ENABLED } from '@/lib/graphql/mutations';
import type { HomeKitAutomation, DeleteAutomationResponse, SetAutomationEnabledResponse } from '@/lib/graphql/types';

interface AutomationDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  automation: HomeKitAutomation;
  onEdit: () => void;
  onDeleted: () => void;
  onUpdated: () => void;
}

function getTriggerIcon(trigger: HomeKitAutomation['trigger']) {
  if (trigger.type === 'timer') return <Clock className="h-4 w-4 text-blue-500" />;
  const event = trigger.events?.[0];
  if (!event) return <Zap className="h-4 w-4 text-amber-500" />;
  switch (event.type) {
    case 'significantTime': return <Sunrise className="h-4 w-4 text-orange-500" />;
    case 'location': return <MapPin className="h-4 w-4 text-green-500" />;
    case 'presence': return <User className="h-4 w-4 text-purple-500" />;
    case 'calendar': return <Clock className="h-4 w-4 text-blue-500" />;
    default: return <Zap className="h-4 w-4 text-amber-500" />;
  }
}

function isReadOnlyTrigger(trigger: HomeKitAutomation['trigger']): boolean {
  const event = trigger.events?.[0];
  return event?.type === 'location' || event?.type === 'presence';
}

export function AutomationDetailDialog({ open, onOpenChange, automation, onEdit, onDeleted, onUpdated }: AutomationDetailDialogProps) {
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [optimisticEnabled, setOptimisticEnabled] = useState<boolean | null>(null);

  const [deleteAutomation, { loading: deleting }] = useMutation<DeleteAutomationResponse>(DELETE_AUTOMATION);
  const [setEnabled] = useMutation<SetAutomationEnabledResponse>(SET_AUTOMATION_ENABLED);

  const isEnabled = optimisticEnabled ?? automation.isEnabled;

  const handleDelete = async () => {
    try {
      await deleteAutomation({ variables: { automationId: automation.id, homeId: automation.homeId } });
      setDeleteConfirm(false);
      onOpenChange(false);
      onDeleted();
    } catch (error) {
      console.error('Failed to delete automation:', error);
    }
  };

  const handleToggleEnabled = async (checked: boolean) => {
    setOptimisticEnabled(checked);
    try {
      await setEnabled({ variables: { automationId: automation.id, enabled: checked, homeId: automation.homeId } });
      onUpdated();
    } catch (error) {
      console.error('Failed to toggle automation:', error);
      setOptimisticEnabled(null);
    }
  };

  const actions = automation.actions ?? [];
  const trigger = automation.trigger;
  const conditions = trigger?.conditions ?? [];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col p-0 gap-0 [&>button]:hidden">
          {/* Header */}
          <div className="shrink-0 px-6 pt-6 pb-3">
            <div className="flex items-start gap-3">
              <DialogTitle className="text-base font-semibold leading-tight flex-1 min-w-0">
                {automation.name}
              </DialogTitle>
              <div className="shrink-0 pt-0.5">
                <Switch checked={isEnabled} onCheckedChange={handleToggleEnabled} />
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-4">
            {/* Trigger section */}
            <div className="rounded-xl bg-muted/30 p-3 space-y-1">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Trigger</p>
              <div className="flex items-center gap-2">
                {trigger && getTriggerIcon(trigger)}
                <span className="text-sm font-medium">
                  {trigger && <AutomationTriggerSummary trigger={trigger} compact automationName={automation.name} />}
                </span>
              </div>
              {trigger?.timeZone && (
                <p className="text-[10px] text-muted-foreground ml-6">{trigger.timeZone}</p>
              )}
            </div>

            {/* Conditions section */}
            {conditions.length > 0 && (
              <div className="rounded-xl bg-muted/30 p-3 space-y-1">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Conditions</p>
                {conditions.map((cond, i) => (
                  <div key={i} className="text-sm">
                    {cond.type === 'characteristic' && cond.accessoryName && (
                      <span>{cond.accessoryName} {charLabel(cond.characteristicType || '')} {cond.operator === 'equalTo' ? '=' : cond.operator === 'lessThan' ? '<' : '>'} {formatValue(cond.value, cond.characteristicType || undefined)}</span>
                    )}
                    {cond.type === 'time' && (
                      <span>{cond.afterTime ? `After ${(() => { try { const t = JSON.parse(cond.afterTime); return `${t.hour}:${String(t.minute).padStart(2,'0')}`; } catch { return cond.afterTime; } })()}` : ''}{cond.beforeTime ? `Before ${(() => { try { const t = JSON.parse(cond.beforeTime); return `${t.hour}:${String(t.minute).padStart(2,'0')}`; } catch { return cond.beforeTime; } })()}` : ''}</span>
                    )}
                    {cond.type === 'significantEvent' && (
                      <span>{cond.afterEvent ? `After ${cond.afterEvent}` : `Before ${cond.beforeEvent}`}</span>
                    )}
                    {cond.type === 'unknown' && cond.predicateFormat && (
                      <span className="text-xs text-muted-foreground">{cond.predicateFormat}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Actions section */}
            <div className="rounded-xl bg-muted/30 p-3 space-y-1.5">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Actions ({actions.length})</p>
              {actions.map((action, i) => {
                const value = formatValue(action.targetValue, action.characteristicType);
                return (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="truncate font-medium">{action.accessoryName}</span>
                    <span className="text-muted-foreground whitespace-nowrap ml-2">
                      {charLabel(action.characteristicType)} {value}
                    </span>
                  </div>
                );
              })}
              {actions.length === 0 && (
                <p className="text-xs text-muted-foreground">No actions</p>
              )}
            </div>

            {/* Scene note */}
            {actions.length > 0 && (
              <p className="text-[10px] text-muted-foreground">
                These actions run via a HomeKit scene. This scene may appear in your Apple Home app — this is a platform requirement for third-party automations.
              </p>
            )}

            {/* Activation state */}
            {trigger?.activationState && trigger.activationState !== 'enabled' && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {trigger.activationState === 'disabledNoHomeHub' && 'Requires a home hub (Apple TV or HomePod)'}
                {trigger.activationState === 'disabledNoCompatibleHomeHub' && 'Requires a compatible home hub'}
                {trigger.activationState === 'disabledNoLocationServices' && 'Requires location services'}
              </p>
            )}

            {/* Last run */}
            {automation.lastFireDate && (
              <p className="text-[10px] text-muted-foreground">
                Last run {new Date(automation.lastFireDate).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            )}
          </div>

          {/* Footer — Edit + Delete together, Close on other side */}
          <DialogFooter className="shrink-0 px-6 pb-6 pt-2 flex-row justify-between sm:justify-between">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
            <div className="flex gap-2">
              {!isReadOnlyTrigger(trigger) && (
                <Button variant="outline" size="sm" onClick={onEdit}>
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  Edit
                </Button>
              )}
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteConfirm(true)}>
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Delete
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteConfirm} onOpenChange={setDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete automation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove "{automation.name}" from HomeKit. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
