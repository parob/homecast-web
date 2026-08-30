/** The share dialog: pick who the link admits, copy it, add or drop a passcode. */
import { useState } from 'react';
import { X, Eye, Zap, ExternalLink, QrCode, ChevronRight, Globe, Lock, Plus, Trash2, Users } from 'lucide-react';
import { Panel, CopyButton, softBtn, iconBtn } from './bits';
import { cx } from './util';

const LINK = 'https://homecast.cloud/s/abc123def';
type Access = 'off' | 'view' | 'control';
const OPTIONS: { id: Access; icon: typeof X; label: string; desc: string }[] = [
  { id: 'off', icon: X, label: 'Off', desc: 'No public access' },
  { id: 'view', icon: Eye, label: 'View', desc: 'Can see accessories' },
  { id: 'control', icon: Zap, label: 'Control', desc: 'Can control accessories' },
];

export function ShareDemo() {
  const [access, setAccess] = useState<Access>('view');
  const [passcodes, setPasscodes] = useState([{ id: 1, name: 'Guest Access', level: 'Control' }]);

  return (
    <Panel className="max-w-[400px]">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold">Share “My Home”</h3>
          <p className="text-xs text-muted-foreground">Includes all rooms and accessories in this home.</p>
        </div>
        <X className="h-4 w-4 text-muted-foreground" />
      </div>

      <div className="mt-5 text-sm font-medium">Share Link</div>
      <div className={cx('mt-2 truncate rounded-lg border border-border px-3 py-2 text-sm transition-opacity', access === 'off' && 'opacity-40')}>{LINK}</div>
      <div className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2">
        <CopyButton text={LINK} label="Copy" className={softBtn} />
        <button type="button" className={softBtn}><ExternalLink className="h-4 w-4" /> Open</button>
        <button type="button" className={cx(softBtn, 'px-2.5')} aria-label="QR code"><QrCode className="h-4 w-4" /></button>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm">
        <span>State Endpoint</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>

      <div className="mt-4 flex items-center gap-2 text-sm font-medium"><Globe className="h-4 w-4" /> Public Access</div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {OPTIONS.map((o) => {
          const on = o.id === access;
          return (
            <button key={o.id} type="button" onClick={() => setAccess(o.id)} aria-pressed={on}
              className={cx('rounded-lg border p-3 text-center transition-colors', on ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/50')}>
              <o.icon className={cx('mx-auto h-4 w-4', on ? 'text-primary' : 'text-muted-foreground')} />
              <div className={cx('mt-1 text-sm font-medium', on && 'text-primary')}>{o.label}</div>
              <div className="text-[11px] leading-tight text-muted-foreground">{o.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between text-sm font-medium">
        <span className="flex items-center gap-2"><Lock className="h-4 w-4" /> Passcodes</span>
        <button type="button" className={iconBtn} aria-label="Add passcode"
          onClick={() => setPasscodes((p) => [...p, { id: Date.now(), name: `Passcode ${p.length + 1}`, level: 'View' }])}>
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <ul className="mt-1">
        {passcodes.map((p) => (
          <li key={p.id} className="flex items-center justify-between py-1.5 pl-1 text-sm">
            <span>{p.name}</span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {p.level}
              <button type="button" className={iconBtn} aria-label={`Delete ${p.name}`} onClick={() => setPasscodes((list) => list.filter((x) => x.id !== p.id))}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </span>
          </li>
        ))}
        {passcodes.length === 0 && <li className="py-1.5 pl-1 text-xs text-muted-foreground">No passcodes</li>}
      </ul>

      <div className="mt-3 flex items-center justify-between text-sm font-medium">
        <span className="flex items-center gap-2"><Users className="h-4 w-4" /> Members</span>
        <span className={iconBtn}><Plus className="h-4 w-4" /></span>
      </div>
      <div className="flex items-center justify-between py-1.5 pl-1 text-sm">
        <span>alex@example.com</span>
        <span className="text-xs text-muted-foreground">Owner</span>
      </div>
    </Panel>
  );
}
