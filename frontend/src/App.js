import React from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AccessControlProvider } from "@/contexts/AccessControlContext";
import AccessGate from "@/components/access/AccessGate";
import FoundingVipPopup from "@/components/fire/FoundingVipPopup";
import MessagingPopupProvider from "@/contexts/MessagingPopupContext";
import { PresenceProvider } from "@/contexts/PresenceContext";
import { Toaster } from "sonner";
import Layout from "@/components/Layout";

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
import ConfirmDeletion from "@/pages/ConfirmDeletion";
import AdminResponsibilityCenter from "@/pages/AdminResponsibilityCenter";
import AdminRcTemplates from "@/pages/AdminRcTemplates";
import AdminResponsibilityCenterDetail from "@/pages/AdminResponsibilityCenterDetail";
import AdminRcMedia from "@/pages/AdminRcMedia";
const AdminAiVideo = React.lazy(() => import("@/pages/AdminAiVideo"));
const AdminPreview = React.lazy(() => import("@/pages/AdminPreview"));
const AdminAiPolicies = React.lazy(() => import("@/pages/AdminAiPolicies"));
const EduPlans = React.lazy(() => import("@/pages/EduPlans"));
const AdminGames = React.lazy(() => import("@/pages/AdminGames"));
const GamesHub = React.lazy(() => import("@/pages/GamesHub"));
const PublicGamePreview = React.lazy(() => import("@/pages/PublicGamePreview"));
const GamePublicPage = React.lazy(() => import("@/pages/GamePublicPage"));
const AdminCenterRegistry = React.lazy(() => import("@/pages/AdminCenterRegistry"));
import ResponsibilityCenterHub from "@/pages/ResponsibilityCenterHub";
import ResponsibilityCenterCreate from "@/pages/ResponsibilityCenterCreate";
import ResponsibilityCenterDashboard from "@/pages/ResponsibilityCenterDashboard";
import EducationCenterDashboard from "@/pages/EducationCenterDashboard";
const CourseStudio = React.lazy(() => import("@/pages/CourseStudio"));
const CourseMaker = React.lazy(() => import("@/pages/CourseMaker"));
const CourseEditor = React.lazy(() => import("@/pages/CourseEditor"));
const CoursePlayer = React.lazy(() => import("@/pages/CoursePlayer"));
const RcIntelligence = React.lazy(() => import("@/pages/RcIntelligence"));
const AdminOraiControl = React.lazy(() => import("@/pages/AdminOraiControl"));
const OraiProjects = React.lazy(() => import("@/pages/OraiProjects"));
const RcRoutines = React.lazy(() => import("@/pages/RcRoutines"));
const AdminAccessControl = React.lazy(() => import("@/pages/AdminAccessControl"));
const AdminTrustSafety = React.lazy(() => import("@/pages/AdminTrustSafety"));
const ParentDashboard = React.lazy(() => import("@/pages/ParentDashboard"));
const ParentTeenManage = React.lazy(() => import("@/pages/ParentTeenManage"));
const MyLimits = React.lazy(() => import("@/pages/MyLimits"));
import TeenGuard from "@/components/guardian/TeenGuard";
import SiteModeGate from "@/components/SiteModeGate";
import OraiAssistantPanel from "@/components/orai/OraiAssistantPanel";
const Lazy = ({ children }) => <React.Suspense fallback={null}>{children}</React.Suspense>;
import Support from "@/pages/Support";
import AdminSupport from "@/pages/AdminSupport";
import AdminPrivacyRequests from "@/pages/AdminPrivacyRequests";
import AdminFAQ from "@/pages/AdminFAQ";
import AdminLevelBuilder from "@/pages/AdminLevelBuilder";
import AdminFirePower from "@/pages/AdminFirePower";
import AdminLeaderboardSettings from "@/pages/AdminLeaderboardSettings";
import Leaderboards from "@/pages/Leaderboards";
import FAQPage from "@/pages/FAQPage";
import AdminHashtags from "@/pages/AdminHashtags";
import AdminPremiumUsernames from "@/pages/AdminPremiumUsernames";
import AdminModerationCenter from "@/pages/AdminModerationCenter";
import AuthCallback from "@/pages/AuthCallback";
import UsernameOnboardingModal from "@/components/UsernameOnboardingModal";
import HashtagFeed from "@/pages/HashtagFeed";
import TrendingHashtagsPage from "@/pages/TrendingHashtagsPage";
import LegalDocPage, { LegalIndexPage } from "@/pages/LegalCenter";
import LegalNoticeGate from "@/components/LegalNoticeGate";
import Waitlist from "@/pages/Waitlist";
import AdminWaitlist from "@/pages/AdminWaitlist";
import AdminLegal from "@/pages/AdminLegal";
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
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
        <div className="animate-pulse-glow text-sm uppercase tracking-[0.3em]">Loading OurRealm…</div>
      </div>
    );
  }
  if (!user) {
    const dest = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/waitlist?next=${dest}`} replace />;
  }
  return <Layout><FoundingVipPopup /><LegalNoticeGate />{children}</Layout>;
}

// Root — no public landing page. Logged-in users continue to their feed
// (honoring any ?next deep link); anonymous visitors go to /signup.
function RootRedirect() {
  const { user, isLoading } = useAuth();
  const [searchParams] = useSearchParams();
  if (isLoading) return null;
  const raw = searchParams.get("next") || searchParams.get("to") || "";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "";
  if (user) return <Navigate to={next || "/feed"} replace />;
  return <Navigate to={next ? `/waitlist?next=${encodeURIComponent(next)}` : "/waitlist"} replace />;
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

// One-time username onboarding for accounts created via Google sign-in.
// Renders above the app; never for email-linked existing accounts.
function UsernameOnboardingGate({ children }) {
  const { user } = useAuth();
  const showOnboarding = !!user?.needs_username_onboarding
    && user?.account_status !== "deleted_pending_restore";
  return (
    <>
      {children}
      {showOnboarding && <UsernameOnboardingModal />}
    </>
  );
}

// Emergent Google Auth — synchronous fragment check DURING render (not in
// a useEffect) so a fresh `#session_id=` is processed before any route or
// auth guard runs. Must read useLocation().hash (reactive), never
// window.location.hash.
// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT
// URLS, THIS BREAKS THE AUTH
function GoogleAuthGate({ children }) {
  const location = useLocation();
  if (location.hash?.includes("session_id=")) return <AuthCallback />;
  return children;
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AccessControlProvider>
        <MessagingPopupProvider>
        <PresenceProvider>
          <BrowserRouter>
          <YouTubeRouteCleanup />
          <GoogleAuthGate>
          <RestoreGate>
          <UsernameOnboardingGate>
          <TeenGuard />
          <SiteModeGate />
          <OraiAssistantPanel />
          <Routes>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/signup" element={<SignUp />} />
            <Route path="/signin" element={<SignIn />} />
            <Route path="/login" element={<SignIn />} />
            <Route path="/preview/game/:token" element={<Lazy><PublicGamePreview /></Lazy>} />
            <Route path="/games/:parent/:slug" element={<Lazy><GamePublicPage /></Lazy>} />
            <Route path="/games/:parent" element={<Lazy><GamePublicPage /></Lazy>} />
            <Route path="/home" element={<ShellRoute><HomeDashboard /></ShellRoute>} />
            <Route path="/home/legacy" element={<ShellRoute><Home /></ShellRoute>} />
            <Route path="/interests" element={<ShellRoute><Home /></ShellRoute>} />
            <Route path="/admin" element={<ShellRoute><AdminHub /></ShellRoute>} />
            <Route path="/admin/data-health" element={<ShellRoute><AdminDataHealth /></ShellRoute>} />
            <Route path="/admin/trust-safety" element={<ShellRoute><Lazy><AdminTrustSafety /></Lazy></ShellRoute>} />
            <Route path="/admin/WebsiteMedia" element={<ShellRoute><AdminWebsiteMedia /></ShellRoute>} />
            <Route path="/admin/widgets" element={<ShellRoute><AdminWidgets /></ShellRoute>} />
            <Route path="/admin/orion-logs" element={<ShellRoute><AdminOrionLogs /></ShellRoute>} />
            <Route path="/admin/orai" element={<ShellRoute><Lazy><OraiProjects /></Lazy></ShellRoute>} />
            <Route path="/admin/orai-projects" element={<Navigate to="/admin/orai" replace />} />
            <Route path="/admin/orai/dashboard" element={<ShellRoute><AdminOrion /></ShellRoute>} />
            <Route path="/admin/orion" element={<Navigate to="/admin/orai" replace />} />
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
            <Route path="/admin/premium-usernames" element={<ShellRoute><AdminPremiumUsernames /></ShellRoute>} />
            <Route path="/admin/moderation" element={<ShellRoute><AdminModerationCenter /></ShellRoute>} />
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
            <Route path="/confirm-deletion" element={<ShellRoute><ConfirmDeletion /></ShellRoute>} />
            <Route path="/responsibility-center" element={<ShellRoute><AccessGate feature="responsibility_center"><ResponsibilityCenterHub /></AccessGate></ShellRoute>} />
            <Route path="/admin/responsibility-center" element={<ShellRoute><AdminResponsibilityCenter /></ShellRoute>} />
            <Route path="/admin/media/responsibility-center" element={<ShellRoute><AdminRcMedia /></ShellRoute>} />
            <Route path="/admin/center-registry" element={<ShellRoute><Lazy><AdminCenterRegistry /></Lazy></ShellRoute>} />
            <Route path="/admin/ai-video" element={<ShellRoute><Lazy><AdminAiVideo /></Lazy></ShellRoute>} />
            <Route path="/admin/previews/:buildId" element={<ShellRoute><Lazy><AdminPreview /></Lazy></ShellRoute>} />
            <Route path="/admin/ai-policies" element={<ShellRoute><Lazy><AdminAiPolicies /></Lazy></ShellRoute>} />
            <Route path="/admin/games" element={<ShellRoute><Lazy><AdminGames /></Lazy></ShellRoute>} />
            <Route path="/games" element={<ShellRoute><Lazy><GamesHub /></Lazy></ShellRoute>} />
            <Route path="/admin/responsibility-center/templates" element={<ShellRoute><AdminRcTemplates mode="list" /></ShellRoute>} />
            <Route path="/admin/responsibility-center/templates/create" element={<ShellRoute><AdminRcTemplates mode="create" /></ShellRoute>} />
            <Route path="/admin/responsibility-center/templates/:templateId" element={<ShellRoute><AdminRcTemplates mode="detail" /></ShellRoute>} />
            <Route path="/admin/responsibility-center/templates/:templateId/edit" element={<ShellRoute><AdminRcTemplates mode="edit" /></ShellRoute>} />
            <Route path="/admin/responsibility-center/templates/:templateId/preview" element={<ShellRoute><AdminRcTemplates mode="preview" /></ShellRoute>} />
            <Route path="/admin/responsibility-center/:centerId" element={<ShellRoute><AdminResponsibilityCenterDetail /></ShellRoute>} />
            <Route path="/responsibility-center/create" element={<ShellRoute><AccessGate feature="center_creation"><ResponsibilityCenterCreate /></AccessGate></ShellRoute>} />
            <Route path="/responsibility-center/:id" element={<ShellRoute><AccessGate feature="responsibility_center"><ResponsibilityCenterDashboard /></AccessGate></ShellRoute>} />
            <Route path="/responsibility-center/:id/education" element={<ShellRoute><AccessGate feature="responsibility_center"><EducationCenterDashboard /></AccessGate></ShellRoute>} />
            <Route path="/responsibility-center/:id/edu-plans" element={<ShellRoute><AccessGate feature="responsibility_center"><Lazy><EduPlans /></Lazy></AccessGate></ShellRoute>} />
            <Route path="/responsibility-center/:id/courses" element={<ShellRoute><AccessGate feature="course_player"><Lazy><CourseStudio /></Lazy></AccessGate></ShellRoute>} />
            <Route path="/responsibility-center/:id/course-maker" element={<ShellRoute><AccessGate feature="course_player"><Lazy><CourseMaker /></Lazy></AccessGate></ShellRoute>} />
            <Route path="/responsibility-center/:id/courses/:courseId/edit" element={<ShellRoute><AccessGate feature="course_player"><Lazy><CourseEditor /></Lazy></AccessGate></ShellRoute>} />
            <Route path="/responsibility-center/:id/courses/:courseId/learn" element={<ShellRoute><AccessGate feature="course_player"><Lazy><CoursePlayer /></Lazy></AccessGate></ShellRoute>} />
            <Route path="/responsibility-center/:id/intelligence" element={<ShellRoute><AccessGate feature="orai"><Lazy><RcIntelligence /></Lazy></AccessGate></ShellRoute>} />
            <Route path="/responsibility-center/:id/routines" element={<ShellRoute><AccessGate feature="responsibility_center"><Lazy><RcRoutines /></Lazy></AccessGate></ShellRoute>} />
            <Route path="/admin/orai-control" element={<ShellRoute><Lazy><AdminOraiControl /></Lazy></ShellRoute>} />
            <Route path="/admin/access-control" element={<ShellRoute><Lazy><AdminAccessControl /></Lazy></ShellRoute>} />
            <Route path="/parent" element={<ShellRoute><Lazy><ParentDashboard /></Lazy></ShellRoute>} />
            <Route path="/parent/teens/:teenId" element={<ShellRoute><Lazy><ParentTeenManage /></Lazy></ShellRoute>} />
            <Route path="/my-limits" element={<ShellRoute><Lazy><MyLimits /></Lazy></ShellRoute>} />
            <Route path="/profile/support" element={<ShellRoute><Support /></ShellRoute>} />
            <Route path="/admin/support" element={<ShellRoute><AdminSupport /></ShellRoute>} />
            <Route path="/admin/privacy-requests" element={<ShellRoute><AdminPrivacyRequests /></ShellRoute>} />
            <Route path="/admin/legal" element={<ShellRoute><AdminLegal /></ShellRoute>} />
            <Route path="/admin/waitlist" element={<ShellRoute><AdminWaitlist /></ShellRoute>} />
            <Route path="/admin/faq" element={<ShellRoute><AdminFAQ /></ShellRoute>} />
            <Route path="/admin/level-builder" element={<ShellRoute><AdminLevelBuilder /></ShellRoute>} />
            <Route path="/admin/fire-power" element={<ShellRoute><AdminFirePower /></ShellRoute>} />
            <Route path="/admin/leaderboards" element={<ShellRoute><AdminLeaderboardSettings /></ShellRoute>} />
            <Route path="/leaderboards" element={<ShellRoute><Leaderboards /></ShellRoute>} />
            <Route path="/faq" element={<ShellRoute><FAQPage /></ShellRoute>} />
            {/* Legal Center — published documents served from the DB
                (the old static routes now alias into it). */}
            <Route path="/legal" element={<LegalIndexPage />} />
            <Route path="/waitlist" element={<Waitlist />} />
            <Route path="/legal/:slug" element={<LegalDocPage />} />
            <Route path="/terms" element={<LegalDocPage slugOverride="terms" />} />
            <Route path="/terms-conditions" element={<LegalDocPage slugOverride="terms-conditions" />} />
            <Route path="/privacy" element={<LegalDocPage slugOverride="privacy" />} />
            <Route path="/community" element={<LegalDocPage slugOverride="community" />} />
            <Route path="/dmca" element={<LegalDocPage slugOverride="dmca" />} />
            <Route path="/copyright" element={<LegalDocPage slugOverride="dmca" />} />
            <Route path="/safety" element={<LegalDocPage slugOverride="safety" />} />
            <Route path="/cookies" element={<LegalDocPage slugOverride="cookies" />} />
            <Route path="/account-deletion" element={<LegalDocPage slugOverride="account-deletion" />} />

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
          </UsernameOnboardingGate>
          </RestoreGate>
          </GoogleAuthGate>
          <PostPopup />
          <Toaster position="top-center" richColors closeButton={false}
            toastOptions={{
              style: {
                background: "var(--surface-1, #101826)",
                color: "var(--text-main, #e8f0ff)",
                border: "1px solid var(--border-col, rgba(255,255,255,0.12))",
              },
            }} />
          <MiniPlayer />
          {/* <InstallPrompt trigger="auto" /> */}
        </BrowserRouter>
        </PresenceProvider>
        </MessagingPopupProvider>
        </AccessControlProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;

