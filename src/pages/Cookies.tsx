import MarketingHeader from '@/components/marketing/MarketingHeader';
import MarketingFooter from '@/components/marketing/MarketingFooter';

const Cookies = () => {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />

      <main className="pt-16">
        <section className="w-full py-16 px-6">
          <div className="mx-auto max-w-3xl">
            <h1 className="text-4xl font-bold mb-2">Cookie Policy</h1>
            <p className="text-muted-foreground mb-12">Last updated: January 2025</p>

            <div className="space-y-8">
              <div>
                <h2 className="text-xl font-semibold mb-3">1. What Are Cookies</h2>
                <p className="text-muted-foreground leading-relaxed">
                  Cookies are small text files stored on your device when you visit a website. They help
                  websites remember your preferences and improve your experience.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">2. How Homecast Uses Cookies</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">We use cookies for the following purposes:</p>

                <h3 className="text-base font-medium mt-4 mb-3">Essential Cookies</h3>
                <p className="text-muted-foreground leading-relaxed mb-3">
                  These cookies are necessary for the Service to function and cannot be disabled.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="text-left p-3 font-medium">Cookie</th>
                        <th className="text-left p-3 font-medium">Purpose</th>
                        <th className="text-left p-3 font-medium">Duration</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      <tr>
                        <td className="p-3"><code className="text-xs bg-muted px-1.5 py-0.5 rounded">session</code></td>
                        <td className="p-3 text-muted-foreground">Maintains your login session</td>
                        <td className="p-3 text-muted-foreground">Session</td>
                      </tr>
                      <tr>
                        <td className="p-3"><code className="text-xs bg-muted px-1.5 py-0.5 rounded">auth_token</code></td>
                        <td className="p-3 text-muted-foreground">Authentication token for API access</td>
                        <td className="p-3 text-muted-foreground">30 days</td>
                      </tr>
                      <tr>
                        <td className="p-3"><code className="text-xs bg-muted px-1.5 py-0.5 rounded">csrf_token</code></td>
                        <td className="p-3 text-muted-foreground">Protects against cross-site request forgery</td>
                        <td className="p-3 text-muted-foreground">Session</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <h3 className="text-base font-medium mt-6 mb-3">Preference Cookies</h3>
                <p className="text-muted-foreground leading-relaxed mb-3">
                  These cookies remember your settings and preferences.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="text-left p-3 font-medium">Cookie</th>
                        <th className="text-left p-3 font-medium">Purpose</th>
                        <th className="text-left p-3 font-medium">Duration</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      <tr>
                        <td className="p-3"><code className="text-xs bg-muted px-1.5 py-0.5 rounded">theme</code></td>
                        <td className="p-3 text-muted-foreground">Remembers your light/dark mode preference</td>
                        <td className="p-3 text-muted-foreground">1 year</td>
                      </tr>
                      <tr>
                        <td className="p-3"><code className="text-xs bg-muted px-1.5 py-0.5 rounded">dashboard_layout</code></td>
                        <td className="p-3 text-muted-foreground">Remembers your dashboard layout preferences</td>
                        <td className="p-3 text-muted-foreground">1 year</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <h3 className="text-base font-medium mt-6 mb-3">Analytics Cookies</h3>
                <p className="text-muted-foreground leading-relaxed mb-3">
                  We use analytics to understand how visitors use the Service. This helps us improve
                  the experience.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="text-left p-3 font-medium">Cookie</th>
                        <th className="text-left p-3 font-medium">Purpose</th>
                        <th className="text-left p-3 font-medium">Duration</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      <tr>
                        <td className="p-3"><code className="text-xs bg-muted px-1.5 py-0.5 rounded">_ga</code></td>
                        <td className="p-3 text-muted-foreground">Google Analytics - distinguishes users</td>
                        <td className="p-3 text-muted-foreground">2 years</td>
                      </tr>
                      <tr>
                        <td className="p-3"><code className="text-xs bg-muted px-1.5 py-0.5 rounded">_gid</code></td>
                        <td className="p-3 text-muted-foreground">Google Analytics - distinguishes users</td>
                        <td className="p-3 text-muted-foreground">24 hours</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">3. Third-Party Cookies</h2>
                <p className="text-muted-foreground leading-relaxed mb-2">
                  Some cookies are set by third-party services we use:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
                  <li><strong className="text-foreground">Stripe:</strong> Payment processing (if you have a subscription)</li>
                  <li><strong className="text-foreground">Google Analytics:</strong> Usage analytics</li>
                </ul>
                <p className="text-muted-foreground leading-relaxed mt-3">
                  These services have their own privacy policies governing the use of their cookies.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">4. Managing Cookies</h2>
                <p className="text-muted-foreground leading-relaxed mb-2">
                  You can control cookies through your browser settings. Most browsers allow you to:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
                  <li>View cookies stored on your device</li>
                  <li>Delete all or specific cookies</li>
                  <li>Block cookies from specific sites</li>
                  <li>Block all cookies (note: this may affect functionality)</li>
                </ul>
                <p className="text-muted-foreground leading-relaxed mt-4 mb-2">
                  Instructions for common browsers:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
                  <li><a href="https://support.google.com/chrome/answer/95647" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Chrome</a></li>
                  <li><a href="https://support.mozilla.org/en-US/kb/cookies-information-websites-store-on-your-computer" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Firefox</a></li>
                  <li><a href="https://support.apple.com/en-gb/guide/safari/sfri11471/mac" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Safari</a></li>
                  <li><a href="https://support.microsoft.com/en-us/microsoft-edge/delete-cookies-in-microsoft-edge-63947406-40ac-c3b8-57b9-2a946a29ae09" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Edge</a></li>
                </ul>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">5. Homecast macOS App</h2>
                <p className="text-muted-foreground leading-relaxed">
                  The Homecast macOS app uses local storage rather than cookies to store preferences
                  and authentication tokens. This data is stored securely on your device.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">6. Changes to This Policy</h2>
                <p className="text-muted-foreground leading-relaxed">
                  We may update this Cookie Policy from time to time. Changes will be posted on this page
                  with an updated revision date.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">7. Contact Us</h2>
                <p className="text-muted-foreground leading-relaxed">
                  For questions about our use of cookies, contact us at:<br />
                  Parob Ltd<br />
                  Email: privacy@parob.com
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
};

export default Cookies;
