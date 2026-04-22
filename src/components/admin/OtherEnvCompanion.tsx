import { useState, type ReactNode } from 'react';
import { useQuery } from '@apollo/client/react';
import type { DocumentNode, OperationVariables } from '@apollo/client/core';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { otherEnvClient, OTHER_ENV } from '@/lib/apollo-other-env';

// Inlined from cloud package's analytics/shared.tsx so this component can
// live in the host web app (cloud-dir is only mounted at build time).
const ENV_STYLES = {
  production: { label: 'Production', cssColor: 'hsl(var(--primary))' },
  staging: { label: 'Staging', cssColor: 'hsl(38 92% 50%)' },
} as const;

/**
 * Collapsible read-only panel showing a query's result on the "other"
 * environment (prod if currently on staging, or vice versa).
 *
 * Added to admin pages that are primarily tables/data views — lets an admin
 * see the sibling environment's rows without duplicating the page's
 * mutation flow or routing logic. Mutations stay on the current env only.
 */
export function OtherEnvCompanion<TData = unknown, TVars extends OperationVariables = OperationVariables>({
  label,
  query,
  variables,
  children,
  defaultOpen = false,
}: {
  label: string;
  query: DocumentNode;
  variables?: TVars;
  children: (data: TData | undefined) => ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (!otherEnvClient || !OTHER_ENV) return null;

  const envColor = ENV_STYLES[OTHER_ENV].cssColor;
  const envLabel = ENV_STYLES[OTHER_ENV].label;

  return (
    <Card className="mt-4 border-dashed">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: envColor }} />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {label} · {envLabel}
          </span>
          <span className="text-[10px] text-muted-foreground italic">(read-only)</span>
        </div>
      </button>
      {open && (
        <CardContent className="pt-0 pb-3 px-4">
          <CompanionContent<TData, TVars> query={query} variables={variables}>
            {children}
          </CompanionContent>
        </CardContent>
      )}
    </Card>
  );
}

function CompanionContent<TData, TVars extends OperationVariables>({
  query,
  variables,
  children,
}: {
  query: DocumentNode;
  variables?: TVars;
  children: (data: TData | undefined) => ReactNode;
}) {
  const { data, loading, error } = useQuery<TData, TVars>(query, {
    variables,
    client: otherEnvClient ?? undefined,
    errorPolicy: 'all',
    fetchPolicy: 'cache-and-network',
  });

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading {OTHER_ENV}…
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="text-xs text-muted-foreground py-3 italic">
        Could not reach {OTHER_ENV}: {error.message}
      </div>
    );
  }

  return <div className="pointer-events-none opacity-90">{children(data)}</div>;
}
