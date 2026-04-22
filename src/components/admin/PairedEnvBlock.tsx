import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { ApolloProvider } from '@apollo/client/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ENV_CLIENTS, type HomecastEnv } from '@/lib/apollo-other-env';
import { useAdminEnvToggle } from '@/hooks/useAdminEnvToggle';

// Inlined so this component lives in the host web app tree; cloud analytics
// shared.tsx is only mounted at build time.
const ENV_STYLES: Record<HomecastEnv, { label: string; cssColor: string }> = {
  production: { label: 'Production', cssColor: 'hsl(var(--primary))' },
  staging: { label: 'Staging', cssColor: 'hsl(38 92% 50%)' },
};

export function EnvHeading({ env, extra }: { env: HomecastEnv; extra?: ReactNode }) {
  const style = ENV_STYLES[env];
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded border-l-4"
      style={{
        borderLeftColor: style.cssColor,
        background: `color-mix(in oklch, ${style.cssColor} 10%, transparent)`,
      }}
    >
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: style.cssColor }} />
      <span className="text-sm font-semibold uppercase tracking-wider" style={{ color: style.cssColor }}>
        {style.label}
      </span>
      {extra}
    </div>
  );
}

/**
 * Renders a per-env section stack (Production above, Staging below) wrapped
 * in matching cards so both envs get identical visual weight.
 *
 * Respects the sidebar visibility toggle — each side is hidden when its env
 * is turned off.
 */
export function PairedEnvSections<TData>({
  label,
  prod,
  staging,
  render,
  className,
}: {
  label?: string;
  prod: { data: TData | undefined; loading: boolean; error: Error | undefined; active: boolean };
  staging: { data: TData | undefined; loading: boolean; error: Error | undefined; active: boolean };
  render: (data: TData | undefined, env: HomecastEnv) => ReactNode;
  className?: string;
}) {
  const envToggle = useAdminEnvToggle();
  const sides: { env: HomecastEnv; q: typeof prod }[] = [];
  if (prod.active) sides.push({ env: 'production', q: prod });
  if (staging.active) sides.push({ env: 'staging', q: staging });

  if (sides.length === 0) {
    return (
      <div className={`text-sm text-muted-foreground py-6 text-center ${className ?? ''}`}>
        Turn on an environment toggle to view this section.
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className ?? ''}`}>
      {sides.map(({ env, q }) => (
        <Card key={env}>
          <CardHeader className="py-3 pb-2">
            <CardTitle className="flex items-center justify-between">
              <EnvHeading env={env} extra={label ? <span className="text-xs font-normal text-muted-foreground ml-2">· {label}</span> : null} />
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {q.loading && !q.data ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading…
              </div>
            ) : q.error && !q.data ? (
              <div className="text-xs text-muted-foreground py-3 italic">
                Could not reach {env}: {q.error.message}
              </div>
            ) : (
              render(q.data, env)
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// Re-export for convenience — keeps legacy callers compiling while they migrate.
export { ENV_STYLES };

/**
 * Runs `children` once per visible env, with each instance wrapped in an
 * ApolloProvider pinned to that env's client. The same JSX, including its
 * useQuery / useMutation calls, executes twice — once targeting prod, once
 * staging — giving the admin panel per-page symmetry for free.
 *
 * Pages that have their own filter state, pagination, dialogs, etc. get a
 * separate copy of that state in each env section (React key = env), so
 * mutations stay scoped to the env whose section hosts them.
 */
export function PairedEnvPage({ children }: { children: ReactNode }) {
  const envToggle = useAdminEnvToggle();
  const sides: HomecastEnv[] = [];
  if (envToggle.showProduction) sides.push('production');
  if (envToggle.showStaging) sides.push('staging');

  if (sides.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        Turn on an environment toggle to view this page.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {sides.map((env) => {
        const client = ENV_CLIENTS[env];
        if (!client) return null;
        return (
          <div key={env} className="space-y-3">
            <EnvHeading env={env} />
            <ApolloProvider client={client}>
              {children}
            </ApolloProvider>
          </div>
        );
      })}
    </div>
  );
}
