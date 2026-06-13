import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import Layout from "@/components/Layout";
import Landing from "@/pages/Landing";
import SignUp from "@/pages/SignUp";
import SignIn from "@/pages/SignIn";
import Home from "@/pages/Home";
import Feed from "@/pages/Feed";
import Discover from "@/pages/Discover";
import Sounds from "@/pages/Sounds";
import Featured from "@/pages/Featured";
import Friends from "@/pages/Friends";
import Messages from "@/pages/Messages";
import Notifications from "@/pages/Notifications";
import Wallet from "@/pages/Wallet";
import Marketplace from "@/pages/Marketplace";
import WidgetLibrary from "@/pages/WidgetLibrary";
import Profile from "@/pages/Profile";
import Settings from "@/pages/Settings";

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
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/signup" element={<SignUp />} />
            <Route path="/signin" element={<SignIn />} />
            <Route path="/home" element={<ShellRoute><Home /></ShellRoute>} />
            <Route path="/featured" element={<ShellRoute><Featured /></ShellRoute>} />
            <Route path="/feed" element={<ShellRoute><Feed /></ShellRoute>} />
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
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
