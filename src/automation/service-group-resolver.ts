// Reverse index: accessoryId -> service group IDs.
//
// TriggerManager needs this synchronously on every state change to fan an
// accessory's event out to triggers registered against a service group. The
// HomeKit bridge is async, so we keep a cached index and refresh it in the
// background.
//
// Without a resolver injected, TriggerManager silently skips all service-group
// triggers (see TriggerManager.handleStateChange) — which is exactly what
// happened in production before this existed.

import { HomeKit } from '../native/homekit-bridge';
import type { ServiceGroupResolver } from './engine/TriggerManager';

/** Group membership changes rarely; this only needs to be eventually correct. */
const DEFAULT_REFRESH_MS = 5 * 60_000;

export class HomeKitServiceGroupResolver implements ServiceGroupResolver {
  private index = new Map<string, string[]>();
  // Forward index: groupId -> accessoryIds. TriggerManager needs it to decide
  // whether the *group* satisfies a trigger, rather than firing once for each
  // member that reports in.
  private members = new Map<string, string[]>();
  private timer?: ReturnType<typeof setInterval>;
  private refreshing = false;

  getGroupsForAccessory(accessoryId: string): string[] {
    return this.index.get(accessoryId) ?? [];
  }

  getMembers(groupId: string): string[] {
    return this.members.get(groupId) ?? [];
  }

  /** Rebuild the index from the current HomeKit service groups. */
  async refresh(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const homes = await HomeKit.listHomes();
      const next = new Map<string, string[]>();
      const nextMembers = new Map<string, string[]>();

      for (const home of homes) {
        let groups;
        try {
          groups = await HomeKit.listServiceGroups(home.id);
        } catch {
          // A single unreachable home shouldn't wipe the whole index.
          continue;
        }
        for (const group of groups) {
          nextMembers.set(group.id, [...(group.accessoryIds ?? [])]);
          for (const accessoryId of group.accessoryIds ?? []) {
            const existing = next.get(accessoryId);
            if (existing) existing.push(group.id);
            else next.set(accessoryId, [group.id]);
          }
        }
      }

      this.index = next;
      this.members = nextMembers;
    } catch (e) {
      console.warn('[ServiceGroupResolver] refresh failed', e);
    } finally {
      this.refreshing = false;
    }
  }

  /** Populate the index now, then keep it fresh. */
  start(intervalMs: number = DEFAULT_REFRESH_MS): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.index.clear();
    this.members.clear();
  }
}
