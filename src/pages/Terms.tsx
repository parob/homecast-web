import MarketingHeader from '@/components/marketing/MarketingHeader';
import MarketingFooter from '@/components/marketing/MarketingFooter';

const Terms = () => {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />

      <main className="pt-16">
        <section className="w-full py-16 px-6">
          <div className="mx-auto max-w-3xl">
            <h1 className="text-4xl font-bold mb-2">Terms of Service</h1>
            <p className="text-muted-foreground mb-12">Last updated: May 2026</p>

            <div className="space-y-8">
              <div>
                <h2 className="text-xl font-semibold mb-3">1. Agreement to Terms</h2>
                <p className="text-muted-foreground leading-relaxed">
                  By accessing or using Homecast ("Service"), provided by Parob Ltd ("we", "us", "our"),
                  you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">2. Description of Service</h2>
                <p className="text-muted-foreground leading-relaxed mb-3">
                  Homecast is a bridge service that connects Apple HomeKit devices to other platforms and APIs.
                  The Service includes:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
                  <li>The Homecast macOS application</li>
                  <li>Homecast Cloud relay infrastructure</li>
                  <li>Web dashboard at homecast.cloud</li>
                  <li>APIs (GraphQL, REST, WebSocket, MCP)</li>
                  <li>Mobile applications</li>
                </ul>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">3. Account Registration</h2>
                <p className="text-muted-foreground leading-relaxed">
                  You must create an account to use the Service. You agree to provide accurate information
                  and keep your credentials secure. You are responsible for all activity under your account.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">4. Acceptable Use</h2>
                <p className="text-muted-foreground leading-relaxed mb-3">You agree not to:</p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
                  <li>Use the Service for any unlawful purpose</li>
                  <li>Attempt to gain unauthorised access to the Service or other users' accounts</li>
                  <li>Interfere with or disrupt the Service</li>
                  <li>Reverse engineer the Service except as permitted by law</li>
                  <li>Use the Service to control devices you don't own or have permission to control</li>
                  <li>Resell or redistribute the Service without permission</li>
                </ul>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">5. HomeKit and Apple</h2>
                <p className="text-muted-foreground leading-relaxed">
                  Homecast integrates with Apple HomeKit. Apple, HomeKit, and related marks are trademarks
                  of Apple Inc. We are not affiliated with, endorsed by, or sponsored by Apple.
                  Your use of HomeKit is also subject to Apple's terms and conditions.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">6. Subscriptions and Payments</h2>
                <p className="text-muted-foreground leading-relaxed mb-3">
                  Some features require a paid subscription. We currently offer two
                  auto-renewing monthly subscription plans:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4 mb-3">
                  <li><strong>Standard</strong> — unlimited HomeKit accessories, push notifications, MQTT broker. Billed monthly. App Store: $10.99/month (or local equivalent). Web (Stripe): $8/month.</li>
                  <li><strong>Cloud</strong> — everything in Standard, plus a managed cloud relay we host for you on dedicated Apple hardware (no Mac required at home). Billed monthly. App Store: $21.99/month (or local equivalent). Web (Stripe): $16/month.</li>
                </ul>

                <h3 className="text-base font-semibold mt-4 mb-2">6.1 Auto-renewal</h3>
                <p className="text-muted-foreground leading-relaxed mb-3">
                  Subscriptions automatically renew at the end of each billing period unless
                  cancelled at least 24 hours before the end of the current period. Your
                  payment method (Apple ID for App Store purchases, or your card on file for
                  web purchases through Stripe) will be charged for renewal within 24 hours
                  prior to the end of the current period at the then-current price for the
                  same plan length.
                </p>

                <h3 className="text-base font-semibold mt-4 mb-2">6.2 Managing your subscription</h3>
                <p className="text-muted-foreground leading-relaxed mb-3">
                  <strong>App Store subscribers:</strong> manage or cancel from your{' '}
                  <a href="https://apps.apple.com/account/subscriptions" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">App Store account settings</a>{' '}
                  (Settings → Apple ID → Subscriptions on iOS, or System Settings → [your name] → Media &amp; Purchases → Subscriptions on macOS). Cancellation takes effect at the end of the current paid period; access continues until then.
                </p>
                <p className="text-muted-foreground leading-relaxed mb-3">
                  <strong>Web subscribers:</strong> manage or cancel from Settings → Plan → Manage Subscription
                  inside the Homecast web portal, which opens the Stripe customer portal where
                  you can update payment, view invoices, or cancel.
                </p>

                <h3 className="text-base font-semibold mt-4 mb-2">6.3 Pricing changes</h3>
                <p className="text-muted-foreground leading-relaxed mb-3">
                  We may change subscription prices from time to time. Material price changes
                  will be communicated in advance. Apple notifies App Store subscribers and
                  requires explicit consent to a price increase before the next renewal cycle;
                  if not consented to, the subscription will not renew.
                </p>

                <h3 className="text-base font-semibold mt-4 mb-2">6.4 Refunds</h3>
                <p className="text-muted-foreground leading-relaxed mb-3">
                  We do not provide refunds for partial periods. App Store purchases are
                  refunded according to{' '}
                  <a href="https://support.apple.com/en-us/HT204084" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Apple's refund policy</a>;
                  refund requests for App Store purchases are handled by Apple directly.
                  Web (Stripe) purchases follow Stripe's standard refund handling.
                </p>

                <h3 className="text-base font-semibold mt-4 mb-2">6.5 No trials currently</h3>
                <p className="text-muted-foreground leading-relaxed">
                  We do not currently offer free trials or introductory pricing. The free tier
                  (Basic) is genuinely free and ad-supported as described in section 7.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">7. Free Tier</h2>
                <p className="text-muted-foreground leading-relaxed">
                  The free tier is limited to 10 accessories and includes Smart Deals — personalised deal
                  recommendations for accessories compatible with your home. Homecast may earn a commission
                  when you purchase through deal links. The free tier may be modified or discontinued at our
                  discretion with reasonable notice. Paid subscriptions remove the accessory limit and allow
                  you to disable Smart Deals.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">8. Service Availability</h2>
                <p className="text-muted-foreground leading-relaxed">
                  We strive to maintain high availability but do not guarantee uninterrupted service.
                  The Service may be temporarily unavailable for maintenance, updates, or circumstances
                  beyond our control. Self-hosted users retain local functionality during cloud outages.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">9. Data and Privacy</h2>
                <p className="text-muted-foreground leading-relaxed">
                  Your use of the Service is also governed by our <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a>.
                  We route commands between your devices but do not store your HomeKit device states
                  on our servers.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">10. Intellectual Property</h2>
                <p className="text-muted-foreground leading-relaxed">
                  The Service, including its design, features, and content, is owned by Parob Ltd and
                  protected by intellectual property laws. You retain ownership of your data.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">11. Disclaimer of Warranties</h2>
                <p className="text-muted-foreground leading-relaxed">
                  The Service is provided "as is" without warranties of any kind, express or implied.
                  We do not warrant that the Service will be error-free, secure, or uninterrupted.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">12. Limitation of Liability</h2>
                <p className="text-muted-foreground leading-relaxed">
                  To the maximum extent permitted by law, Parob Ltd shall not be liable for any indirect,
                  incidental, special, consequential, or punitive damages, or any loss of profits or data,
                  arising from your use of the Service.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">13. Indemnification</h2>
                <p className="text-muted-foreground leading-relaxed">
                  You agree to indemnify and hold harmless Parob Ltd from any claims, damages, or expenses
                  arising from your use of the Service or violation of these Terms.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">14. Termination</h2>
                <p className="text-muted-foreground leading-relaxed">
                  We may suspend or terminate your account for violation of these Terms or for any reason
                  with reasonable notice. Upon termination, your right to use the Service ceases immediately.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">15. Changes to Terms</h2>
                <p className="text-muted-foreground leading-relaxed">
                  We may update these Terms from time to time. We will notify you of material changes
                  via email or through the Service. Continued use after changes constitutes acceptance.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">16. Governing Law</h2>
                <p className="text-muted-foreground leading-relaxed">
                  These Terms are governed by the laws of England and Wales. Any disputes shall be
                  resolved in the courts of England and Wales.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">17. Contact</h2>
                <p className="text-muted-foreground leading-relaxed">
                  For questions about these Terms, contact us at:<br />
                  Parob Ltd<br />
                  Email: legal@parob.com
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

export default Terms;
