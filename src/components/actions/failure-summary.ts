import { describeWriteFailure } from '@/lib/describe-error';
import type { ActionFailure } from './action-failures';
import type { HomeActionWrite } from './catalog';

/**
 * How many accessories to name before the rest become a count.
 *
 * Two, because the description is one line of a toast roughly 290px wide and a
 * third name is what pushes it past two lines on a phone. Beyond that the names
 * stop being the useful part anyway: "five didn't respond" is a house problem,
 * and the answer to it is not a longer list.
 */
const MAX_NAMES = 2;

/**
 * What to say about the writes an action could not land.
 *
 * The count on its own — "2 accessories did not respond" — was everything the
 * toast knew how to say, and it was strictly less than what the app had in
 * hand: every power write carries the accessory's display `name`, put there by
 * the catalog. Naming them is the difference between knowing two lights are out
 * and knowing *which* two, which is the difference between acting on the notice
 * and hunting the grid for greyed tiles.
 *
 * The single-accessory path has always been this specific — `describeWriteFailure`
 * answers "Kitchen Light didn't respond in time" — so until now the app was more
 * forthcoming about one failure than about several.
 *
 * Deliberately says no more than the count did. The relay returns a per-accessory
 * `error` and this still collapses them into one claim; telling two accessories
 * apart by *reason* needs somewhere with room for two reasons, which a one-line
 * description is not.
 */
export function describeFailedWrites(failed: HomeActionWrite[]): string {
  // One entry per accessory, not per write: a step that moved two
  // characteristics on one device failed once, and "2 accessories" would be
  // counting the same light twice.
  const seen = new Set<string>();
  const names: string[] = [];
  for (const write of failed) {
    if (seen.has(write.accessoryId)) continue;
    seen.add(write.accessoryId);
    const name = write.name?.trim();
    if (name && names.length < MAX_NAMES) names.push(name);
  }
  const total = seen.size;

  // Nothing to name. Only the power actions carry names, so this is the honest
  // answer for every other shortcut rather than a defect — and it is exactly
  // the sentence that was here before.
  if (names.length === 0) {
    return `${total} accessor${total === 1 ? 'y' : 'ies'} didn’t respond`;
  }

  // Whatever is left after the names, whether it was unnamed or simply over the
  // cap. Both are "and N more" to a reader.
  const rest = total - names.length;
  const subject = rest > 0
    ? `${names.join(', ')} and ${rest} more`
    : names.length === 1
      ? names[0]
      : `${names[0]} and ${names[1]}`;
  return `${subject} didn’t respond`;
}

/**
 * Turn the writes that failed into one row per accessory, each with its own
 * reason.
 *
 * `describeWriteFailure` is the same function the single-accessory path has
 * always used, which is the point: a lone write that times out already says
 * "Kitchen Light didn't respond in time", and a row in the sheet should say
 * exactly that rather than a second, parallel wording for the same fault.
 *
 * The reason is looked up through a callback rather than a map this module
 * indexes itself, so the key format stays in the one place that builds it.
 *
 * Deduped by accessory, on the same reasoning as `describeFailedWrites`: two
 * characteristics on one device are one broken light, and one row.
 */
export function buildActionFailures(
  failed: HomeActionWrite[],
  reasonFor: (write: HomeActionWrite) => unknown,
): ActionFailure[] {
  const seen = new Set<string>();
  const rows: ActionFailure[] = [];
  for (const write of failed) {
    if (seen.has(write.accessoryId)) continue;
    seen.add(write.accessoryId);
    const name = write.name?.trim();
    rows.push({
      accessoryId: write.accessoryId,
      ...(name ? { name } : {}),
      reason: describeWriteFailure(reasonFor(write), name),
      write,
    });
  }
  return rows;
}

/**
 * What a retry says when it worked.
 *
 * Names them for the same reason a failure does — "Hall Lamp responded" is an
 * answer, "Retry succeeded" is a receipt. Falls back to a count when the writes
 * carry no names, exactly as the failure line does.
 */
export function describeRetrySuccess(writes: HomeActionWrite[]): string {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const write of writes) {
    if (seen.has(write.accessoryId)) continue;
    seen.add(write.accessoryId);
    const name = write.name?.trim();
    if (name && names.length < MAX_NAMES) names.push(name);
  }
  const total = seen.size;
  if (names.length === 0) {
    return `${total} accessor${total === 1 ? 'y' : 'ies'} responded`;
  }
  const rest = total - names.length;
  if (rest > 0) return `${names.join(', ')} and ${rest} more responded`;
  return names.length === 1
    ? `${names[0]} responded`
    : `${names[0]} and ${names[1]} responded`;
}
