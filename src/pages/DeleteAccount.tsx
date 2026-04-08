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
                <h2 className="text-xl font-semibold mb-3">How to Request Deletion</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  To delete your Homecast account and associated data, follow these steps:
                </p>
                <ol className="list-decimal list-inside text-muted-foreground space-y-3 ml-4">
                  <li>
                    Send an email to{' '}
                    <a href="mailto:privacy@parob.com?subject=Delete%20my%20account" className="text-foreground hover:text-primary transition-colors underline">
                      privacy@parob.com
                    </a>{' '}
                    from the email address registered to your account
                  </li>
                  <li>Include <strong className="text-foreground">"Delete my account"</strong> in the subject line</li>
                  <li>We will confirm receipt and process your request within 3 business days</li>
                </ol>
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
                  Your personal data will be deleted within 30 days of your request being confirmed.
                  You will receive an email once the deletion is complete.
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
