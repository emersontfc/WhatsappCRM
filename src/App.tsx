import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { Toaster } from "sonner";
import { supabase } from "./supabase";
import { User } from "@supabase/supabase-js";

import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Activate from "./pages/Activate";
import Contacts from "./pages/Contacts";
import Messages from "./pages/Messages";
import Settings from "./pages/Settings";
import Automations from "./pages/Automations";
import Schedule from "./pages/Schedule";
import Agent from "./pages/Agent";
import AdminPacks from "./pages/AdminPacks";
import UserModels from "./pages/UserModels";
import QuickReplies from "./pages/QuickReplies";
import Groups from "./pages/Groups";
import MenuBuilderPage from "./pages/MenuBuilderPage";
import Leads from "./pages/Leads";
import ActivityLog from "./pages/ActivityLog";
import Layout from "./components/Layout";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    // Listener de autenticação
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isMounted) {
        setUser(session?.user ?? null);
        setLoading(false);
      }
    });

    // Sessão inicial
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (isMounted) {
        setUser(session?.user ?? null);
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Loader global
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <Router>
      <Toaster position="top-right" richColors />

      <Routes>
        {/* Públicas */}
        <Route path="/" element={user ? <Navigate to="/dashboard" replace /> : <Landing />} />
        <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />

        {/* 🔥 Onboarding REMOVIDO - redirect permanente */}
        <Route path="/onboarding" element={<Navigate to="/dashboard" replace />} />

        {/* Privadas */}
        <Route
          path="/dashboard"
          element={user ? <Layout><Dashboard key={user?.id} /></Layout> : <Navigate to="/login" replace />}
        />
        <Route
          path="/activate"
          element={user ? <Layout><Activate key={user?.id} /></Layout> : <Navigate to="/login" replace />}
        />
        <Route
          path="/contacts"
          element={user ? <Layout><Contacts key={user?.id} /></Layout> : <Navigate to="/login" replace />}
        />
        <Route
          path="/messages"
          element={user ? <Layout><Messages key={user?.id} /></Layout> : <Navigate to="/login" replace />}
        />
        <Route
          path="/leads"
          element={user ? <Layout><Leads key={user?.id} /></Layout> : <Navigate to="/login" replace />}
        />
        <Route
          path="/agent"
          element={user ? <Layout><Agent key={user?.id} /></Layout> : <Navigate to="/login" replace />}
        />
        <Route
          path="/activity"
          element={user ? <Layout><ActivityLog key={user?.id} /></Layout> : <Navigate to="/login" replace />}
        />
        <Route
          path="/settings"
          element={user ? <Layout><Settings key={user?.id} /></Layout> : <Navigate to="/login" replace />}
        />
        <Route
          path="/automations"
          element={user ? <Layout><Automations key={user?.id} /></Layout> : <Navigate to="/login" replace />}
        />
        <Route
          path="/models"
          element={user ? <Layout><UserModels key={user?.id} /></Layout> : <Navigate to="/login" replace />}
        />
        <Route
          path="/quick-replies"
          element={user ? <Layout><QuickReplies key={user?.id} /></Layout> : <Navigate to="/login" replace />}
        />
        <Route
          path="/groups"
          element={user ? <Layout><Groups key={user?.id} /></Layout> : <Navigate to="/login" replace />}
        />
        <Route
          path="/menu-builder"
          element={user ? <Layout><MenuBuilderPage key={user?.id} /></Layout> : <Navigate to="/login" replace />}
        />
        <Route
          path="/admin/packs"
          element={user ? <Layout><AdminPacks key={user?.id} /></Layout> : <Navigate to="/login" replace />}
        />
        <Route
          path="/schedule"
          element={user ? <Layout><Schedule key={user?.id} /></Layout> : <Navigate to="/login" replace />}
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}
