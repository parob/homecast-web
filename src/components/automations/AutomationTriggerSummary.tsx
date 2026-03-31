import type { AutomationTrigger, AutomationEvent } from '@/lib/graphql/types';
import { charLabel, formatValue } from './format';

function formatTime(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return isoDate;
  }
}

function formatRecurrence(recurrence: string | null | undefined): string {
  if (!recurrence) return 'Once';
  try {
    const rc = typeof recurrence === 'string' ? JSON.parse(recurrence) : recurrence;
    if (rc.day === 1) return 'Every day';
    if (rc.weekOfYear === 1) return 'Every week';
    if (rc.weekday) {
      const days = ['', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return `Every ${days[rc.weekday] || 'week'}`;
    }
    return 'Recurring';
  } catch {
    return 'Recurring';
  }
}

function formatCalendar(calendarComponents: string | null | undefined): string {
  if (!calendarComponents) return 'Scheduled';
  try {
    const cc = typeof calendarComponents === 'string' ? JSON.parse(calendarComponents) : calendarComponents;
    const parts: string[] = [];
    if (cc.hour !== undefined && cc.minute !== undefined) {
      const h = cc.hour;
      const m = String(cc.minute).padStart(2, '0');
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      parts.push(`${h12}:${m} ${ampm}`);
    }
    if (cc.weekday) {
      const days = ['', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      parts.unshift(days[cc.weekday] || '');
    }
    return parts.length > 0 ? parts.join(', ') : 'Scheduled';
  } catch {
    return 'Scheduled';
  }
}

function formatEvent(event: AutomationEvent): string {
  switch (event.type) {
    case 'characteristic': {
      const name = event.accessoryName || 'device';
      const label = charLabel(event.characteristicType || '');
      if (event.triggerValue != null) {
        const val = formatValue(event.triggerValue, event.characteristicType || undefined);
        if (val === 'On') return `When ${name} turns on`;
        if (val === 'Off') return `When ${name} turns off`;
        if (val) return `When ${name} ${label} is ${val}`;
      }
      return `When ${name} ${label} changes`;
    }
    case 'significantTime': {
      const eventName = event.significantEvent === 'sunrise' ? 'sunrise' : 'sunset';
      if (event.offsetMinutes && event.offsetMinutes !== 0) {
        const abs = Math.abs(event.offsetMinutes);
        const dir = event.offsetMinutes < 0 ? 'before' : 'after';
        return `${abs} min ${dir} ${eventName}`;
      }
      return `At ${eventName}`;
    }
    case 'location':
      return event.notifyOnEntry ? 'When arriving' : 'When leaving';
    case 'presence': {
      const who = event.presenceType === 'currentUser' ? 'you' : 'anyone';
      const what = event.presenceEvent === 'atHome' ? 'arrive' : 'leave';
      return `When ${who} ${what}`;
    }
    case 'calendar':
      return formatCalendar(event.calendarComponents);
    case 'duration': {
      const secs = event.durationSeconds || 0;
      if (secs >= 3600) return `After ${Math.round(secs / 3600)}h`;
      if (secs >= 60) return `After ${Math.round(secs / 60)} min`;
      return `After ${secs}s`;
    }
    default:
      return 'Automation';
  }
}

interface AutomationTriggerSummaryProps {
  trigger: AutomationTrigger;
  compact?: boolean;
  automationName?: string;
}

function extractTriggerHint(name: string): string {
  const whenMatch = name.match(/when\s+(.+)/i);
  if (whenMatch) return `When ${whenMatch[1]}`;
  const colonMatch = name.match(/^([^:]+):/);
  if (colonMatch) return colonMatch[1].trim();
  return 'Device condition';
}

export function AutomationTriggerSummary({ trigger, compact, automationName }: AutomationTriggerSummaryProps) {
  if (trigger.type === 'timer') {
    const time = trigger.fireDate ? formatTime(trigger.fireDate) : '';
    const recurrence = formatRecurrence(trigger.recurrence);
    if (compact) {
      return <span>{recurrence}{time ? `, ${time}` : ''}</span>;
    }
    return (
      <div className="text-sm text-muted-foreground">
        <div>{recurrence}</div>
        {time && <div>{time}</div>}
      </div>
    );
  }

  if (trigger.type === 'event' && trigger.events && trigger.events.length > 0) {
    const summary = formatEvent(trigger.events[0]);
    if (compact) return <span>{summary}</span>;
    return <div className="text-sm text-muted-foreground">{summary}</div>;
  }

  // Event trigger with no events — check conditions from predicate
  if (trigger.conditions && trigger.conditions.length > 0) {
    const cond = trigger.conditions[0];
    if (cond.type === 'characteristic' && cond.accessoryName) {
      const val = cond.value ? formatValue(cond.value, cond.characteristicType || undefined) : null;
      let summary: string;
      if (val === 'On') summary = `When ${cond.accessoryName} turns on`;
      else if (val === 'Off') summary = `When ${cond.accessoryName} turns off`;
      else if (val) summary = `When ${cond.accessoryName} ${charLabel(cond.characteristicType || '')} is ${val}`;
      else summary = `When ${cond.accessoryName} changes`;
      if (compact) return <span>{summary}</span>;
      return <div className="text-sm text-muted-foreground">{summary}</div>;
    }
    if (cond.type === 'significantEvent') {
      const event = cond.afterEvent || cond.beforeEvent || 'sunset';
      const dir = cond.afterEvent ? 'After' : 'Before';
      const summary = `${dir} ${event}`;
      if (compact) return <span>{summary}</span>;
      return <div className="text-sm text-muted-foreground">{summary}</div>;
    }
    if (cond.type === 'time') {
      const time = cond.afterTime || cond.beforeTime;
      if (time) {
        try {
          const tc = typeof time === 'string' ? JSON.parse(time) : time;
          const summary = `${cond.afterTime ? 'After' : 'Before'} ${tc.hour ?? 0}:${String(tc.minute ?? 0).padStart(2, '0')}`;
          if (compact) return <span>{summary}</span>;
          return <div className="text-sm text-muted-foreground">{summary}</div>;
        } catch { /* fall through */ }
      }
    }
  }

  // Fallback — extract hint from name
  const hint = automationName ? extractTriggerHint(automationName) : 'Device condition';
  if (compact) return <span>{hint}</span>;
  return <div className="text-sm text-muted-foreground">{hint}</div>;
}
