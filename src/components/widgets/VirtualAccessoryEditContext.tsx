import { createContext, useContext } from 'react';

/**
 * How a widget offers "edit this accessory".
 *
 * Passed by context rather than as a prop because there are 28 widget
 * components and a virtual accessory can render through any of them — a virtual
 * switch really does go through SwitchWidget. Threading a prop meant 28 places
 * to remember, and the first attempt wired exactly one of them, so Edit was
 * missing from every virtual accessory that wasn't a mode, counter or timer.
 *
 * WidgetCard asks this for an editor and shows the entry if it gets one, so a
 * new widget inherits the behaviour without doing anything.
 */
export type VirtualAccessoryEditor = (accessoryId: string) => (() => void) | undefined;

const VirtualAccessoryEditContext = createContext<VirtualAccessoryEditor>(() => undefined);

export const VirtualAccessoryEditProvider = VirtualAccessoryEditContext.Provider;

export function useVirtualAccessoryEditor(accessoryId?: string): (() => void) | undefined {
  const resolve = useContext(VirtualAccessoryEditContext);
  return accessoryId ? resolve(accessoryId) : undefined;
}
