import { Check, X } from 'lucide-react';

const rules = [
  { test: (p: string) => p.length >= 8, label: 'At least 8 characters' },
  { test: (p: string) => /[A-Z]/.test(p), label: 'One uppercase letter' },
  { test: (p: string) => /[a-z]/.test(p), label: 'One lowercase letter' },
  { test: (p: string) => /[0-9]/.test(p), label: 'One number' },
  { test: (p: string) => /[^a-zA-Z0-9]/.test(p), label: 'One special character' },
];

export function validatePassword(password: string): string | null {
  for (const rule of rules) {
    if (!rule.test(password)) return `Password must contain: ${rule.label.toLowerCase()}`;
  }
  return null;
}

export function PasswordRequirements({ password }: { password: string }) {
  if (!password) return null;

  return (
    <ul className="space-y-1 text-xs">
      {rules.map((rule) => {
        const met = rule.test(password);
        return (
          <li key={rule.label} className={`flex items-center gap-1.5 ${met ? 'text-green-500' : 'text-muted-foreground'}`}>
            {met ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
            {rule.label}
          </li>
        );
      })}
    </ul>
  );
}
