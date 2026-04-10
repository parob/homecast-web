/**
 * Shared value formatters for infrastructure time-series charts.
 * Picks the right unit suffix based on the metric's unit string.
 */
export function defaultFormat(unit: string): (n: number) => string {
  return (n: number) => {
    if (n == null || Number.isNaN(n)) return '—';
    if (unit === 'bytes/sec') {
      if (n < 1024) return `${n.toFixed(0)} B/s`;
      if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB/s`;
      if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB/s`;
      return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB/s`;
    }
    if (unit === 'bytes') {
      if (n < 1024) return `${n.toFixed(0)} B`;
      if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KiB`;
      if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(0)} MiB`;
      return `${(n / 1024 / 1024 / 1024).toFixed(1)} GiB`;
    }
    if (unit === 'millicores') return `${Math.round(n)}m`;
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
