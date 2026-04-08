import { Link } from 'react-router-dom';
import { Home, Mail } from 'lucide-react';
import { GITHUB_SPONSORS_URL } from '@/lib/donate-config';

const MarketingFooter = () => {
  return (
    <footer className="w-full border-t border-border bg-background">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
          {/* Brand */}
          <div className="col-span-1 md:col-span-2">
            <Link to="/" className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 shadow-lg shadow-primary/25">
                <Home className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="text-xl font-bold tracking-tight">Homecast</span>
            </Link>
            <p className="text-sm text-muted-foreground">
              A product by <a href="https://www.parob.com" target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-primary transition-colors">Parob Ltd</a>
            </p>
          </div>

          {/* Links */}
          <div>
            <h3 className="font-semibold mb-4">Product</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link to="/how-it-works" className="hover:text-foreground transition-colors">How it Works</Link></li>
              <li><Link to="/pricing" className="hover:text-foreground transition-colors">Pricing</Link></li>
              <li><a href="https://docs.homecast.cloud" className="hover:text-foreground transition-colors">Documentation</a></li>
              <li><a href="https://docs.homecast.cloud/developers/overview" className="hover:text-foreground transition-colors">API Reference</a></li>
              <li><a href={GITHUB_SPONSORS_URL} target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Sponsor</a></li>
            </ul>
          </div>

          {/* Legal & Contact */}
          <div>
            <h3 className="font-semibold mb-4">Legal</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link to="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link></li>
              <li><Link to="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link></li>
              <li><Link to="/cookies" className="hover:text-foreground transition-colors">Cookie Policy</Link></li>
              <li><Link to="/delete-account" className="hover:text-foreground transition-colors">Delete Account</Link></li>
            </ul>
            <h3 className="font-semibold mb-4 mt-8">Contact</h3>
            <a href="mailto:rob@homecast.cloud" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <Mail className="h-4 w-4" />
              rob@homecast.cloud
            </a>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-12 pt-8 border-t border-border flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} Parob Ltd. All rights reserved.
          </p>
          <p className="text-xs text-muted-foreground">
            Apple, HomeKit, and the Apple Home logo are trademarks of Apple Inc.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default MarketingFooter;
