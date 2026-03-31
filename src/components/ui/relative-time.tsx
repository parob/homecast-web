import { useState, useEffect, useRef } from 'react';
import { parseUTCTimestamp } from '@/lib/date';

interface RelativeTimeProps {
  timestamp: string | null | undefined;
  fallback?: string;
  className?: string;
}

export function RelativeTime({ timestamp, fallback = '-', className }: RelativeTimeProps) {
  const [now, setNow] = useState(() => Date.now());
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!timestamp) return;

    const scheduleUpdate = () => {
      // Calculate interval based on how old the timestamp is
      const date = parseUTCTimestamp(timestamp);
      if (!date) return;
      const diffMs = Date.now() - date.getTime();
      const diffMin = Math.floor(diffMs / 1000 / 60);

      let interval: number;
      if (diffMin < 1) interval = 1000; // Update every second for < 1 min
      else if (diffMin < 5) interval = 10000; // Every 10s for < 5 min
      else if (diffMin < 60) interval = 30000; // Every 30s for < 1 hour
      else interval = 60000; // Every minute for older

      timeoutRef.current = setTimeout(() => {
        setNow(Date.now());
        scheduleUpdate();
      }, interval);
    };

    scheduleUpdate();

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [timestamp]);

  if (!timestamp) {
    return <span className={className}>{fallback}</span>;
  }

  // Calculate relative time using current `now` state
  const date = parseUTCTimestamp(timestamp);
  if (!date) {
    return <span className={className}>{fallback}</span>;
  }
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  let display: string;
  if (diffSec < 5) display = 'just now';
  else if (diffSec < 60) display = `${diffSec}s ago`;
  else if (diffMin < 60) display = `${diffMin}m ago`;
  else if (diffHour < 24) display = `${diffHour}h ago`;
  else if (diffDay < 7) display = `${diffDay}d ago`;
  else display = date.toLocaleDateString();

  return (
    <span className={className} title={date.toLocaleString()}>
      {display}
    </span>
  );
}
