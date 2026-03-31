/**
 * Parse an ISO timestamp as UTC.
 * Handles timestamps from the backend which are UTC but may lack timezone suffix.
 *
 * When a datetime is serialized without timezone info (e.g., "2024-01-15T10:30:45"),
 * JavaScript's Date constructor interprets it as local time. This function ensures
 * such timestamps are correctly interpreted as UTC.
 */
export function parseUTCTimestamp(timestamp: string | null | undefined): Date | null {
  if (!timestamp) return null;

  // If no timezone info, assume UTC by appending 'Z'
  const hasTimezone = /([+-]\d{2}:\d{2}|Z)$/.test(timestamp);
  const normalizedTimestamp = hasTimezone ? timestamp : `${timestamp}Z`;

  return new Date(normalizedTimestamp);
}
