/**
 * The landing page.
 *
 * Nothing on it is a screenshot. The hero is both dashboards — desktop and
 * phone — replicated from the app at their own proportions and sharing one
 * home, so a tap on the phone shows on the desktop. Each feature row shows a
 * working, basic version of the feature beside one sentence about it. See
 * components/marketing/landing.
 */
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import MarketingHeader from '@/components/marketing/MarketingHeader';
import MarketingFooter from '@/components/marketing/MarketingFooter';
import { HeroText } from '@/components/marketing/landing/HeroCtas';
import { FeatureRows } from '@/components/marketing/landing/FeatureRows';
import { DashboardDemo, MobileDashboardDemo, useHomeState } from '@/components/marketing/landing/demos';

const Index = () => {
  const { isLoading } = useAuth();
  const home = useHomeState();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen max-w-[100vw] overflow-x-hidden bg-background">
      <MarketingHeader />

      <div className="relative mx-auto max-w-6xl px-6 pt-24 pb-12 lg:pt-32 lg:pb-16">
        {/* One home on both screens; the phone is cropped to the desktop's height. Below `sm` only the phone shows. */}
        <div className="mb-10 grid items-start gap-3 sm:[grid-template-columns:1fr_0.33fr]">
          <DashboardDemo home={home} className="hidden sm:block" />
          <MobileDashboardDemo home={home} className="mx-auto w-full max-w-[280px] sm:max-w-none" />
        </div>
        <HeroText />
      </div>

      <FeatureRows />
      <MarketingFooter />
    </div>
  );
};

export default Index;
