import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { PresenceProvider } from "@/contexts/PresenceContext";
import Layout from "@/components/Layout";
import Landing from "@/pages/Landing";
import SignUp from "@/pages/SignUp";
import SignIn from "@/pages/SignIn";
import Home from "@/pages/Home";
import HomeDashboard from "@/pages/HomeDashboard";
import AdminAnalytics from "@/pages/AdminAnalytics";
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
import Wallet from "@/pages/Wallet";
import Marketplace from "@/pages/Marketplace";
import WidgetLibrary from "@/pages/WidgetLibrary";
import Profile from "@/pages/Profile";
import Settings from "@/pages/Settings";
import AccountSettings from "@/pages/AccountSettings";
import Support from "@/pages/Support";
import AdminSupport from "@/pages/AdminSupport";
import AdminFAQ from "@/pages/AdminFAQ";
import AdminHashtags from "@/pages/AdminHashtags";
import HashtagFeed from "@/pages/HashtagFeed";
import { TermsOfServicePage, TermsConditionsPage, PrivacyPolicyPage, CommunityStandardsPage, DMCAPolicyPage, SafetyPolicyPage, CookieNoticePage, AccountDeletionPage } from "@/pages/LegalPages";
import YouTubeRouteCleanup from "@/components/YouTubeRouteCleanup";
import PostPopup from "@/components/PostPopup";
import MiniPlayer from "@/components/MiniPlayer";
import InstallPrompt from "@/components/InstallPrompt";

function ShellRoute({ children }) {
  const { isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
        <div className="animate-pulse-glow text-sm uppercase tracking-[0.3em]">Loading OurRealm…</div>
      </div>
    );
  }
  return <Layout>{children}</Layout>;
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <PresenceProvider>
          <BrowserRouter>
          <YouTubeRouteCleanup />
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/signup" element={<SignUp />} />
            <Route path="/signin" element={<SignIn />} />
            <Route path="/home" element={<ShellRoute><HomeDashboard /></ShellRoute>} />
            <Route path="/home/legacy" element={<ShellRoute><Home /></ShellRoute>} />
            <Route path="/interests" element={<ShellRoute><Home /></ShellRoute>} />
            <Route path="/admin" element={<ShellRoute><AdminAnalytics /></ShellRoute>} />
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
            <Route path="/admin/hashtags" element={<ShellRoute><AdminHashtags /></ShellRoute>} />
            <Route path="/discover" element={<ShellRoute><Discover /></ShellRoute>} />
            <Route path="/sounds" element={<ShellRoute><Sounds /></ShellRoute>} />
            <Route path="/music" element={<Navigate to="/sounds" replace />} />
            <Route path="/friends" element={<ShellRoute><Friends /></ShellRoute>} />
            <Route path="/messages" element={<ShellRoute><Messages /></ShellRoute>} />
            <Route path="/notifications" element={<ShellRoute><Notifications /></ShellRoute>} />
            <Route path="/wallet" element={<ShellRoute><Wallet /></ShellRoute>} />
            <Route path="/marketplace" element={<ShellRoute><Marketplace /></ShellRoute>} />
            <Route path="/widgets" element={<ShellRoute><WidgetLibrary /></ShellRoute>} />
            <Route path="/profile" element={<ShellRoute><Profile /></ShellRoute>} />
            <Route path="/settings" element={<ShellRoute><Settings /></ShellRoute>} />
            <Route path="/settings/account" element={<ShellRoute><AccountSettings /></ShellRoute>} />
            <Route path="/profile/support" element={<ShellRoute><Support /></ShellRoute>} />
            <Route path="/admin/support" element={<ShellRoute><AdminSupport /></ShellRoute>} />
            <Route path="/admin/faq" element={<ShellRoute><AdminFAQ /></ShellRoute>} />
            <Route path="/terms" element={<TermsOfServicePage />} />
            <Route path="/terms-conditions" element={<TermsConditionsPage />} />
            <Route path="/privacy" element={<PrivacyPolicyPage />} />
            <Route path="/community" element={<CommunityStandardsPage />} />
            <Route path="/dmca" element={<DMCAPolicyPage />} />
            <Route path="/copyright" element={<DMCAPolicyPage />} />
            <Route path="/safety" element={<SafetyPolicyPage />} />
            <Route path="/cookies" element={<CookieNoticePage />} />
            <Route path="/account-deletion" element={<AccountDeletionPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <PostPopup />
          <MiniPlayer />
          <InstallPrompt trigger="auto" />
        </BrowserRouter>
        </PresenceProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
