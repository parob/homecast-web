import { createContext, useContext } from 'react';
import type { VirtualAccessoryDefinition } from '@/automation/types/automation';

/**
 * How a widget offers "edit this accessory" and "delete this accessory".
 *
 * Passed by context rather than as props because there are 28 widget
 * components and a virtual accessory can render through any of them — a virtual
 * switch really does go through SwitchWidget. Threading a prop meant 28 places
 * to remember, and the first attempt wired exactly one of them, so Edit was
 * missing from every virtual accessory that wasn't a mode, counter or timer.
 *
 * WidgetCard asks this for an editor and shows the entry if it gets one, so a
 * new widget inherits the behaviour without doing anything.
 */
export interface VirtualAccessoryActions {
  /** Opens the configuration dialog, or undefined if this isn't a virtual accessory. */
  edit: (accessoryId: string) => (() => void) | undefined;
  /** Asks to delete it, or undefined if this isn't a virtual accessory. */
  remove: (accessoryId: string) => (() => void) | undefined;
  /**
   * The stored definition, or undefined if this isn't a virtual accessory.
   *
   * Configuration — a timer's duration, a number's bounds — belongs to the
   * definition the browser already holds, not to the relay. Reading it here
   * means a tile can render correctly even while the relay's own bundle is out
   * of date, which is the normal state of affairs right after a deploy.
   */
  definition: (accessoryId: string) => VirtualAccessoryDefinition | undefined;
}

const NONE: VirtualAccessoryActions = {
  edit: () => undefined, remove: () => undefined, definition: () => undefined,
};

const VirtualAccessoryActionsContext = createContext<VirtualAccessoryActions>(NONE);

export const VirtualAccessoryEditProvider = VirtualAccessoryActionsContext.Provider;

export function useVirtualAccessoryEditor(accessoryId?: string): (() => void) | undefined {
  const { edit } = useContext(VirtualAccessoryActionsContext);
  return accessoryId ? edit(accessoryId) : undefined;
}

export function useVirtualAccessoryRemover(accessoryId?: string): (() => void) | undefined {
  const { remove } = useContext(VirtualAccessoryActionsContext);
  return accessoryId ? remove(accessoryId) : undefined;
}

export function useVirtualAccessoryDefinition(
  accessoryId?: string,
): VirtualAccessoryDefinition | undefined {
  const { definition } = useContext(VirtualAccessoryActionsContext);
  return accessoryId ? definition(accessoryId) : undefined;
}
