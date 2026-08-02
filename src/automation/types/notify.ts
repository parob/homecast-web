// What actually happened to a notification, as reported by whoever delivered it.
//
// The relay hands a notify action off and, in cloud mode, the server decides
// whether to send it — a per-automation rate limit, a per-device mute, or
// simply no registered devices can all mean nothing is delivered. None of that was visible: the notify step recorded
// `success: true` the moment the message left the relay, so an automation
// whose pushes were all being dropped looked identical in the execution
// history to one working perfectly. That is exactly the case a user debugs by
// opening the history, so it is the one place the truth has to appear.

export interface NotifyDelivery {
  /** True only if at least one channel actually sent something. */
  delivered: boolean;
  /** Channels that sent, e.g. ['push'] or ['local']. */
  channels: string[];
  /** A rate limit suppressed at least one channel. */
  rateLimited?: boolean;
  /**
   * Why nothing was delivered, when `delivered` is false. `unknown` means the
   * deliverer never reported back — treated as "can't say", not as failure.
   * `preference` is what servers said before per-device mutes replaced
   * account-wide preferences; kept so old traces still render.
   */
  reason?: 'rate_limited' | 'no_devices' | 'muted' | 'preference' | 'error' | 'unknown';
}

/** The result to record when the deliverer never answered. */
export const NOTIFY_DELIVERY_UNKNOWN: NotifyDelivery = {
  delivered: false,
  channels: [],
  reason: 'unknown',
};

/**
 * What a notify step records until the deliverer answers.
 *
 * The action does not wait for that answer — see ActionExecutor.executeNotify —
 * so a trace read mid-flight, or one whose report never arrived, says "not yet
 * known" rather than claiming a delivery it cannot vouch for.
 */
export const NOTIFY_DELIVERY_PENDING = {
  delivered: false,
  channels: [] as string[],
  reason: 'unknown' as const,
};
