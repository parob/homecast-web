/**
 * Per-pod resource limits across the homecast / homecast-prod deployments.
 * Both run the same template (homecast container 2 CPU + 2Gi, cloud-sql-proxy 0.5 CPU + 256Mi).
 * Pod metrics are sum-of-containers, so we use the container totals here too.
 *
 * Update if the deployment manifests change.
 */
export const POD_CPU_LIMIT_MILLICORES = 2500;
export const POD_MEMORY_LIMIT_BYTES = (2 + 0.25) * 1024 * 1024 * 1024; // 2.25 GiB

/** Format CPU in millicores as a friendly fractional-core value. */
export function formatCpu(millicores: number): string {
  if (millicores == null || Number.isNaN(millicores)) return '—';
  if (millicores === 0) return '0';
  if (millicores < 10) return `${millicores.toFixed(0)}m`;
  if (millicores < 1000) return `${(millicores / 1000).toFixed(2)} cores`;
  return `${(millicores / 1000).toFixed(2)} cores`;
}

/** Format a byte count using decimal units (MB/GB) — friendlier than KiB/MiB. */
export function formatMemory(bytes: number): string {
  if (bytes == null || Number.isNaN(bytes)) return '—';
  if (bytes < 1000) return `${bytes.toFixed(0)} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(0)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

/** % of per-pod CPU limit (e.g., 82m of 2500m = 3%). */
export function cpuPctOfLimit(millicores: number): number {
  return (millicores / POD_CPU_LIMIT_MILLICORES) * 100;
}

/** % of per-pod memory limit (e.g., 264MiB of 2304MiB = 11%). */
export function memoryPctOfLimit(bytes: number): number {
  return (bytes / POD_MEMORY_LIMIT_BYTES) * 100;
}

/**
 * Shared value formatters for infrastructure time-series charts.
 * Picks the right unit suffix based on the metric's unit string.
 */
export function defaultFormat(unit: string): (n: number) => string {
  return (n: number) => {
    if (n == null || Number.isNaN(n)) return '—';
    if (unit === 'bytes/sec') {
      if (n < 1000) return `${n.toFixed(0)} B/s`;
      if (n < 1_000_000) return `${(n / 1000).toFixed(1)} KB/s`;
      if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)} MB/s`;
      return `${(n / 1_000_000_000).toFixed(2)} GB/s`;
    }
    if (unit === 'bytes') return formatMemory(n);
    if (unit === 'millicores') return formatCpu(n);
    if (unit === 'count/sec') {
      if (n < 1) return n.toFixed(2) + '/s';
      if (n < 1000) return n.toFixed(1) + '/s';
      return `${(n / 1000).toFixed(1)}k/s`;
    }
    if (unit === 'count') return Math.round(n).toString();
    return n.toFixed(0);
  };
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
