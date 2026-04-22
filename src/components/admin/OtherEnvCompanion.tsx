import { type ReactNode } from 'react';
import { useQuery } from '@apollo/client/react';
import type { DocumentNode, OperationVariables } from '@apollo/client/core';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { otherEnvClient, OTHER_ENV, CURRENT_ENV, type HomecastEnv } from '@/lib/apollo-other-env';
import { useAdminEnvToggle } from '@/hooks/useAdminEnvToggle';

const ENV_STYLES: Record<HomecastEnv, { label: string; cssColor: string }> = {
  production: { label: 'Production', cssColor: 'hsl(var(--primary))' },
  staging: { label: 'Staging', cssColor: 'hsl(38 92% 50%)' },
};

export function EnvHeader({ env, label }: { env: HomecastEnv; label?: string }) {
  const style = ENV_STYLES[env];
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: style.cssColor }} />
      <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
        {label ?? style.label}
      </span>
    </div>
  );
}

/**
 * Renders the same query's result on the "other" environment (prod if on
 * staging, or vice versa), styled identically to the current-env view so
 * both envs carry equal visual weight.
 *
 * Visibility is controlled by the sidebar toggles — if the sibling env is
 * toggled off, nothing renders. If the current env is toggled off, the
 * page's own content should be hidden by the caller using
 * `useAdminEnvToggle().showCurrent`.
 */
export function OtherEnvCompanion<TData = unknown, TVars extends OperationVariables = OperationVariables>({
  label,
  query,
  variables,
  children,
}: {
  label: string;
  query: DocumentNode;
  variables?: TVars;
  children: (data: TData | undefined) => ReactNode;
}) {
  const { showOther, showCurrent, otherEnv } = useAdminEnvToggle();

  if (!otherEnvClient || !otherEnv) return null;
  if (!showOther) return null;

  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          {/* Only show env label on the header when both envs are visible at
              once — otherwise it's redundant. */}
          {showCurrent && <EnvHeader env={otherEnv} />}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 pb-3 px-4">
        <CompanionContent<TData, TVars> query={query} variables={variables}>
          {children}
        </CompanionContent>
      </CardContent>
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

  return <>{children(data)}</>;
}

/**
 * Wraps the current env's native content so it sits in a visually matched
 * card with an env-label header, mirroring the OtherEnvCompanion.
 *
 * Respects the sidebar toggle — returns null when the current env is off.
 * When only the current env is visible, the env-label header is suppressed
 * (no need to announce "Production" when it's the only thing on screen).
 */
export function CurrentEnvSection({
  label,
  children,
  noCard = false,
}: {
  label?: string;
  children: ReactNode;
  noCard?: boolean;
}) {
  const { showCurrent, showOther, currentEnv } = useAdminEnvToggle();

  if (!showCurrent) return null;
  if (!currentEnv) return <>{children}</>;

  const showEnvHeader = showOther;

  if (noCard) {
    return (
      <div className="space-y-2">
        {showEnvHeader && <EnvHeader env={currentEnv} label={label} />}
        {children}
      </div>
    );
  }

  if (!showEnvHeader && !label) {
    // No envelope needed — just pass through.
    return <>{children}</>;
  }

  return (
    <Card>
      {(showEnvHeader || label) && (
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="flex items-center justify-between">
            {label && <span className="text-xs font-medium text-muted-foreground">{label}</span>}
            {showEnvHeader && <EnvHeader env={currentEnv} />}
          </CardTitle>
        </CardHeader>
      )}
      <CardContent className="pt-0 pb-3 px-4">{children}</CardContent>
    </Card>
  );
}
