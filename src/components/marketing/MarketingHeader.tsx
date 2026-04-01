import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Home, Menu } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { StagingSyncLabel } from '@/components/layout/StagingBanner';

const navItems = [
  { to: '/', label: 'Home' },
  { to: '/how-it-works', label: 'How it Works' },
  { to: '/pricing', label: 'Pricing' },
  { href: 'https://docs.homecast.cloud', label: 'Docs' },
];

const MarketingHeader = () => {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = (path: string) => location.pathname === path;

  const authButton = (className: string, onClick?: () => void) =>
    isAuthenticated ? (
      <Button size="sm" className={className} asChild onClick={onClick}>
        <Link to="/portal">Portal</Link>
      </Button>
    ) : (
      <Button size="sm" className={className} asChild onClick={onClick}>
        <Link to="/login">Sign In</Link>
      </Button>
    );

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto grid h-16 max-w-7xl grid-cols-2 sm:grid-cols-3 items-center px-3 sm:px-6">
        <Link to="/" className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 shadow-lg shadow-primary/25">
            <Home className="h-4 w-4 sm:h-5 sm:w-5 text-primary-foreground" />
          </div>
          <span className="text-sm sm:text-xl font-bold tracking-tight whitespace-nowrap">Homecast</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden sm:flex items-center justify-center gap-2">
          {navItems.map((item) => (
            <Button
              key={item.label}
              variant={item.to && isActive(item.to) ? 'secondary' : 'ghost'}
              size="sm"
              className="text-sm px-3 h-8"
              asChild
            >
              {item.to ? (
                <Link to={item.to}>{item.label}</Link>
              ) : (
                <a href={item.href}>{item.label}</a>
              )}
            </Button>
          ))}
        </div>

        {/* Desktop auth button */}
        <div className="hidden sm:flex justify-end items-center gap-2">
          <StagingSyncLabel />
          <a
            href="https://github.com/parob/homecast"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm px-3 h-8 rounded-md text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
            GitHub
          </a>
          {authButton('text-sm px-3 h-8')}
        </div>

        {/* Mobile nav */}
        <div className="flex sm:hidden items-center justify-end gap-1.5">
          <StagingSyncLabel />
          {authButton('text-[15px] px-2.5 h-8')}
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[260px] p-0" aria-describedby={undefined}>
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <nav className="flex flex-col gap-1 p-4 pt-12">
                {navItems.map((item) => (
                  <Button
                    key={item.label}
                    variant={item.to && isActive(item.to) ? 'secondary' : 'ghost'}
                    className="justify-start h-10 text-base"
                    asChild
                    onClick={() => setMenuOpen(false)}
                  >
                    {item.to ? (
                      <Link to={item.to}>{item.label}</Link>
                    ) : (
                      <a href={item.href}>{item.label}</a>
                    )}
                  </Button>
                ))}
                <div className="my-2 border-t" />
                {authButton('justify-start h-10 text-base', () => setMenuOpen(false))}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </nav>
  );
};

export default MarketingHeader;
