import { Link } from 'react-router-dom';
import MarketingHeader from '@/components/marketing/MarketingHeader';
import MarketingFooter from '@/components/marketing/MarketingFooter';

const DeleteAccount = () => {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />

      <main className="pt-16">
        <section className="w-full py-16 px-6">
          <div className="mx-auto max-w-3xl">
            <h1 className="text-4xl font-bold mb-2">Delete Your Account</h1>
            <p className="text-muted-foreground mb-12">
              Homecast by Parob Ltd — account and data deletion
            </p>

            <div className="space-y-8">
              <div>
                <h2 className="text-xl font-semibold mb-3">Delete Your Account in the App</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  You can delete your account yourself, at any time, from the Homecast app or{' '}
                  <a href="https://homecast.cloud" className="text-foreground hover:text-primary transition-colors underline">homecast.cloud</a>:
                </p>
                <ol className="list-decimal list-inside text-muted-foreground space-y-2 ml-4">
                  <li>Sign in and open <strong className="text-foreground">Settings → Account</strong></li>
                  <li>Choose <strong className="text-foreground">Delete Account</strong></li>
                  <li>Enter your password to confirm. Your account and its data are deleted immediately.</li>
                </ol>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">Subscriptions</h2>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                  <li>
                    <strong className="text-foreground">Web subscription (Stripe):</strong>{' '}
                    cancelled automatically when you delete your account. You won't be charged again.
                  </li>
                  <li>
                    <strong className="text-foreground">App Store subscription:</strong>{' '}
                    only you can cancel it, from{' '}
                    <a href="https://apps.apple.com/account/subscriptions" target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-primary transition-colors underline">
                      apps.apple.com/account/subscriptions
                    </a>{' '}
                    or System Settings → Subscriptions on your Apple device. Deleting your Homecast
                    account does not stop Apple's charges, so cancel there first.
                  </li>
                </ul>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">Can't Sign In?</h2>
                <p className="text-muted-foreground leading-relaxed">
                  Reset your password from the sign-in screen, or email{' '}
                  <a href="mailto:privacy@parob.com?subject=Delete%20my%20account" className="text-foreground hover:text-primary transition-colors underline">
                    privacy@parob.com
                  </a>{' '}
                  from the address registered to your account with "Delete my account" in the subject.
                  We'll process it within 3 business days.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">Data That Will Be Deleted</h2>
                <p className="text-muted-foreground leading-relaxed mb-2">
                  When your account is deleted, the following data is permanently removed:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
                  <li>Account information (email address, name, password hash)</li>
                  <li>Subscription and billing records</li>
                  <li>Home configurations and room layouts</li>
                  <li>Shared home memberships</li>
                  <li>Automations and webhooks</li>
                  <li>API tokens and active sessions</li>
                  <li>Notification preferences and push tokens</li>
                </ul>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">Data That May Be Retained</h2>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
                  <li>Anonymized, aggregated usage analytics (not linked to your identity)</li>
                  <li>Records we are legally required to retain, such as financial and tax records (up to 7 years)</li>
                </ul>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">Timeline</h2>
                <p className="text-muted-foreground leading-relaxed">
                  Deleting your account in the app removes it and its data immediately. A request
                  sent by email is completed within 30 days, and we'll email you once it's done.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">Questions</h2>
                <p className="text-muted-foreground leading-relaxed">
                  For questions about data deletion or your privacy rights, contact us at{' '}
                  <a href="mailto:privacy@parob.com" className="text-foreground hover:text-primary transition-colors underline">
                    privacy@parob.com
                  </a>. You can also read our{' '}
                  <Link to="/privacy" className="text-foreground hover:text-primary transition-colors underline">
                    Privacy Policy
                  </Link>{' '}
                  for more information.
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

export default DeleteAccount;
