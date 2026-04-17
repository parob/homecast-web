import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApolloProvider } from "@apollo/client/react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ScrollToTop } from "@/components/ScrollToTop";
import { StagingBanner } from "@/components/layout/StagingBanner";
import { CookieConsent } from "@/components/layout/CookieConsent";
import { apolloClient } from "@/lib/apollo";
import { AuthProvider } from "@/contexts/AuthContext";
import { WebSocketProvider } from "@/contexts/WebSocketContext";
import { isCommunity } from "@/lib/config";
import { hasCloud } from "@/lib/cloud";
import { lazy, Suspense } from "react";
import Index from "./pages/Index";
import HowItWorks from "./pages/HowItWorks";
import Pricing from "./pages/Pricing";
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";
import Cookies from "./pages/Cookies";
import DeleteAccount from "./pages/DeleteAccount";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";
import SharedEntityPage from "./pages/SharedEntityPage";
import OAuthConsent from "./pages/OAuthConsent";
import NotFound from "./pages/NotFound";
import ShareControlRedirect from "./pages/ShareControlRedirect";
import MQTTBrowser from "./pages/MQTTBrowser";
import Diagnostics from "./pages/Diagnostics";

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

// Routes that need auth + websocket providers
const MainRoutes = () => (
  <WebSocketProvider>
    <AuthProvider>
      <Suspense fallback={null}>
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
              <Route path="/diagnostics" element={<Diagnostics />} />
              <Route path="/oauth/consent" element={<OAuthConsent />} />
              <Route path="*" element={<ToPortal />} />
            </>
          ) : (
            <>
              <Route path="/" element={location.hostname.includes('mqtt.') ? <MQTTBrowser /> : <Index />} />
              <Route path="/how-it-works" element={<HowItWorks />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/features" element={<Navigate to="/" replace />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/cookies" element={<Cookies />} />
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
              <Route path="/diagnostics" element={<Diagnostics />} />
              <Route path="/oauth/consent" element={<OAuthConsent />} />
              <Route path="*" element={<NotFound />} />
            </>
          )}
        </Routes>
      </Suspense>
    </AuthProvider>
  </WebSocketProvider>
);

const App = () => (
  <ApolloProvider client={apolloClient}>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ScrollToTop />
          <StagingBanner />
          <CookieConsent />
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
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ApolloProvider>
);

export default App;
