import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQuery } from '@apollo/client/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, Clock, Lightbulb, Radio, Sunrise, Plus, X, Check } from 'lucide-react';
import { AccessoryPicker } from '@/components/AccessoryPicker';
import { GET_ACCESSORIES, GET_HOMES } from '@/lib/graphql/queries';
import { CREATE_AUTOMATION, UPDATE_AUTOMATION } from '@/lib/graphql/mutations';
import { charLabel, formatValue } from './format';
import type { HomeKitAutomation, HomeKitAccessory, HomeKitHome, CreateAutomationResponse, UpdateAutomationResponse } from '@/lib/graphql/types';

type TriggerCategory = 'time' | 'accessory' | 'sensor';
type TimeSubType = 'specific' | 'sun';
type WizardStep = 'when' | 'conditions' | 'actions';

const SENSOR_TYPES = ['motion_sensor', 'occupancy_sensor', 'temperature_sensor',
  'humidity_sensor', 'contact_sensor', 'light_sensor', 'smoke_sensor',
  'carbon_monoxide_sensor', 'carbon_dioxide_sensor', 'leak_sensor', 'air_quality_sensor'];

function isSensorAccessory(acc: HomeKitAccessory): boolean {
  return acc.services.some(s => SENSOR_TYPES.includes(s.serviceType));
}

interface ActionData {
  accessoryId: string;
  accessoryName: string;
  characteristicType: string;
  targetValue: unknown;
}

interface ConditionData {
  accessoryId: string;
  accessoryName: string;
  characteristicType: string;
  operator: 'equal' | 'greater' | 'less';
  value: unknown;
}

function getCurrentCharValue(accessory: HomeKitAccessory | undefined, charType: string): unknown {
  if (!accessory) return null;
  for (const service of accessory.services) {
    for (const char of service.characteristics) {
      if (char.characteristicType === charType && char.value != null) {
        return char.value;
      }
    }
  }
  return null;
}

function extractTriggerHint(name: string): string {
  const whenMatch = name.match(/when\s+(.+)/i);
  if (whenMatch) return `When ${whenMatch[1]}`;
  const colonMatch = name.match(/^([^:]+):/);
  if (colonMatch) return colonMatch[1].trim();
  return 'Device condition';
}

// Internal/metadata characteristics that shouldn't appear in trigger/condition/action pickers
const HIDDEN_CHAR_TYPES = new Set([
  'name', 'configured_name', 'manufacturer', 'model', 'serial_number', 'firmware_revision',
  'hardware_revision', 'identify', 'label_index', 'label_namespace',
  'thread_status', 'current_transport', 'wifi_capabilities',
  'eve_set_time', 'eve_history_status', 'eve_history_request', 'eve_history_entries',
]);

function isHiddenChar(type: string): boolean {
  return HIDDEN_CHAR_TYPES.has(type) || type.includes('-0000-1000-8000-0026BB765291');
}

function getWritableChars(accessory: HomeKitAccessory | undefined) {
  if (!accessory) return [];
  const chars: Array<{ type: string; label: string; isBool: boolean; min?: number; max?: number; step?: number }> = [];
  const seen = new Set<string>();
  for (const service of accessory.services) {
    for (const char of service.characteristics) {
      if (!char.isWritable || isHiddenChar(char.characteristicType) || seen.has(char.characteristicType)) continue;
      seen.add(char.characteristicType);
      const isBool = char.characteristicType === 'power_state' || char.characteristicType === 'on' ||
        char.characteristicType === 'lock_target_state' || char.characteristicType === 'active';
      chars.push({ type: char.characteristicType, label: charLabel(char.characteristicType), isBool,
        min: char.minValue ?? undefined, max: char.maxValue ?? undefined, step: char.stepValue ?? undefined });
    }
  }
  return chars;
}

function getReadableChars(accessory: HomeKitAccessory | undefined) {
  if (!accessory) return [];
  const chars: Array<{ type: string; label: string; isBool: boolean }> = [];
  const seen = new Set<string>();
  for (const service of accessory.services) {
    for (const char of service.characteristics) {
      if (!char.isReadable || isHiddenChar(char.characteristicType) || seen.has(char.characteristicType)) continue;
      seen.add(char.characteristicType);
      const isBool = char.characteristicType === 'power_state' || char.characteristicType === 'on' ||
        char.characteristicType === 'lock_target_state' || char.characteristicType === 'active' ||
        char.characteristicType === 'motion_detected' || char.characteristicType === 'occupancy_detected';
      chars.push({ type: char.characteristicType, label: charLabel(char.characteristicType), isBool });
    }
  }
  return chars;
}

interface AutomationFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  homeId: string;
  automation?: HomeKitAutomation | null;
  onSaved?: () => void;
}

export function AutomationFormDialog({ open, onOpenChange, homeId, automation, onSaved }: AutomationFormDialogProps) {
  const isEditing = !!automation;

  const [step, setStep] = useState<WizardStep>('when');
  const [name, setName] = useState('');
  const [triggerCategory, setTriggerCategory] = useState<TriggerCategory | null>(null);
  const [timeSubType, setTimeSubType] = useState<TimeSubType>('specific');
  // Time fields
  const [hour, setHour] = useState(7);
  const [minute, setMinute] = useState(0);
  const [recurrenceType, setRecurrenceType] = useState<'once' | 'daily' | 'weekly' | 'weekdays'>('daily');
  const [triggerDate, setTriggerDate] = useState(() => new Date().toISOString().split('T')[0]);
  // Sun fields
  const [sigEvent, setSigEvent] = useState<'sunrise' | 'sunset'>('sunset');
  const [offsetMinutes, setOffsetMinutes] = useState(0);
  // Device/sensor fields
  // Separate state for accessory and sensor triggers
  const [accessoryTrigger, setAccessoryTrigger] = useState({ id: '', name: '', charType: '', value: true as unknown, operator: 'equal' as 'equal' | 'greater' | 'less' });
  const [sensorTrigger, setSensorTrigger] = useState({ id: '', name: '', charType: '', value: true as unknown, operator: 'equal' as 'equal' | 'greater' | 'less' });
  // Active trigger based on category
  const activeTrigger = triggerCategory === 'sensor' ? sensorTrigger : accessoryTrigger;
  const setActiveTrigger = triggerCategory === 'sensor' ? setSensorTrigger : setAccessoryTrigger;
  // Aliases for compatibility
  const triggerAccessoryId = activeTrigger.id;
  const triggerAccessoryName = activeTrigger.name;
  const triggerCharType = activeTrigger.charType;
  const triggerValue = activeTrigger.value;
  const triggerOperator = activeTrigger.operator;
  const setTriggerAccessoryId = (v: string) => setActiveTrigger(prev => ({ ...prev, id: v }));
  const setTriggerAccessoryName = (v: string) => setActiveTrigger(prev => ({ ...prev, name: v }));
  const setTriggerCharType = (v: string) => setActiveTrigger(prev => ({ ...prev, charType: v }));
  const setTriggerValue = (v: unknown) => setActiveTrigger(prev => ({ ...prev, value: v }));
  const setTriggerOperator = (v: 'equal' | 'greater' | 'less') => setActiveTrigger(prev => ({ ...prev, operator: v }));
  // Actions + conditions
  const [actions, setActions] = useState<ActionData[]>([]);
  const [conditions, setConditions] = useState<ConditionData[]>([]);
  const [addingDevice, setAddingDevice] = useState(false);
  const [addingConditionDevice, setAddingConditionDevice] = useState(false);
  const [pickingTriggerDevice, setPickingTriggerDevice] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);

  const { data: accessoriesData } = useQuery<{ accessories: HomeKitAccessory[] }>(GET_ACCESSORIES, { variables: { homeId }, skip: !open || !homeId, fetchPolicy: 'cache-first' });
  const { data: homesData } = useQuery<{ homes: HomeKitHome[] }>(GET_HOMES, { skip: !open, fetchPolicy: 'cache-first' });
  const accessories = accessoriesData?.accessories || [];
  const homes = homesData?.homes || [];

  const [createAutomation] = useMutation<CreateAutomationResponse>(CREATE_AUTOMATION);
  const [updateAutomation] = useMutation<UpdateAutomationResponse>(UPDATE_AUTOMATION);

  // All 3 trigger types support conditions (all create HMEventTrigger)
  const steps: { id: WizardStep; label: string }[] = [
    { id: 'when', label: 'Trigger' },
    { id: 'conditions', label: 'Conditions' },
    { id: 'actions', label: 'Actions' },
  ];

  // Edit pre-population
  useEffect(() => {
    if (!open) return;
    setTriggerCategory(null); setTimeSubType('specific'); setHour(7); setMinute(0); setRecurrenceType('daily');
    setTriggerDate(new Date().toISOString().split('T')[0]); setSigEvent('sunset'); setOffsetMinutes(0);
    setAccessoryTrigger({ id: '', name: '', charType: '', value: true, operator: 'equal' });
    setSensorTrigger({ id: '', name: '', charType: '', value: true, operator: 'equal' });
    setConditions([]); setAddingDevice(false); setAddingConditionDevice(false); setPickingTriggerDevice(false); setErrors({});

    if (automation) {
      setName(automation.name);
      const firstEvent = automation.trigger?.events?.[0];

      if (automation.trigger?.type === 'timer' || firstEvent?.type === 'calendar') {
        setTriggerCategory('time'); setTimeSubType('specific');
        if (automation.trigger?.fireDate) {
          try { const d = new Date(automation.trigger.fireDate); setHour(d.getHours()); setMinute(d.getMinutes()); } catch {}
        }
        if (firstEvent?.type === 'calendar' && firstEvent.calendarComponents) {
          try {
            const cc = typeof firstEvent.calendarComponents === 'string' ? JSON.parse(firstEvent.calendarComponents) : firstEvent.calendarComponents;
            if (cc.hour !== undefined) setHour(cc.hour);
            if (cc.minute !== undefined) setMinute(cc.minute);
          } catch {}
        }
      } else if (firstEvent?.type === 'significantTime') {
        setTriggerCategory('time'); setTimeSubType('sun');
        setSigEvent(firstEvent.significantEvent === 'sunrise' ? 'sunrise' : 'sunset');
        setOffsetMinutes(firstEvent.offsetMinutes ?? 0);
      } else if (firstEvent?.type === 'characteristic') {
        // Determine if this is a sensor or accessory and write to the correct state
        const acc = accessories.find(a => a.id === firstEvent.accessoryId);
        const isSensor = acc ? isSensorAccessory(acc) : false;
        setTriggerCategory(isSensor ? 'sensor' : 'accessory');
        let tv: unknown = true;
        if (firstEvent.triggerValue != null) { try { tv = typeof firstEvent.triggerValue === 'string' ? JSON.parse(firstEvent.triggerValue) : firstEvent.triggerValue; } catch { tv = firstEvent.triggerValue; } }
        const triggerState = { id: firstEvent.accessoryId ?? '', name: firstEvent.accessoryName ?? '', charType: firstEvent.characteristicType ?? '', value: tv, operator: 'equal' as const };
        if (isSensor) setSensorTrigger(triggerState); else setAccessoryTrigger(triggerState);
      } else if (automation.trigger?.type === 'event') {
        setTriggerCategory('accessory'); // Predicate-based — best guess
      }

      setActions((automation.actions ?? []).map(a => ({ accessoryId: a.accessoryId, accessoryName: a.accessoryName, characteristicType: a.characteristicType, targetValue: a.targetValue != null ? (typeof a.targetValue === 'string' ? JSON.parse(a.targetValue) : a.targetValue) : null })));

      // Populate conditions from trigger.conditions
      const triggerConditions = automation.trigger?.conditions ?? [];
      if (triggerConditions.length > 0) {
        setConditions(triggerConditions.map(c => ({
          accessoryId: c.accessoryId ?? '',
          accessoryName: c.accessoryName ?? '',
          characteristicType: c.characteristicType ?? '',
          operator: (c.operator === 'greaterThan' || c.operator === 'greater' ? 'greater' : c.operator === 'lessThan' || c.operator === 'less' ? 'less' : 'equal') as 'equal' | 'greater' | 'less',
          value: c.value != null ? (typeof c.value === 'string' ? (() => { try { return JSON.parse(c.value!); } catch { return c.value; } })() : c.value) : null,
        })));
      }

      setStep('when');
    } else {
      setName(''); setStep('when'); setActions([]);
    }
  }, [open, automation]);

  // Dirty tracking — snapshot current form state as a string for comparison
  const currentSnapshot = useMemo(() => JSON.stringify({
    name, triggerCategory, timeSubType, hour, minute, recurrenceType, triggerDate,
    sigEvent, offsetMinutes, accessoryTrigger, sensorTrigger, actions, conditions,
  }), [name, triggerCategory, timeSubType, hour, minute, recurrenceType, triggerDate,
    sigEvent, offsetMinutes, accessoryTrigger, sensorTrigger, actions, conditions]);

  // Capture initial snapshot on first render after open
  useEffect(() => {
    if (open && initialSnapshot === null) {
      // Defer to next tick so state from the open effect has settled
      const timer = setTimeout(() => setInitialSnapshot(currentSnapshot), 0);
      return () => clearTimeout(timer);
    }
    if (!open) setInitialSnapshot(null);
  }, [open, initialSnapshot, currentSnapshot]);

  const isDirty = isEditing ? (initialSnapshot !== null && currentSnapshot !== initialSnapshot) : true;

  const buildTrigger = () => {
    if (triggerCategory === 'time' && timeSubType === 'specific') {
      const fireDate = new Date();
      fireDate.setHours(hour, minute, 0, 0);
      if (recurrenceType === 'once') {
        // Use calendar event with date
        const [y, m, d] = triggerDate.split('-').map(Number);
        return { type: 'event', events: [{ type: 'calendar', calendarComponents: { hour, minute, ...(y && { year: y }), ...(m && { month: m }), ...(d && { day: d }) } }] };
      }
      // HMEventTrigger recurrences use weekday components (1=Sun..7=Sat) to restrict firing days.
      // Daily needs no recurrences — HMCalendarEvent with just {hour, minute} already fires every day.
      let recurrences: Array<Record<string, number>> | null = null;
      if (recurrenceType === 'weekdays') {
        recurrences = [{ weekday: 2 }, { weekday: 3 }, { weekday: 4 }, { weekday: 5 }, { weekday: 6 }];
      } else if (recurrenceType === 'weekly') {
        const jsDay = new Date().getDay(); // 0=Sun..6=Sat
        recurrences = [{ weekday: jsDay + 1 }]; // Apple: 1=Sun..7=Sat
      }
      return { type: 'event', events: [{ type: 'calendar', calendarComponents: { hour, minute } }], ...(recurrences && { recurrences }) };
    }
    if (triggerCategory === 'time' && timeSubType === 'sun') {
      return { type: 'event', events: [{ type: 'significantTime', significantEvent: sigEvent, ...(offsetMinutes !== 0 && { offsetMinutes }) }] };
    }
    if (triggerCategory === 'accessory' || triggerCategory === 'sensor') {
      return { type: 'event', events: [{ type: 'characteristic', accessoryId: triggerAccessoryId, characteristicType: triggerCharType, triggerValue, ...(triggerOperator !== 'equal' && { operator: triggerOperator }) }] };
    }
    return { type: 'event', events: [] };
  };

  const handleSave = async () => {
    if (!name.trim()) { setErrors({ name: 'Name is required' }); return; }
    const validActions = actions.filter(a => a.accessoryId && a.characteristicType);
    if (validActions.length === 0) { setErrors({ actions: 'Add at least one action' }); setStep('actions'); return; }
    setSaving(true);
    try {
      const trigger = buildTrigger();
      const validConditions = conditions.filter(c => c.accessoryId && c.characteristicType);
      const payload: Record<string, unknown> = { ...trigger };
      if (validConditions.length > 0) {
        payload.conditions = validConditions.map(c => ({ type: 'characteristic', accessoryId: c.accessoryId, characteristicType: c.characteristicType, operator: c.operator, value: c.value }));
      }
      if (isEditing && automation) {
        await updateAutomation({ variables: { automationId: automation.id, homeId, name, trigger: JSON.stringify(payload), actions: JSON.stringify(validActions) } });
      } else {
        await createAutomation({ variables: { homeId, name, trigger: JSON.stringify(payload), actions: JSON.stringify(validActions) } });
      }
      onOpenChange(false); onSaved?.();
    } catch (error) { setErrors({ save: String(error) }); } finally { setSaving(false); }
  };

  const triggerAccessory = accessories.find(a => a.id === triggerAccessoryId);
  const triggerChars = triggerCategory === 'sensor' ? getReadableChars(triggerAccessory) : getWritableChars(triggerAccessory);
  const selectedActionIds = useMemo(() => new Set(actions.map(a => a.accessoryId).filter(Boolean)), [actions]);
  const selectedConditionIds = useMemo(() => new Set(conditions.map(c => c.accessoryId).filter(Boolean)), [conditions]);

  const filteredTriggerAccessories = useMemo(() => {
    if (triggerCategory === 'sensor') return accessories.filter(a => a.isReachable && isSensorAccessory(a));
    if (triggerCategory === 'accessory') return accessories.filter(a => a.isReachable && !isSensorAccessory(a));
    return accessories.filter(a => a.isReachable);
  }, [accessories, triggerCategory]);

  const handlePickDevice = (accessoryId: string) => {
    const acc = accessories.find(a => a.id === accessoryId);
    if (!acc) return;
    if (selectedActionIds.has(accessoryId)) setActions(actions.filter(a => a.accessoryId !== accessoryId));
    else setActions([...actions, { accessoryId, accessoryName: acc.name, characteristicType: '', targetValue: null }]);
  };

  const handlePickConditionDevice = (accessoryId: string) => {
    const acc = accessories.find(a => a.id === accessoryId);
    if (!acc) return;
    if (selectedConditionIds.has(accessoryId)) setConditions(conditions.filter(c => c.accessoryId !== accessoryId));
    else setConditions([...conditions, { accessoryId, accessoryName: acc.name, characteristicType: '', operator: 'equal', value: true }]);
  };

  const triggerSummary = triggerCategory === 'time'
    ? (timeSubType === 'sun'
      ? (offsetMinutes === 0 ? `At ${sigEvent}` : `${Math.abs(offsetMinutes)} min ${offsetMinutes < 0 ? 'before' : 'after'} ${sigEvent}`)
      : (recurrenceType === 'once'
        ? `${triggerDate} at ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
        : `${recurrenceType === 'daily' ? 'Daily' : recurrenceType === 'weekly' ? 'Weekly' : 'Weekdays'} at ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`))
    : (triggerCategory === 'accessory' || triggerCategory === 'sensor')
      ? (triggerAccessoryId
        ? `When ${triggerAccessory?.name || triggerAccessoryName || 'device'} ${triggerCharType ? charLabel(triggerCharType) : ''} ${formatValue(triggerValue, triggerCharType) || 'changes'}`.trim()
        : automation ? extractTriggerHint(automation.name) : 'When a device changes')
    : 'Not configured';

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col p-0 gap-0 [&>button]:hidden">
        <DialogTitle className="sr-only">{isEditing ? 'Edit Automation' : 'Create Automation'}</DialogTitle>
        {/* Header with HomeKit branding + name */}
        <div className="shrink-0 px-6 pt-5 pb-2">
          <div className="flex items-center gap-2 mb-2">
            <img src="/homekit_logo.png" alt="HomeKit" className="h-5 w-5 shrink-0 opacity-50" />
            <span className="text-xs text-muted-foreground font-medium">HomeKit Automation</span>
          </div>
          <Input value={name} onChange={(e) => { setName(e.target.value); setErrors({}); }} placeholder="Automation name" className={`h-auto text-lg font-semibold placeholder:text-muted-foreground/40 ${isEditing ? 'px-3 py-2 rounded-lg' : 'border-0 p-0 shadow-none focus-visible:ring-0'}`} />
          {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
        </div>

        {/* Step tabs */}
        <div className="shrink-0 px-4 flex justify-center border-b overflow-x-auto">
          {steps.map(({ id, label }, i) => (
            <button key={id} onClick={() => { setAddingDevice(false); setAddingConditionDevice(false); setStep(id); }}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${step === id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
              <span className={`flex items-center justify-center rounded-full text-[9px] font-bold leading-none ${step === id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`} style={{ width: 18, height: 18 }}>{i + 1}</span>
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">

          {/* TRIGGER */}
          {step === 'when' && (
            <div className="space-y-4">
              <Label className="text-xs text-muted-foreground">What should trigger this?</Label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { id: 'time' as const, icon: Clock, label: 'A Time of Day', desc: 'Time or sunrise/sunset' },
                  { id: 'accessory' as const, icon: Lightbulb, label: 'An Accessory', desc: 'Is controlled' },
                  { id: 'sensor' as const, icon: Radio, label: 'A Sensor', desc: 'Detects something' },
                ]).map(({ id, icon: Icon, label, desc }) => (
                  <button key={id} onClick={() => setTriggerCategory(id)}
                    className={`flex flex-col items-center gap-1 p-3 rounded-xl border text-center transition-colors ${triggerCategory === id ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/50'}`}>
                    <Icon className={`h-5 w-5 ${triggerCategory === id ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span className="text-[11px] font-medium leading-tight">{label}</span>
                    <span className="text-[10px] text-muted-foreground leading-tight">{desc}</span>
                  </button>
                ))}
              </div>

              {/* TIME TRIGGER CONFIG */}
              {triggerCategory === 'time' && (
                <div className="space-y-3 pt-1">
                  {/* Sub-type toggle */}
                  <div className="flex gap-1.5">
                    <Button variant={timeSubType === 'specific' ? 'default' : 'outline'} size="sm" className="flex-1 h-8 text-xs" onClick={() => setTimeSubType('specific')}>Specific Time</Button>
                    <Button variant={timeSubType === 'sun' ? 'default' : 'outline'} size="sm" className="flex-1 h-8 text-xs" onClick={() => setTimeSubType('sun')}>Sunrise / Sunset</Button>
                  </div>

                  {timeSubType === 'specific' && (
                    <>
                      <div className="flex items-center gap-2 justify-center">
                        <Select value={String(hour)} onValueChange={(v) => setHour(Number(v))}><SelectTrigger className="h-12 w-20 text-lg text-center"><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: 24 }, (_, i) => (<SelectItem key={i} value={String(i)}>{String(i).padStart(2, '0')}</SelectItem>))}</SelectContent></Select>
                        <span className="text-lg font-bold">:</span>
                        <Select value={String(minute)} onValueChange={(v) => setMinute(Number(v))}><SelectTrigger className="h-12 w-20 text-lg text-center"><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: 60 }, (_, i) => (<SelectItem key={i} value={String(i)}>{String(i).padStart(2, '0')}</SelectItem>))}</SelectContent></Select>
                      </div>
                      <div className="flex gap-1.5">
                        {(['once', 'daily', 'weekly', 'weekdays'] as const).map(r => (
                          <Button key={r} variant={recurrenceType === r ? 'default' : 'outline'} size="sm" className="flex-1 h-8 text-xs" onClick={() => setRecurrenceType(r)}>
                            {r === 'once' ? 'Once' : r === 'daily' ? 'Daily' : r === 'weekly' ? 'Weekly' : 'Weekdays'}
                          </Button>
                        ))}
                      </div>
                      {recurrenceType === 'once' && (
                        <Input type="date" value={triggerDate} onChange={(e) => setTriggerDate(e.target.value)} className="h-10" />
                      )}
                    </>
                  )}

                  {timeSubType === 'sun' && (
                    <>
                      <div className="flex gap-2">
                        <button onClick={() => setSigEvent('sunrise')} className={`flex-1 flex flex-col items-center gap-1 p-3 rounded-xl border transition-colors ${sigEvent === 'sunrise' ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/50'}`}>
                          <Sunrise className={`h-5 w-5 ${sigEvent === 'sunrise' ? 'text-orange-500' : 'text-muted-foreground'}`} /><span className="text-xs font-medium">Sunrise</span>
                        </button>
                        <button onClick={() => setSigEvent('sunset')} className={`flex-1 flex flex-col items-center gap-1 p-3 rounded-xl border transition-colors ${sigEvent === 'sunset' ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/50'}`}>
                          <Sunrise className={`h-5 w-5 rotate-180 ${sigEvent === 'sunset' ? 'text-orange-500' : 'text-muted-foreground'}`} /><span className="text-xs font-medium">Sunset</span>
                        </button>
                      </div>
                      <Slider value={[offsetMinutes]} min={-60} max={60} step={5} onValueChange={([v]) => setOffsetMinutes(v)} />
                      <p className="text-xs text-center text-muted-foreground">{offsetMinutes === 0 ? `At ${sigEvent}` : `${Math.abs(offsetMinutes)} min ${offsetMinutes < 0 ? 'before' : 'after'} ${sigEvent}`}</p>
                    </>
                  )}
                </div>
              )}

              {/* ACCESSORY / SENSOR TRIGGER CONFIG */}
              {(triggerCategory === 'accessory' || triggerCategory === 'sensor') && (
                <div className="space-y-3 pt-1">
                  {isEditing && !triggerAccessoryId && !triggerAccessoryName && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-50/80 dark:bg-amber-950/20 p-2.5">
                      <span className="text-amber-500 shrink-0 text-sm">!</span>
                      <p className="text-xs text-amber-700 dark:text-amber-300">This trigger was created in the Apple Home app and its details aren't available to third-party apps. You can replace it by selecting a new {triggerCategory} below.</p>
                    </div>
                  )}
                  <button
                    onClick={() => setPickingTriggerDevice(true)}
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm text-left hover:bg-muted/50 transition-colors"
                  >
                    {triggerAccessory?.name || triggerAccessoryName || <span className="text-muted-foreground">Select {triggerCategory === 'sensor' ? 'a sensor' : 'an accessory'}...</span>}
                  </button>
                  {triggerAccessoryId && (() => {
                    const BOOL_CHAR_TYPES = ['power_state', 'on', 'active', 'lock_target_state', 'lock_current_state',
                      'motion_detected', 'occupancy_detected', 'smoke_detected', 'carbon_monoxide_detected',
                      'leak_detected', 'contact_sensor_state', 'obstruction_detected', 'status_low_battery', 'mute'];
                    const isBoolChar = triggerCharType ? BOOL_CHAR_TYPES.includes(triggerCharType) : false;
                    const isSensorBool = triggerCategory === 'sensor' && isBoolChar;
                    const isAccessoryBool = triggerCategory === 'accessory' && isBoolChar;

                    return (
                      <>
                        <Select value={triggerCharType} onValueChange={(type) => {
                          setTriggerCharType(type);
                          const isBool = BOOL_CHAR_TYPES.includes(type);
                          const currentVal = getCurrentCharValue(triggerAccessory, type);
                          setTriggerValue(isBool ? (currentVal ?? true) : (currentVal ?? null));
                        }}>
                          <SelectTrigger className="h-10"><SelectValue placeholder={triggerCategory === 'sensor' ? 'What does it detect?' : 'What changes?'} /></SelectTrigger>
                          <SelectContent>
                            {triggerChars.length > 0
                              ? triggerChars.map(c => (<SelectItem key={c.type} value={c.type}>{c.label}</SelectItem>))
                              : triggerCharType
                                ? <SelectItem value={triggerCharType}>{charLabel(triggerCharType)}</SelectItem>
                                : null}
                          </SelectContent>
                        </Select>
                        {triggerCharType && (isSensorBool || isAccessoryBool) && (
                          <div className="flex gap-2">
                            <Button variant={triggerValue === true || triggerValue === 1 ? 'default' : 'outline'} size="sm" className="flex-1 h-9" onClick={() => setTriggerValue(true)}>
                              {isSensorBool ? 'Detected' : 'Turns On'}
                            </Button>
                            <Button variant={triggerValue === false || triggerValue === 0 ? 'default' : 'outline'} size="sm" className="flex-1 h-9" onClick={() => setTriggerValue(false)}>
                              {isSensorBool ? 'Not Detected' : 'Turns Off'}
                            </Button>
                          </div>
                        )}
                        {triggerCharType && !isBoolChar && (
                          <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">Trigger when value is</Label>
                            <div className="flex gap-1.5">
                              {([
                                { id: 'greater' as const, label: 'Above' },
                                { id: 'equal' as const, label: 'Equal to' },
                                { id: 'less' as const, label: 'Below' },
                              ]).map(({ id, label }) => (
                                <Button key={id} variant={triggerOperator === id ? 'default' : 'outline'} size="sm" className="flex-1 h-8 text-xs" onClick={() => setTriggerOperator(id)}>
                                  {label}
                                </Button>
                              ))}
                            </div>
                            <Input
                              type="number"
                              value={String(triggerValue ?? '')}
                              onChange={(e) => setTriggerValue(e.target.value ? Number(e.target.value) : null)}
                              placeholder="e.g. 25"
                              className="h-10"
                            />
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {/* CONDITIONS */}
          {step === 'conditions' && !addingConditionDevice && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">Only run when these conditions are met</Label>
                <p className="text-[10px] text-muted-foreground mt-0.5">Optional — leave empty to always run</p>
              </div>

              {conditions.map((cond, i) => {
                const acc = accessories.find(a => a.id === cond.accessoryId);
                const chars = getReadableChars(acc);
                const selectedChar = chars.find(c => c.type === cond.characteristicType);
                const BOOL_COND_TYPES = ['power_state', 'on', 'active', 'lock_target_state', 'lock_current_state',
                  'motion_detected', 'occupancy_detected', 'smoke_detected', 'carbon_monoxide_detected',
                  'leak_detected', 'contact_sensor_state', 'obstruction_detected', 'status_low_battery', 'mute'];
                const isBoolCond = cond.characteristicType ? BOOL_COND_TYPES.includes(cond.characteristicType) : selectedChar?.isBool ?? false;
                const updateCond = (updates: Partial<ConditionData>) => { const next = [...conditions]; next[i] = { ...next[i], ...updates }; setConditions(next); };

                return (
                  <div key={i} className="rounded-xl border p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium truncate">{cond.accessoryName}</span>
                      <button onClick={() => setConditions(conditions.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                    </div>
                    <Select value={cond.characteristicType} onValueChange={(type) => {
                      const isBool = BOOL_COND_TYPES.includes(type);
                      const currentVal = getCurrentCharValue(acc, type);
                      updateCond({ characteristicType: type, value: isBool ? (currentVal ?? true) : (currentVal ?? null) });
                    }}>
                      <SelectTrigger className="h-10"><SelectValue placeholder="Property" /></SelectTrigger>
                      <SelectContent>{chars.map(c => (<SelectItem key={c.type} value={c.type}>{c.label}</SelectItem>))}</SelectContent>
                    </Select>
                    {cond.characteristicType && isBoolCond && (
                      <div className="flex gap-2">
                        <Button variant={cond.value === true || cond.value === 1 ? 'default' : 'outline'} size="sm" className="flex-1 h-9" onClick={() => updateCond({ value: true })}>On</Button>
                        <Button variant={cond.value === false || cond.value === 0 ? 'default' : 'outline'} size="sm" className="flex-1 h-9" onClick={() => updateCond({ value: false })}>Off</Button>
                      </div>
                    )}
                    {cond.characteristicType && !isBoolCond && (
                      <div className="space-y-2">
                        <div className="flex gap-1.5">
                          {([
                            { id: 'greater' as const, label: 'Above' },
                            { id: 'equal' as const, label: 'Equal to' },
                            { id: 'less' as const, label: 'Below' },
                          ]).map(({ id, label }) => (
                            <Button key={id} variant={cond.operator === id ? 'default' : 'outline'} size="sm" className="flex-1 h-8 text-xs" onClick={() => updateCond({ operator: id })}>
                              {label}
                            </Button>
                          ))}
                        </div>
                        <Input
                          type="number"
                          value={String(cond.value ?? '')}
                          onChange={(e) => updateCond({ value: e.target.value ? Number(e.target.value) : null })}
                          placeholder="e.g. 25"
                          className="h-10"
                        />
                      </div>
                    )}
                  </div>
                );
              })}

              <button onClick={() => setAddingConditionDevice(true)}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-dashed text-sm text-muted-foreground hover:text-foreground hover:border-muted-foreground/30 transition-colors">
                <Plus className="h-3.5 w-3.5" /> Add condition
              </button>
            </div>
          )}

          {/* ACTIONS */}
          {step === 'actions' && (() => {
            const deviceIds = [...new Set(actions.map(a => a.accessoryId).filter(Boolean))];

            return (
              <div className="space-y-3">
                <Label className="text-xs text-muted-foreground">What should happen?</Label>
                {!isEditing && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">A HomeKit scene will be created to run these actions. This is a requirement of Apple's HomeKit platform.</p>
                )}

                {deviceIds.map(deviceId => {
                  const deviceActions = actions.filter(a => a.accessoryId === deviceId);
                  const acc = accessories.find(a => a.id === deviceId);
                  const chars = getWritableChars(acc);
                  const usedCharTypes = new Set(deviceActions.map(a => a.characteristicType).filter(Boolean));
                  const availableChars = chars.filter(c => !usedCharTypes.has(c.type));

                  return (
                    <div key={deviceId} className="rounded-xl border p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium truncate">{deviceActions[0]?.accessoryName || 'Unknown device'}</span>
                        <button onClick={() => setActions(actions.filter(a => a.accessoryId !== deviceId))} className="text-muted-foreground hover:text-foreground shrink-0"><X className="h-3.5 w-3.5" /></button>
                      </div>

                      {deviceActions.map((action, j) => {
                        const idx = actions.indexOf(action);
                        const selectedChar = chars.find(c => c.type === action.characteristicType);
                        const updateAction = (updates: Partial<ActionData>) => { const next = [...actions]; next[idx] = { ...next[idx], ...updates }; setActions(next); setErrors({}); };

                        return (
                          <div key={j} className="flex items-center gap-2 flex-wrap">
                            <Select value={action.characteristicType} onValueChange={(type) => { const c = chars.find(x => x.type === type); updateAction({ characteristicType: type, targetValue: c?.isBool ? true : (c?.min ?? 0) }); }}>
                              <SelectTrigger className="h-7 text-xs w-auto min-w-[120px]"><SelectValue placeholder="Property" /></SelectTrigger>
                              <SelectContent>{chars.map(c => (<SelectItem key={c.type} value={c.type} className="text-xs">{c.label}</SelectItem>))}</SelectContent>
                            </Select>
                            {selectedChar?.isBool && (
                              <div className="flex gap-1 ml-auto">
                                <Button variant={action.targetValue === true || action.targetValue === 1 ? 'default' : 'outline'} size="sm" className="h-7 text-xs px-3" onClick={() => updateAction({ targetValue: true })}>On</Button>
                                <Button variant={action.targetValue === false || action.targetValue === 0 ? 'default' : 'outline'} size="sm" className="h-7 text-xs px-3" onClick={() => updateAction({ targetValue: false })}>Off</Button>
                              </div>
                            )}
                            {selectedChar && !selectedChar.isBool && selectedChar.max !== undefined && (
                              <div className="flex items-center gap-2 flex-1 min-w-[120px]">
                                <Slider value={[Number(action.targetValue ?? selectedChar.min ?? 0)]} min={selectedChar.min ?? 0} max={selectedChar.max} step={selectedChar.step ?? 1} onValueChange={([v]) => updateAction({ targetValue: v })} className="flex-1" />
                                <span className="text-xs text-muted-foreground w-8 text-right">{String(action.targetValue ?? 0)}</span>
                              </div>
                            )}
                            {deviceActions.length > 1 && (
                              <button onClick={() => setActions(actions.filter((_, k) => k !== idx))} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
                            )}
                          </div>
                        );
                      })}

                      {availableChars.length > 0 && (
                        <button onClick={() => setActions([...actions, { accessoryId: deviceId, accessoryName: deviceActions[0]?.accessoryName || '', characteristicType: '', targetValue: null }])}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors">+ Add property</button>
                      )}
                    </div>
                  );
                })}

                {errors.actions && <p className="text-xs text-red-500">{errors.actions}</p>}
                {errors.save && <p className="text-xs text-red-500">{errors.save}</p>}

                <button onClick={() => setAddingDevice(true)}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-dashed text-sm text-muted-foreground hover:text-foreground hover:border-muted-foreground/30 transition-colors">
                  <Plus className="h-3.5 w-3.5" /> Add a device
                </button>
              </div>
            );
          })()}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-6 pb-5 pt-2 flex justify-between">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          {(isEditing || step === 'actions') && (
            <Button size="sm" onClick={handleSave} disabled={saving || (isEditing && !isDirty)}>
              {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              {isEditing ? 'Save' : 'Create'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>

    {/* Picker dialogs */}
    <Dialog open={pickingTriggerDevice} onOpenChange={setPickingTriggerDevice}>
      <DialogContent className="max-w-[95%] sm:max-w-[500px] max-h-[85vh] flex flex-col p-0 gap-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogTitle className="sr-only">Select Trigger Device</DialogTitle>
        <AccessoryPicker accessories={filteredTriggerAccessories} homes={homes} selectedIds={new Set(triggerAccessoryId ? [triggerAccessoryId] : [])} onToggle={(id) => {
          if (triggerAccessoryId === id) { setTriggerAccessoryId(''); setTriggerAccessoryName(''); }
          else { setTriggerAccessoryId(id); setTriggerAccessoryName(accessories.find(a => a.id === id)?.name ?? ''); }
          setTriggerCharType(''); setPickingTriggerDevice(false);
        }} />
      </DialogContent>
    </Dialog>

    <Dialog open={addingDevice} onOpenChange={setAddingDevice}>
      <DialogContent className="max-w-[95%] sm:max-w-[500px] max-h-[85vh] flex flex-col p-0 gap-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogTitle className="sr-only">Add Devices</DialogTitle>
        <AccessoryPicker accessories={accessories} homes={homes} selectedIds={selectedActionIds} onToggle={handlePickDevice} />
        <div className="shrink-0 px-4 py-3 border-t flex justify-end">
          <Button size="sm" onClick={() => setAddingDevice(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog open={addingConditionDevice} onOpenChange={setAddingConditionDevice}>
      <DialogContent className="max-w-[95%] sm:max-w-[500px] max-h-[85vh] flex flex-col p-0 gap-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogTitle className="sr-only">Add Condition Device</DialogTitle>
        <AccessoryPicker accessories={accessories} homes={homes} selectedIds={selectedConditionIds} onToggle={handlePickConditionDevice} />
        <div className="shrink-0 px-4 py-3 border-t flex justify-end">
          <Button size="sm" onClick={() => setAddingConditionDevice(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
