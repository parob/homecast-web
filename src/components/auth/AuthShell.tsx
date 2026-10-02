/**
 * The frame every account page shares — sign in, sign up, forgot and reset
 * password, verify email, subscribe.
 *
 * Each of those pages used to paste its own copy of the same gradient, logo
 * and glass card, and none of them looked like the site you had just come
 * from. This is the one copy.
 *
 * On the website it is the site's own furniture: the logo goes home, headings
 * are in the landing page's display face, and on a wide screen the form sits
 * beside the live dashboard the landing page opens with. Inside the apps and
 * on a Community relay there is no site to go back to and nothing to sell,
 * so it is just the logo and the form.
 */
import { lazy, Suspense, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { HomecastMark } from '@/components/HomecastMark';
import { isCommunity } from '@/lib/config';
import { isInNativeAppShell, MAC_APP_TITLEBAR_INSET_PX } from '@/lib/platform';
import { cn } from '@/lib/utils';

const AuthShowcase = lazy(() => import('./AuthShowcase'));

/** The website, as opposed to an app shell or a Community relay. */
export function isWebsite(): boolean {
  return !isCommunity && !isInNativeAppShell();
}

const DISPLAY_FONT = { fontFamily: "'Outfit', sans-serif" } as const;

function Logo({ linked }: { linked: boolean }) {
  const mark = (
    <span className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 shadow-lg shadow-primary/25">
        <HomecastMark className="h-[18px] w-[18px] text-primary-foreground" />
      </span>
      <span className="flex flex-col">
        <span className="text-lg font-bold leading-tight">Homecast</span>
        {isCommunity && <span className="text-[11px] font-medium text-muted-foreground leading-tight">Community Edition</span>}
      </span>
    </span>
  );
  return linked ? <Link to="/" aria-label="Homecast home">{mark}</Link> : mark;
}

export function AuthShell({ children, aside }: {
  children: ReactNode;
  /** Something small for the top-right corner, e.g. "New here? Sign up". */
  aside?: ReactNode;
}) {
  const website = isWebsite();
  // The native Mac app runs the page up under its transparent title bar, so the
  // logo would sit on the traffic lights. Drop the header below them. Only the
  // native shell's own flag: a browser on a Mac, or a Safari "Add to Dock" web
  // app (which checkIsInMacApp also counts), has a title bar of its own.
  const nativeMac = typeof window !== 'undefined'
    && !!(window as unknown as { isHomecastMacApp?: boolean }).isHomecastMacApp;
  const macInset = nativeMac ? { paddingTop: MAC_APP_TITLEBAR_INSET_PX } : undefined;
  return (
    <div className="flex min-h-screen flex-col bg-background" style={macInset}>
      <header className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6">
        <Logo linked={website} />
        {aside && <div className="text-sm text-muted-foreground">{aside}</div>}
      </header>
      <main className={cn(
        'mx-auto grid w-full max-w-7xl flex-1 gap-8 px-4 pb-6 sm:px-6',
        website && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:pb-8',
      )}>
        <section className="flex items-center justify-center py-8 lg:py-12">
          <div className="w-full max-w-[400px]">{children}</div>
        </section>
        {website && (
          <aside className="relative hidden overflow-hidden rounded-3xl lg:block">
            <Suspense fallback={<div className="absolute inset-0 bg-muted" />}>
              <AuthShowcase />
            </Suspense>
          </aside>
        )}
      </main>
    </div>
  );
}

/** The form's container. No box of its own: the page is the surface. */
export function AuthCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card className={cn('border-0 bg-transparent shadow-none [&>*]:px-0 [&>form>*]:px-0', className)}>
      {children}
    </Card>
  );
}

export function AuthTitle({ children }: { children: ReactNode }) {
  return (
    <CardTitle className="text-3xl font-bold tracking-tight" style={DISPLAY_FONT}>
      {children}
    </CardTitle>
  );
}

export function AuthDescription({ children }: { children: ReactNode }) {
  return <CardDescription className="text-sm leading-relaxed">{children}</CardDescription>;
}

/** A page with nothing to show yet. */
export function AuthLoading() {
  return (
    <AuthShell>
      <div className="flex justify-center py-16">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    </AuthShell>
  );
}
