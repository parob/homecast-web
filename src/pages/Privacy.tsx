import MarketingHeader from '@/components/marketing/MarketingHeader';
import MarketingFooter from '@/components/marketing/MarketingFooter';

const Privacy = () => {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />

      <main className="pt-16">
        <section className="w-full py-16 px-6">
          <div className="mx-auto max-w-3xl">
            <h1 className="text-4xl font-bold mb-2">Privacy Policy</h1>
            <p className="text-muted-foreground mb-12">Last updated: March 2025</p>

            <div className="space-y-8">
              <div>
                <h2 className="text-xl font-semibold mb-3">1. Introduction</h2>
                <p className="text-muted-foreground leading-relaxed">
                  Parob Ltd ("we", "us", "our") operates Homecast. This Privacy Policy explains how we
                  collect, use, and protect your information when you use our Service.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">2. Information We Collect</h2>

                <h3 className="text-base font-medium mt-4 mb-2">Account Information</h3>
                <p className="text-muted-foreground leading-relaxed mb-2">When you create an account, we collect:</p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
                  <li>Email address</li>
                  <li>Password (securely hashed)</li>
                  <li>Name (optional)</li>
                </ul>

                <h3 className="text-base font-medium mt-4 mb-2">Payment Information</h3>
                <p className="text-muted-foreground leading-relaxed">
                  For paid subscriptions, payment is processed by our payment provider. We do not store
                  your full card details—only a token for recurring billing.
                </p>

                <h3 className="text-base font-medium mt-4 mb-2">HomeKit Data</h3>
                <p className="text-muted-foreground leading-relaxed mb-2">
                  <strong className="text-foreground">Important:</strong> Homecast routes commands to your HomeKit devices but does not
                  store your device states, sensor readings, or activity history on our servers. Your
                  HomeKit data flows through our relay but is not persisted.
                </p>
                <p className="text-muted-foreground leading-relaxed mb-2">We may temporarily process:</p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
                  <li>Device names and types (for display in the dashboard)</li>
                  <li>Room and home structure</li>
                  <li>Commands you send to devices</li>
                </ul>

                <h3 className="text-base font-medium mt-4 mb-2">Device Product Information</h3>
                <p className="text-muted-foreground leading-relaxed">
                  When the Smart Deals feature is enabled, we collect and store the manufacturer name and
                  model identifier of your HomeKit accessories (for example, "Signify" and "LCA001"). This
                  information is stored in aggregate form and is not linked to your account. We use it to
                  identify relevant deals on accessories compatible with your home. We do not store the
                  names you have given to your devices.
                </p>

                <h3 className="text-base font-medium mt-4 mb-2">Usage Data</h3>
                <p className="text-muted-foreground leading-relaxed mb-2">We collect anonymous usage data to improve the Service:</p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
                  <li>Feature usage patterns</li>
                  <li>Error reports and crash logs</li>
                  <li>Performance metrics</li>
                </ul>

                <h3 className="text-base font-medium mt-4 mb-2">Log Data</h3>
                <p className="text-muted-foreground leading-relaxed mb-2">Our servers automatically collect:</p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
                  <li>IP address</li>
                  <li>Browser type and version</li>
                  <li>Access times</li>
                  <li>Referring pages</li>
                </ul>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">3. How We Use Your Information</h2>
                <p className="text-muted-foreground leading-relaxed mb-2">We use your information to:</p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
                  <li>Provide and maintain the Service</li>
                  <li>Process your subscription and payments</li>
                  <li>Identify relevant deals on accessories compatible with your home</li>
                  <li>Send important service updates</li>
                  <li>Respond to support requests</li>
                  <li>Improve the Service</li>
                  <li>Detect and prevent fraud or abuse</li>
                </ul>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">4. Sharing Your Information</h2>
                <p className="text-muted-foreground leading-relaxed mb-2">We do not sell your personal information. We may share information with:</p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
                  <li><strong className="text-foreground">Service providers:</strong> Payment processors, hosting providers, analytics services</li>
                  <li><strong className="text-foreground">Deal partners:</strong> When you click a deal link, you are directed to the retailer's website (e.g., Amazon). The retailer may receive standard browser information (IP address, cookies) as part of the page visit. We do not send your personal information to deal partners. As an Amazon Associate, Homecast earns from qualifying purchases.</li>
                  <li><strong className="text-foreground">Legal requirements:</strong> When required by law or to protect our rights</li>
                  <li><strong className="text-foreground">Business transfers:</strong> In connection with a merger or acquisition</li>
                </ul>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">5. Smart Deals</h2>
                <p className="text-muted-foreground leading-relaxed mb-3">
                  The free tier includes Smart Deals — a feature that identifies price drops and deals on
                  smart home accessories compatible with your devices. This feature uses the manufacturer
                  and model information from your HomeKit accessories (in aggregate, not linked to your
                  account) to match relevant products.
                </p>
                <p className="text-muted-foreground leading-relaxed mb-3">
                  We process this information based on our legitimate interest in providing useful features
                  to our users (GDPR Article 6(1)(f)). No personal data is shared with retailers or
                  deal networks. Paid subscribers can disable Smart Deals in their account settings.
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  When you click a deal link, you will be directed to the retailer's website. Homecast may
                  earn a commission from qualifying purchases through deal programmes.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">6. Home Sharing</h2>
                <p className="text-muted-foreground leading-relaxed">
                  When you share access to your home via Homecast, the recipient can see the devices and
                  rooms you've shared. Share links may include passcodes you set. You control what is
                  shared and can revoke access at any time.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">7. Data Security</h2>
                <p className="text-muted-foreground leading-relaxed mb-2">We protect your data using:</p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
                  <li>TLS 1.3 encryption for all connections</li>
                  <li>Secure password hashing (PBKDF2)</li>
                  <li>Token-based authentication with configurable expiration</li>
                  <li>Regular security audits</li>
                </ul>
                <p className="text-muted-foreground leading-relaxed mt-3">
                  However, no method of transmission over the Internet is 100% secure. We cannot guarantee
                  absolute security.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">8. Data Retention</h2>
                <p className="text-muted-foreground leading-relaxed">
                  We retain your account information while your account is active. If you delete your account,
                  we will delete your personal data within 30 days, except where we are required to retain it
                  for legal purposes.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">9. Your Rights</h2>
                <p className="text-muted-foreground leading-relaxed mb-2">Depending on your location, you may have the right to:</p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
                  <li>Access your personal data</li>
                  <li>Correct inaccurate data</li>
                  <li>Delete your data</li>
                  <li>Export your data</li>
                  <li>Object to processing</li>
                  <li>Withdraw consent</li>
                  <li>Disable Smart Deals in your account settings (available to paid subscribers)</li>
                </ul>
                <p className="text-muted-foreground leading-relaxed mt-3">
                  To exercise these rights, contact us at privacy@parob.com.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">10. International Transfers</h2>
                <p className="text-muted-foreground leading-relaxed">
                  Your data may be processed in countries outside your own. We ensure appropriate safeguards
                  are in place for international transfers.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">11. Children's Privacy</h2>
                <p className="text-muted-foreground leading-relaxed">
                  The Service is not intended for children under 16. We do not knowingly collect information
                  from children under 16.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">12. Changes to This Policy</h2>
                <p className="text-muted-foreground leading-relaxed">
                  We may update this Privacy Policy from time to time. We will notify you of material changes
                  via email or through the Service.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">13. Contact Us</h2>
                <p className="text-muted-foreground leading-relaxed">
                  For privacy-related questions, contact us at:<br />
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

export default Privacy;
