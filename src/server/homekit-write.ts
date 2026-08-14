/**
 * Community mode: HomeKit structure writes with permission-error translation.
 *
 * HomeKit's own wording for a write the relay's Apple ID isn't allowed to make
 * is a bare "Insufficient privileges." — accurate but unactionable, and it
 * reads like a Homecast fault rather than a setting the user can change in
 * Apple Home. Every write that edits the HomeKit database (scenes, automations)
 * goes through here so API and MCP callers get the guidance instead.
 *
 * Imports only local-handler and the error lib, keeping it clear of the
 * cross-imports between the other server modules.
 */

import { executeHomeKitAction } from '../relay/local-handler';
import {
  isInsufficientHomeKitPrivileges,
  homeViewOnlyMessage,
  type ViewOnlySubject,
} from '../lib/homekit-errors';

/**
 * Derived from the action rather than passed per call site, so a new scene or
 * automation action can't be added with the wrong noun — or with the argument
 * forgotten, which silently produces the old automation wording.
 */
function subjectFor(action: string): ViewOnlySubject {
  return action.startsWith('scene.') ? 'scene' : 'automation';
}

export async function executeHomeKitWrite(
  action: string,
  payload: Record<string, unknown>,
  subject: ViewOnlySubject = subjectFor(action),
): Promise<unknown> {
  try {
    return await executeHomeKitAction(action, payload);
  } catch (error) {
    if (isInsufficientHomeKitPrivileges(error)) {
      throw new Error(homeViewOnlyMessage(subject));
    }
    throw error;
  }
}
