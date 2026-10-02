import { Link } from 'react-router-dom';
import { BookOpen, Mail } from 'lucide-react';
import MarketingHeader from '@/components/marketing/MarketingHeader';
import MarketingFooter from '@/components/marketing/MarketingFooter';

const SUPPORT_EMAIL = 'rob@homecast.cloud';

const linkClass = 'text-foreground hover:text-primary transition-colors underline';

/**
 * The page the App Store and Google Play "Support URL" point at. Apple rejects
 * a URL that doesn't lead to a way of asking for help (guideline 1.5), so the
 * contact route is the first thing on it.
 */
const Support = () => {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />

      <main className="pt-16">
        <section className="w-full py-16 px-6">
          <div className="mx-auto max-w-3xl">
            <h1 className="text-4xl font-bold mb-2">Support</h1>
            <p className="text-muted-foreground mb-12">
              Questions, problems or feedback about Homecast — we're here to help.
            </p>

            <div className="grid gap-4 sm:grid-cols-2 mb-12">
              <a
                href={`mailto:${SUPPORT_EMAIL}?subject=Homecast%20support`}
                className="group rounded-2xl border border-border p-6 hover:border-primary/50 transition-colors"
              >
                <Mail className="h-6 w-6 text-primary mb-3" />
                <h2 className="text-lg font-semibold mb-1">Email us</h2>
                <p className="text-sm text-muted-foreground mb-3">
                  For any question or problem, including billing and your account.
                </p>
                <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                  {SUPPORT_EMAIL}
                </span>
              </a>
              <a
                href="https://docs.homecast.cloud"
                className="group rounded-2xl border border-border p-6 hover:border-primary/50 transition-colors"
              >
                <BookOpen className="h-6 w-6 text-primary mb-3" />
                <h2 className="text-lg font-semibold mb-1">Read the documentation</h2>
                <p className="text-sm text-muted-foreground mb-3">
                  Setting up, connecting your Apple Home, and using the API, MCP and MQTT.
                </p>
                <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                  docs.homecast.cloud
                </span>
              </a>
            </div>

            <div className="space-y-8">
              <div>
                <h2 className="text-xl font-semibold mb-3">When You Email Us</h2>
                <p className="text-muted-foreground leading-relaxed mb-2">
                  Write from the address registered to your Homecast account, and tell us:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
                  <li>Which app you're using — Mac, iPhone, iPad, Android, or the web</li>
                  <li>What you were doing, and what happened instead</li>
                  <li>A screenshot, if something looks wrong</li>
                </ul>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">Subscriptions and Refunds</h2>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                  <li>
                    <strong className="text-foreground">Bought in the App Store:</strong>{' '}
                    Apple manages it. Cancel from{' '}
                    <a href="https://apps.apple.com/account/subscriptions" target="_blank" rel="noopener noreferrer" className={linkClass}>
                      apps.apple.com/account/subscriptions
                    </a>{' '}
                    or System Settings → Subscriptions on your Apple device, and request refunds at{' '}
                    <a href="https://reportaproblem.apple.com" target="_blank" rel="noopener noreferrer" className={linkClass}>
                      reportaproblem.apple.com
                    </a>.
                  </li>
                  <li>
                    <strong className="text-foreground">Bought on homecast.cloud:</strong>{' '}
                    manage or cancel it in Settings → Plan → Manage Subscription, or email us.
                  </li>
                </ul>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">Your Account and Data</h2>
                <p className="text-muted-foreground leading-relaxed">
                  Forgot your password? Reset it from the{' '}
                  <Link to="/forgot-password" className={linkClass}>sign-in screen</Link>.
                  To delete your account and its data, open Settings → Account → Delete Account
                  in the app, or see{' '}
                  <Link to="/delete-account" className={linkClass}>how to delete your account</Link>.
                  Read how we handle your data in our{' '}
                  <Link to="/privacy" className={linkClass}>Privacy Policy</Link>.
                </p>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-3">Who We Are</h2>
                <p className="text-muted-foreground leading-relaxed">
                  Homecast is made by Parob Ltd. Email{' '}
                  <a href={`mailto:${SUPPORT_EMAIL}`} className={linkClass}>{SUPPORT_EMAIL}</a>{' '}
                  for support, or{' '}
                  <a href="mailto:privacy@parob.com" className={linkClass}>privacy@parob.com</a>{' '}
                  for privacy requests.
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

export default Support;
