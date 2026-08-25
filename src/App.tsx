import { Toaster } from "@/components/ui/sonner";
import { MacAppInsetVar } from "@/components/MacAppInsetVar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApolloProvider } from "@apollo/client/react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ScrollToTop } from "@/components/ScrollToTop";
import { StagingBanner } from "@/components/layout/StagingBanner";
import { CookieConsent } from "@/components/layout/CookieConsent";
import { apolloClient } from "@/lib/apollo";
import { isInNativeAppShell } from "@/lib/platform";
import { resolveOpenTarget } from "@/lib/open-target";
import { AuthProvider } from "@/contexts/AuthContext";
import { ShakeToReport } from "@/components/report/ShakeToReport";
import { PushRegistration } from "@/components/PushRegistration";
import { WebSocketProvider } from "@/contexts/WebSocketContext";
import { DebugDock } from "@/components/debug/DebugDock";
import { isCommunity } from "@/lib/config";
import { hasCloud } from "@/lib/cloud";
import { lazy, Suspense, type ReactElement } from "react";
import { AppBootFallback } from "@/components/LoadingSkeletons";
import { RelayRouteBanner } from "@/components/layout/RelayRouteBanner";
// Login stays eager: for a signed-out visitor it IS the first screen, and
// making it a second round trip would just move the wait. The rest are not on
// any first-paint path — a signed-in user going straight to /portal was paying
// for all of them in the entry chunk.
import Login from "./pages/Login";
const Signup = lazy(() => import("./pages/Signup"));
const OAuthConsent = lazy(() => import("./pages/OAuthConsent"));
const NotFound = lazy(() => import("./pages/NotFound"));
const ShareControlRedirect = lazy(() => import("./pages/ShareControlRedirect"));

// Heavy pages — lazy loaded so the entry chunk stays small
const Index = lazy(() => import("./pages/Index"));
const HowItWorks = lazy(() => import("./pages/HowItWorks"));
const Pricing = lazy(() => import("./pages/Pricing"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Cookies = lazy(() => import("./pages/Cookies"));
const DeleteAccount = lazy(() => import("./pages/DeleteAccount"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const SharedEntityPage = lazy(() => import("./pages/SharedEntityPage"));
const MQTTBrowser = lazy(() => import("./pages/MQTTBrowser"));
const HomeAnalytics = lazy(() => import("./pages/HomeAnalytics"));

/** Legacy /history deep links land on /analytics with their query intact
 *  (?preset= is translated by the page itself). */
const HistoryRedirect = () => (
  <Navigate to={{ pathname: "/analytics", search: window.location.search }} replace />
);
const Diagnostics = lazy(() => import("./pages/Diagnostics"));

// Cloud-only pages — lazy loaded from @homecast/cloud if available
const VerifyEmail = lazy(() => hasCloud()
  ? import('@homecast/cloud').then(m => ({ default: m.VerifyEmail }))
  : Promise.resolve({ default: () => <Navigate to="/login" replace /> })
);
const ForgotPassword = lazy(() => hasCloud()
  ? import('@homecast/cloud').then(m => ({ default: m.ForgotPassword }))
  : Promise.resolve({ default: () => <Navigate to="/login" replace /> })
);
const ResetPassword = lazy(() => hasCloud()
  ? import('@homecast/cloud').then(m => ({ default: m.ResetPassword }))
  : Promise.resolve({ default: () => <Navigate to="/login" replace /> })
);
const Subscribe = lazy(() => hasCloud()
  ? import('@homecast/cloud').then(m => ({ default: m.Subscribe }))
  : Promise.resolve({ default: () => <Navigate to="/portal" replace /> })
);

const queryClient = new QueryClient();

// Redirect to portal — used for cloud-only routes in Community mode
const ToPortal = () => <Navigate to="/portal" replace />;

/** Same destination, but carrying the query along.
 *
 *  A link from an email lands on the bare root with the reason for the visit in
 *  its query string — ?enrollment=, ?home=, ?checkout= are all read by the
 *  dashboard. Dropping it would turn a working invitation into a plain
 *  dashboard with no explanation. Mirrors HistoryRedirect above. */
const ToPortalWithQuery = () => (
  <Navigate to={{ pathname: "/portal", search: window.location.search }} replace />
);

/** The doormat our emails point at.
 *
 *  Safari puts an "Open in the Homecast app" banner on whatever the app claims,
 *  and that banner is chrome inside the layout viewport — it followed people
 *  around the site and clipped the wallpaper behind it. So the AASA claims this
 *  one path and nothing else: nobody browses here, so no page anyone reads
 *  carries a banner, and an emailed link still opens the app.
 *
 *  Reached in a browser instead — no app installed, or a desktop — this just
 *  forwards to wherever ?to= pointed. See lib/open-target.ts for why that value
 *  is validated rather than trusted. */
const OpenLink = () => (
  <Navigate to={resolveOpenTarget(new URLSearchParams(window.location.search).get("to"))} replace />
);

/** A page of the website, not a screen of the app.
 *
 *  Safari offers "Open in the Homecast app" on homecast.cloud because the AASA
 *  claims the bare root — the root is what our emails link to, so it has to stay
 *  claimed. But the root also renders the marketing landing page, so the app
 *  opened on its own advertising. Inside the native shell these pages collapse
 *  to the dashboard instead.
 *
 *  These element expressions are evaluated when MainRoutes renders, not on each
 *  navigation, so the flag has to be set before React's first render — which is
 *  exactly what the shell does, injecting it .atDocumentStart. Setting it from
 *  the console after load will NOT take effect; to reproduce this in a browser,
 *  inject the flag at document start. See lib/marketing-routes.ts for which
 *  paths these are and why /delete-account is not one of them. */
const marketing = (page: ReactElement) =>
  isInNativeAppShell() ? <ToPortalWithQuery /> : page;

// Dev-only harness for the wallpaper-load → widget-recolour sequence.
// import.meta.env.DEV is statically false in a production build, so both the
// route and the lazy chunk drop out entirely.
const BgDemo = import.meta.env.DEV ? lazy(() => import("./pages/BgDemo")) : null;
const devRoutes = BgDemo ? <Route path="/bgdemo" element={<BgDemo />} /> : null;

// Routes that need auth + websocket providers
const MainRoutes = () => (
  <WebSocketProvider>
    <AuthProvider>
      <PushRegistration />
      {/* Shake to report a problem. Admin accounts only, and a no-op render
          for everyone else — see ShakeToReport. */}
      <ShakeToReport />
      {/* Wraps the signed-in app so the request log can dock beneath it. A
          no-op render unless the log is switched on in Settings → Account. */}
      <DebugDock>
      <Suspense fallback={<AppBootFallback />}>
        <Routes>
          {isCommunity ? (
            <>
              {/* Community mode: single login page handles both setup and login */}
              <Route path="/" element={<ToPortal />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Navigate to="/login" replace />} />
              <Route path="/subscribe" element={<ToPortal />} />
              <Route path="/verify-email" element={<ToPortal />} />
              <Route path="/forgot-password" element={<ToPortal />} />
              <Route path="/reset-password" element={<ToPortal />} />
              <Route path="/how-it-works" element={<ToPortal />} />
              <Route path="/pricing" element={<ToPortal />} />
              <Route path="/portal" element={<Dashboard />} />
              <Route path="/portal/admin/*" element={<Dashboard />} />
              <Route path="/mqtt" element={<MQTTBrowser />} />
              <Route path="/analytics" element={<HomeAnalytics />} />
              <Route path="/history" element={<HistoryRedirect />} />
              <Route path="/diagnostics" element={<Diagnostics />} />
              <Route path="/oauth/consent" element={<OAuthConsent />} />
              {devRoutes}
              <Route path="*" element={<ToPortal />} />
            </>
          ) : (
            <>
              <Route path="/" element={location.hostname.includes('mqtt.') ? <MQTTBrowser /> : marketing(<Index />)} />
              <Route path="/how-it-works" element={marketing(<HowItWorks />)} />
              <Route path="/pricing" element={marketing(<Pricing />)} />
              <Route path="/features" element={marketing(<Navigate to="/" replace />)} />
              <Route path="/terms" element={marketing(<Terms />)} />
              <Route path="/privacy" element={marketing(<Privacy />)} />
              <Route path="/cookies" element={marketing(<Cookies />)} />
              <Route path="/delete-account" element={<DeleteAccount />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/subscribe" element={<Subscribe />} />
              <Route path="/portal" element={<Dashboard />} />
              <Route path="/portal/admin/*" element={<Dashboard />} />
              <Route path="/mqtt" element={<MQTTBrowser />} />
              <Route path="/analytics" element={<HomeAnalytics />} />
              <Route path="/history" element={<HistoryRedirect />} />
              <Route path="/diagnostics" element={<Diagnostics />} />
              <Route path="/oauth/consent" element={<OAuthConsent />} />
              <Route path="/open" element={<OpenLink />} />
              {devRoutes}
              <Route path="*" element={<NotFound />} />
            </>
          )}
        </Routes>
      </Suspense>
      </DebugDock>
    </AuthProvider>
  </WebSocketProvider>
);

const App = () => (
  <ApolloProvider client={apolloClient}>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MacAppInsetVar />
        <Toaster />
        <RelayRouteBanner />
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ScrollToTop />
          <StagingBanner />
          <CookieConsent />
          <Suspense fallback={<AppBootFallback />}>
          <Routes>
            {/* MQTT browser on mqtt.* domains — no auth/websocket providers needed */}
            {location.hostname.includes('mqtt.') ? (
              <>
                <Route path="/" element={<MQTTBrowser />} />
                <Route path="/mqtt" element={<MQTTBrowser />} />
                <Route path="*" element={<MQTTBrowser />} />
              </>
            ) : (
              <>
                {/* Shared routes — no auth/websocket providers (prevents 4002 disconnect on portal) */}
                <Route path="/s/:hash/:action/*" element={<ShareControlRedirect />} />
                <Route path="/s/:hash/:action" element={<ShareControlRedirect />} />
                <Route path="/s/:hash" element={<SharedEntityPage />} />
                {/* All other routes — with auth/websocket */}
                <Route path="/*" element={<MainRoutes />} />
              </>
            )}
          </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ApolloProvider>
);

export default App;
