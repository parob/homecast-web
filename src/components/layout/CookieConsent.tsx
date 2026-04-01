import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

declare global {
  interface Window {
    isHomecastApp?: boolean;
    isHomecastMacApp?: boolean;
  }
  // Global gtag defined in index.html
  function gtag(...args: unknown[]): void;
}

function grantConsent() {
  gtag('consent', 'update', {
    ad_storage: 'granted',
    ad_user_data: 'granted',
    ad_personalization: 'granted',
    analytics_storage: 'granted',
  });

  const platform = window.isHomecastMacApp ? 'mac' : window.isHomecastApp ? 'ios' : 'web';
  gtag('set', 'user_properties', { app_platform: platform });
}

const STORAGE_KEY = 'cookie-consent';

function CookiePolicyContent() {
  return (
    <div className="space-y-6 text-sm">
      <div>
        <h3 className="font-semibold mb-2">1. What Are Cookies</h3>
        <p className="text-muted-foreground leading-relaxed">
          Cookies are small text files stored on your device when you visit a website. They help
          websites remember your preferences and improve your experience.
        </p>
      </div>

      <div>
        <h3 className="font-semibold mb-2">2. How Homecast Uses Cookies</h3>
        <p className="text-muted-foreground leading-relaxed mb-3">We use cookies for the following purposes:</p>

        <h4 className="text-xs font-medium mb-2">Essential Cookies</h4>
        <p className="text-muted-foreground leading-relaxed mb-2">
          These cookies are necessary for the Service to function and cannot be disabled.
        </p>
        <table className="w-full text-xs border border-border rounded-lg overflow-hidden mb-4">
          <thead>
            <tr className="bg-muted/50">
              <th className="text-left p-2 font-medium">Cookie</th>
              <th className="text-left p-2 font-medium">Purpose</th>
              <th className="text-left p-2 font-medium">Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            <tr>
              <td className="p-2"><code className="text-xs bg-muted px-1 py-0.5 rounded">session</code></td>
              <td className="p-2 text-muted-foreground">Maintains your login session</td>
              <td className="p-2 text-muted-foreground">Session</td>
            </tr>
            <tr>
              <td className="p-2"><code className="text-xs bg-muted px-1 py-0.5 rounded">auth_token</code></td>
              <td className="p-2 text-muted-foreground">Authentication token for API access</td>
              <td className="p-2 text-muted-foreground">30 days</td>
            </tr>
          </tbody>
        </table>

        <h4 className="text-xs font-medium mb-2">Analytics Cookies</h4>
        <p className="text-muted-foreground leading-relaxed mb-2">
          We use analytics to understand how visitors use the Service. This helps us improve
          the experience.
        </p>
        <table className="w-full text-xs border border-border rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-muted/50">
              <th className="text-left p-2 font-medium">Cookie</th>
              <th className="text-left p-2 font-medium">Purpose</th>
              <th className="text-left p-2 font-medium">Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            <tr>
              <td className="p-2"><code className="text-xs bg-muted px-1 py-0.5 rounded">_ga</code></td>
              <td className="p-2 text-muted-foreground">Google Analytics - distinguishes users</td>
              <td className="p-2 text-muted-foreground">2 years</td>
            </tr>
            <tr>
              <td className="p-2"><code className="text-xs bg-muted px-1 py-0.5 rounded">_gid</code></td>
              <td className="p-2 text-muted-foreground">Google Analytics - distinguishes users</td>
              <td className="p-2 text-muted-foreground">24 hours</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="font-semibold mb-2">3. Third-Party Cookies</h3>
        <p className="text-muted-foreground leading-relaxed mb-1">
          Some cookies are set by third-party services we use:
        </p>
        <ul className="list-disc list-inside text-muted-foreground space-y-0.5 ml-2">
          <li><strong className="text-foreground">Stripe:</strong> Payment processing</li>
          <li><strong className="text-foreground">Google Analytics:</strong> Usage analytics</li>
        </ul>
      </div>

      <div>
        <h3 className="font-semibold mb-2">4. Managing Cookies</h3>
        <p className="text-muted-foreground leading-relaxed">
          You can control cookies through your browser settings. You can view, delete, or block
          cookies at any time. Note that blocking cookies may affect functionality.
        </p>
      </div>

      <div>
        <h3 className="font-semibold mb-2">5. Contact Us</h3>
        <p className="text-muted-foreground leading-relaxed">
          For questions about our use of cookies, contact us at privacy@parob.com
        </p>
      </div>
    </div>
  );
}

export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);

  useEffect(() => {
    // Never show in native app webviews or community mode — no third-party cookies to consent to
    const isNativeApp = !!(window as any).webkit?.messageHandlers?.homecast
      || !!(window as any).isHomecastMacApp
      || !!(window as any).isHomecastIOSApp
      || !!(window as any).isHomecastAndroidApp
      || !!(window as any).__HOMECAST_COMMUNITY__;
    if (isNativeApp) {
      localStorage.setItem(STORAGE_KEY, 'granted');
      grantConsent();
      return;
    }
    if (!localStorage.getItem(STORAGE_KEY)) {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-[10002] p-4 pointer-events-none" style={{ paddingBottom: 'calc(var(--safe-area-bottom, 0px) + 16px)' }}>
        <div className="pointer-events-auto mx-auto max-w-lg rounded-2xl border border-border bg-card p-4 shadow-lg">
          <p className="text-sm text-muted-foreground mb-3">
            We use cookies and analytics to improve your experience.{' '}
            <button onClick={() => setPolicyOpen(true)} className="text-primary hover:underline">
              Cookie Policy
            </button>
          </p>
          <div className="flex gap-2 justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                localStorage.setItem(STORAGE_KEY, 'denied');
                setVisible(false);
              }}
            >
              Reject
            </Button>
            <Button
              size="sm"
              onClick={() => {
                localStorage.setItem(STORAGE_KEY, 'granted');
                grantConsent();
                setVisible(false);
              }}
            >
              Accept
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={policyOpen} onOpenChange={setPolicyOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Cookie Policy</DialogTitle>
          </DialogHeader>
          <CookiePolicyContent />
        </DialogContent>
      </Dialog>
    </>
  );
}
