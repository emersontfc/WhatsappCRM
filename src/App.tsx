import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense, useState, useEffect } from "react";
import { Toaster } from "sonner";
import { supabase, supabaseConfigured } from "./supabase";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";

import Login from "./pages/Login";
import Layout from "./components/Layout";

const Landing = lazy(() => import("./pages/Landing"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Activate = lazy(() => import("./pages/Activate"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Contacts = lazy(() => import("./pages/Contacts"));
const Messages = lazy(() => import("./pages/Messages"));
const Settings = lazy(() => import("./pages/Settings"));
const Automations = lazy(() => import("./pages/Automations"));
const Schedule = lazy(() => import("./pages/Schedule"));
const Agent = lazy(() => import("./pages/Agent"));
const AdminPacks = lazy(() => import("./pages/AdminPacks"));
const UserModels = lazy(() => import("./pages/UserModels"));
const QuickReplies = lazy(() => import("./pages/QuickReplies"));
const Groups = lazy(() => import("./pages/Groups"));
const MenuBuilderPage = lazy(() => import("./pages/MenuBuilderPage"));
const Leads = lazy(() => import("./pages/Leads"));
const ActivityLog = lazy(() => import("./pages/ActivityLog"));
const Appointments = lazy(() => import("./pages/Appointments"));
const Orders = lazy(() => import("./pages/Orders"));
const Seller = lazy(() => import("./pages/Seller"));
const SellerTeam = lazy(() => import("./pages/SellerTeam"));
const DigitalOrders = lazy(() => import("./pages/DigitalOrders"));
const PublicBooking = lazy(() => import("./pages/PublicBooking"));
const Docs = lazy(() => import("./pages/Docs"));

function PageLoading({ label }: { label: string }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-slate-50 text-slate-600" role="status">
      <div aria-hidden="true" className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
      <span>{label}</span>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(supabaseConfigured);

  useEffect(() => {
    if (!supabaseConfigured) return;
    let hasAuthChange = false;
    const deadline = window.setTimeout(() => setCheckingSession(false), 4_000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      // An initial lookup can finish after an explicit sign-in or sign-out.
      if (event === "INITIAL_SESSION" && hasAuthChange) return;
      if (event !== "INITIAL_SESSION") hasAuthChange = true;
      window.clearTimeout(deadline);
      setUser(session?.user ?? null);
      setCheckingSession(false);
    });

    return () => {
      window.clearTimeout(deadline);
      subscription.unsubscribe();
    };
  }, []);

  if (checkingSession) return <PageLoading label="A verificar a sessão…" />;

  return (
    <Router>
      <Toaster position="top-right" richColors />
      <Suspense fallback={<PageLoading label="A carregar a página…" />}>
        <Routes>
          {/* Públicas */}
          <Route path="/" element={user ? <Navigate to="/dashboard" replace /> : <Landing />} />
          <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
          <Route path="/book/:userId" element={<PublicBooking />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/documentacao" element={<Docs />} />

          {/* Privadas */}
          <Route
            path="/onboarding"
            element={user ? <Layout user={user} pageTitle="Primeiro teste"><Onboarding key={user.id} accountId={user.id} /></Layout> : <Navigate to="/login" replace />}
          />
          <Route
            path="/dashboard"
            element={user ? <Layout user={user}><Dashboard key={user.id} user={user} /></Layout> : <Navigate to="/login" replace />}
          />
          <Route
            path="/appointments"
            element={user ? <Layout user={user}><Appointments key={user?.id} /></Layout> : <Navigate to="/login" replace />}
          />
          <Route
            path="/seller"
            element={user ? <Layout user={user}><Seller key={user.id} /></Layout> : <Navigate to="/login" replace />}
          />
          <Route
            path="/team"
            element={user ? <Layout user={user} pageTitle="Equipa e tarefas"><SellerTeam key={user.id} accountId={user.id} /></Layout> : <Navigate to="/login" replace />}
          />
          <Route
            path="/orders"
            element={user ? <Layout user={user}><Orders key={user?.id} /></Layout> : <Navigate to="/login" replace />}
          />
          <Route
            path="/digital-orders"
            element={user ? <Layout user={user}><DigitalOrders key={user.id} accountId={user.id} /></Layout> : <Navigate to="/login" replace />}
          />
          <Route
            path="/activate"
            element={user ? <Layout user={user}><Activate key={user?.id} /></Layout> : <Navigate to="/login" replace />}
          />
          <Route
            path="/upgrade"
            element={user ? <Layout user={user}><Activate key={user?.id} /></Layout> : <Navigate to="/login" replace />}
          />
          <Route
            path="/contacts"
            element={user ? <Layout user={user}><Contacts key={user?.id} /></Layout> : <Navigate to="/login" replace />}
          />
          <Route
            path="/messages"
            element={user ? <Layout user={user}><Messages key={user?.id} /></Layout> : <Navigate to="/login" replace />}
          />
          <Route
            path="/leads"
            element={user ? <Layout user={user}><Leads key={user?.id} /></Layout> : <Navigate to="/login" replace />}
          />
          <Route
            path="/agent"
            element={user ? <Layout user={user}><Agent key={user?.id} /></Layout> : <Navigate to="/login" replace />}
          />
          <Route
            path="/activity"
            element={user ? <Layout user={user}><ActivityLog key={user?.id} /></Layout> : <Navigate to="/login" replace />}
          />
          <Route
            path="/settings"
            element={user ? <Layout user={user}><Settings key={user?.id} /></Layout> : <Navigate to="/login" replace />}
          />
          <Route
            path="/automations"
            element={user ? <Layout user={user}><Automations key={user?.id} /></Layout> : <Navigate to="/login" replace />}
          />
          <Route
            path="/models"
            element={user ? <Layout user={user}><UserModels key={user?.id} /></Layout> : <Navigate to="/login" replace />}
          />
          <Route
            path="/quick-replies"
            element={user ? <Layout user={user}><QuickReplies key={user?.id} /></Layout> : <Navigate to="/login" replace />}
          />
          <Route
            path="/groups"
            element={user ? <Layout user={user}><Groups key={user?.id} /></Layout> : <Navigate to="/login" replace />}
          />
          <Route
            path="/menu-builder"
            element={user ? <Layout user={user}><MenuBuilderPage key={user?.id} /></Layout> : <Navigate to="/login" replace />}
          />
          <Route
            path="/admin/packs"
            element={user ? <Layout user={user}><AdminPacks key={user?.id} /></Layout> : <Navigate to="/login" replace />}
          />
          <Route
            path="/schedule"
            element={user ? <Layout user={user}><Schedule key={user?.id} /></Layout> : <Navigate to="/login" replace />}
          />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Router>
  );
}
