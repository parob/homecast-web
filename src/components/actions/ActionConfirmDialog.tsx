import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { HomeAction } from './catalog';

const CONFIRM_DESCRIPTION_ID = 'home-action-confirm-description';

/**
 * The gate in front of an action that carries a `confirm` — arming security,
 * turning the whole house off.
 *
 * Shared so the Actions grid and the pinned tab bar ask the same question the
 * same way; an action reachable from two places must not be guarded in one and
 * not the other.
 *
 * Mounted only while there is something to confirm, so the content always
 * carries a real title and description.
 *
 * `aria-describedby` is passed explicitly because the shared AlertDialogContent
 * hard-codes it to `undefined` — shadcn's opt-out for dialogs that have no
 * description, which also detaches the ones that do. Naming the id here
 * reconnects it without changing every other AlertDialog in the app.
 */
export function ActionConfirmDialog({ action, onCancel, onConfirm }: {
  /** The action awaiting confirmation, or null when nothing is pending. */
  action: HomeAction | null;
  onCancel: () => void;
  onConfirm: (action: HomeAction) => void;
}) {
  if (!action) return null;

  return (
    <AlertDialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent aria-describedby={CONFIRM_DESCRIPTION_ID}>
        <AlertDialogHeader>
          <AlertDialogTitle>{action.label}?</AlertDialogTitle>
          <AlertDialogDescription id={CONFIRM_DESCRIPTION_ID}>{action.confirm}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm(action);
            }}
          >
            {action.label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
