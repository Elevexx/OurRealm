import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import FoundingVipPopup from "@/components/fire/FoundingVipPopup";
import MessagingPopupProvider from "@/contexts/MessagingPopupContext";
import { PresenceProvider } from "@/contexts/PresenceContext";
import Layout from "@/components/Layout";
import Landing from "@/pages/Landing";
import SignUp from "@/pages/SignUp";
import SignIn from "@/pages/SignIn";
import Home from "@/pages/Home";
import HomeDashboard from "@/pages/HomeDashboard";
import AdminAnalytics from "@/pages/AdminAnalytics";
import AdminHub from "@/pages/AdminHub";
import AdminDataHealth from "@/pages/AdminDataHealth";
import AdminWebsiteMedia from "@/pages/AdminWebsiteMedia";
import AdminWidgets from "@/pages/AdminWidgets";
import AdminOrionLogs from "@/pages/AdminOrionLogs";
import AdminOrion from "@/pages/AdminOrion";
import AdminProviders from "@/pages/AdminProviders";
import RealmPulse from "@/pages/RealmPulse";
import Feed from "@/pages/Feed";
import Discover from "@/pages/Discover";
import Sounds from "@/pages/Sounds";
import Featured from "@/pages/Featured";
import Realms from "@/pages/Realms";
import RealmDetail from "@/pages/RealmDetail";
import ModesPage from "@/pages/ModesPage";
import FounderProfile from "@/pages/FounderProfile";
import Friends from "@/pages/Friends";
import Messages from "@/pages/Messages";
import Notifications from "@/pages/Notifications";
// NOTE: Wallet / Marketplace / Ads-Manager surfaces are hidden per
// user request (Feb 20, 2026). Imports and routes are removed below;
// pages remain on disk so backend hooks + future re-enable are
// trivial. See /app/memory/PRD.md for the wider de-scoping decision.
import WidgetLibrary from "@/pages/WidgetLibrary";
import Profile from "@/pages/Profile";
import Settings from "@/pages/Settings";
import AccountSettings from "@/pages/AccountSettings";
import Support from "@/pages/Support";
import AdminSupport from "@/pages/AdminSupport";
import AdminFAQ from "@/pages/AdminFAQ";
import AdminLevelBuilder from "@/pages/AdminLevelBuilder";
import AdminFirePower from "@/pages/AdminFirePower";
import AdminLeaderboardSettings from "@/pages/AdminLeaderboardSettings";
import Leaderboards from "@/pages/Leaderboards";
import FAQPage from "@/pages/FAQPage";
import AdminHashtags from "@/pages/AdminHashtags";
import HashtagFeed from "@/pages/HashtagFeed";
import TrendingHashtagsPage from "@/pages/TrendingHashtagsPage";
import { TermsOfServicePage, TermsConditionsPage, PrivacyPolicyPage, CommunityStandardsPage, DMCAPolicyPage, SafetyPolicyPage, CookieNoticePage, AccountDeletionPage } from "@/pages/LegalPages";
import YouTubeRouteCleanup from "@/components/YouTubeRouteCleanup";
import PostPopup from "@/components/PostPopup";
import MiniPlayer from "@/components/MiniPlayer";
import InstallPrompt from "@/components/InstallPrompt";
import RestoreAccountPrompt from "@/components/RestoreAccountPrompt";

// Phase: Portals 1.0 — Rainforest Realm AR foundation.
// Phase: Portals 1.1 — Real WebXR immersive-ar session.
// Phase: Portals 1.2 — Founder-only Portal Development Hub.
import PortalsHub        from "@/pages/PortalsHub";
import PortalAR          from "@/pages/PortalAR";
import PortalVR          from "@/pages/PortalVR";
import PortalXRSession   from "@/pages/PortalXRSession";
import AdminPortalsHub   from "@/pages/AdminPortalsHub";
import AdminPortalDetail from "@/pages/AdminPortalDetail";
import { isAdmin }       from "@/lib/isAdmin";

// Portals 1.2 — the entire /realms/portals/* AR surface (preview + XR
// session) is Founder/Admin-only until Realms graduate to "Released".
// Public users are redirected to the Opening Soon hub at /portals.
function PortalsAdminGate({ children }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (!user || !isAdmin(user)) return <Navigate to="/portals" replace />;
  return children;
}

function ShellRoute({ children }) {
  const { isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
        <div className="animate-pulse-glow text-sm uppercase tracking-[0.3em]">Loading OurRealm…</div>
      </div>
    );
  }
  return <Layout><FoundingVipPopup />{children}</Layout>;
}

// Pending-deletion users get the restore prompt instead of any
// authenticated route. Public / unauthenticated routes (Landing,
// SignIn, SignUp) still render normally so the user can also choose
// to sign out and walk away.
function RestoreGate({ children }) {
  const { pendingDeletion } = useAuth();
  if (pendingDeletion) return <RestoreAccountPrompt />;
  return children;
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <MessagingPopupProvider>
        <PresenceProvider>
          <BrowserRouter>
          <YouTubeRouteCleanup />
          <RestoreGate>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/signup" element={<SignUp />} />
            <Route path="/signin" element={<SignIn />} />
            <Route path="/home" element={<ShellRoute><HomeDashboard /></ShellRoute>} />
            <Route path="/home/legacy" element={<ShellRoute><Home /></ShellRoute>} />
            <Route path="/interests" element={<ShellRoute><Home /></ShellRoute>} />
            <Route path="/admin" element={<ShellRoute><AdminHub /></ShellRoute>} />
            <Route path="/admin/data-health" element={<ShellRoute><AdminDataHealth /></ShellRoute>} />
            <Route path="/admin/WebsiteMedia" element={<ShellRoute><AdminWebsiteMedia /></ShellRoute>} />
            <Route path="/admin/widgets" element={<ShellRoute><AdminWidgets /></ShellRoute>} />
            <Route path="/admin/orion-logs" element={<ShellRoute><AdminOrionLogs /></ShellRoute>} />
            <Route path="/admin/orion" element={<ShellRoute><AdminOrion /></ShellRoute>} />
            <Route path="/admin/providers" element={<ShellRoute><AdminProviders /></ShellRoute>} />
            <Route path="/admin/analytics" element={<ShellRoute><AdminAnalytics /></ShellRoute>} />
            <Route path="/admin/realm-pulse" element={<ShellRoute><RealmPulse /></ShellRoute>} />
            <Route path="/featured" element={<ShellRoute><Featured /></ShellRoute>} />
            <Route path="/realms" element={<ShellRoute><Realms /></ShellRoute>} />
            <Route path="/realms/:id" element={<ShellRoute><RealmDetail /></ShellRoute>} />
            <Route path="/modes" element={<ShellRoute><ModesPage /></ShellRoute>} />
            <Route path="/profile/:username" element={<ShellRoute><FounderProfile /></ShellRoute>} />
            <Route path="/public/:username" element={<ShellRoute><FounderProfile /></ShellRoute>} />
            <Route path="/feed" element={<ShellRoute><Feed /></ShellRoute>} />
            <Route path="/hashtag/:tag" element={<ShellRoute><HashtagFeed /></ShellRoute>} />
            {/* Dedicated trending hashtags experience + spec'd /hashtags/:tag alias. */}
            <Route path="/hashtags" element={<ShellRoute><TrendingHashtagsPage /></ShellRoute>} />
            <Route path="/hashtags/:tag" element={<ShellRoute><HashtagFeed /></ShellRoute>} />
            <Route path="/admin/hashtags" element={<ShellRoute><AdminHashtags /></ShellRoute>} />
            <Route path="/discover" element={<ShellRoute><Discover /></ShellRoute>} />
            <Route path="/sounds" element={<ShellRoute><Sounds /></ShellRoute>} />
            <Route path="/music" element={<Navigate to="/sounds" replace />} />
            <Route path="/friends" element={<ShellRoute><Friends /></ShellRoute>} />
            <Route path="/messages" element={<ShellRoute><Messages /></ShellRoute>} />
            <Route path="/notifications" element={<ShellRoute><Notifications /></ShellRoute>} />
            {/* /wallet and /marketplace routes intentionally removed
                (hide-only de-scope, Feb 20, 2026). Pages preserved on
                disk for future re-enable. */}
            <Route path="/widgets" element={<ShellRoute><WidgetLibrary /></ShellRoute>} />
            <Route path="/profile" element={<ShellRoute><Profile /></ShellRoute>} />
            <Route path="/settings" element={<ShellRoute><Settings /></ShellRoute>} />
            <Route path="/settings/account" element={<ShellRoute><AccountSettings /></ShellRoute>} />
            <Route path="/profile/support" element={<ShellRoute><Support /></ShellRoute>} />
            <Route path="/admin/support" element={<ShellRoute><AdminSupport /></ShellRoute>} />
            <Route path="/admin/faq" element={<ShellRoute><AdminFAQ /></ShellRoute>} />
            <Route path="/admin/level-builder" element={<ShellRoute><AdminLevelBuilder /></ShellRoute>} />
            <Route path="/admin/fire-power" element={<ShellRoute><AdminFirePower /></ShellRoute>} />
            <Route path="/admin/leaderboards" element={<ShellRoute><AdminLeaderboardSettings /></ShellRoute>} />
            <Route path="/leaderboards" element={<ShellRoute><Leaderboards /></ShellRoute>} />
            <Route path="/faq" element={<ShellRoute><FAQPage /></ShellRoute>} />
            <Route path="/terms" element={<TermsOfServicePage />} />
            <Route path="/terms-conditions" element={<TermsConditionsPage />} />
            <Route path="/privacy" element={<PrivacyPolicyPage />} />
            <Route path="/community" element={<CommunityStandardsPage />} />
            <Route path="/dmca" element={<DMCAPolicyPage />} />
            <Route path="/copyright" element={<DMCAPolicyPage />} />
            <Route path="/safety" element={<SafetyPolicyPage />} />
            <Route path="/cookies" element={<CookieNoticePage />} />
            <Route path="/account-deletion" element={<AccountDeletionPage />} />

            {/* Portals 1.0 — Rainforest Realm AR foundation.
                AR/VR pages render fullscreen (no Layout) so the camera
                feed and HUD can use the entire viewport including the
                iOS safe-area inset. */}
            <Route path="/portals" element={<ShellRoute><PortalsHub /></ShellRoute>} />
            <Route path="/realms/portals/ar" element={<PortalsAdminGate><PortalAR /></PortalsAdminGate>} />
            <Route path="/realms/portals/ar/xr" element={<PortalsAdminGate><PortalXRSession /></PortalsAdminGate>} />
            <Route path="/realms/portals/vr" element={<PortalsAdminGate><PortalVR /></PortalsAdminGate>} />
            <Route path="/admin/portals" element={<ShellRoute><AdminPortalsHub /></ShellRoute>} />
            <Route path="/admin/portals/:realmId" element={<ShellRoute><AdminPortalDetail /></ShellRoute>} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </RestoreGate>
          <PostPopup />
          <MiniPlayer />
          <InstallPrompt trigger="auto" />
        </BrowserRouter>
        </PresenceProvider>
        </MessagingPopupProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
