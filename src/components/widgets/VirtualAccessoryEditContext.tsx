import { createContext, useContext } from 'react';

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
}

const NONE: VirtualAccessoryActions = { edit: () => undefined, remove: () => undefined };

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
