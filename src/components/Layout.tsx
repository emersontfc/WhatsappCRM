import React, { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { 
  LayoutDashboard, 
  Users, 
  MessageSquare, 
  Settings, 
  LogOut, 
  CreditCard,
  Zap,
  ShieldCheck,
  Menu,
  X,
  Bot,
  Calendar as CalendarIcon,
  Package
} from "lucide-react";
import { supabase, getUser } from "../supabase";
import { cn } from "../lib/utils";
import { Button } from "./ui/Button";
import { apiFetch } from "../lib/api";

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isActivated, setIsActivated] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userPlan, setUserPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const checkStatus = async () => {
      try {
        const user = await getUser();
        if (!user) {
          if (isMounted) setLoading(false);
          return;
        }

        if (isMounted) {
          setUserName(user.user_metadata?.full_name || user.email?.split("@")[0] || "Usuário");
          setUserEmail(user.email || "");
        }

        // Fetch profile/subscription from backend to ensure consistency and isolation
        const response = await apiFetch("/api/ai/subscription");
        
        if (isMounted && response.success && response.data) {
          const sub = response.data;
          const adminStatus = sub?.role === "admin";
          setIsAdmin(adminStatus);
          
          const plan = sub?.plan || sub?.subscription?.plan;
          setUserPlan(plan || "Free");
          
          // Activation rule: isActivated = !!plan OR isAdmin
          setIsActivated(adminStatus || !!plan || sub?.isActivated === true);
        }
      } catch (err) {
        console.error("Layout status check failed:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    checkStatus();
    return () => { isMounted = false; };
  }, []);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      // Clear all local storage and session storage to prevent cache issues
      localStorage.clear();
      sessionStorage.clear();
      // Force reload to clear all React state and redirect
      window.location.href = "/login";
    } catch (err) {
      console.error("Logout failed:", err);
      window.location.href = "/login";
    }
  };

  const navItems = [
    { name: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
    { name: "Contatos", path: "/contacts", icon: Users },
    { name: "Mensagens", path: "/messages", icon: MessageSquare },
    { name: "Automações", path: "/automations", icon: Zap },
    { name: "Modelos", path: "/models", icon: MessageSquare },
    { name: "Agente IA", path: "/agent", icon: Bot },
    { name: "Agendamentos", path: "/schedule", icon: CalendarIcon },
  ];

  if (isAdmin) {
    navItems.push({ name: "Gerenciar Packs", path: "/admin/packs", icon: Package });
  }

  if (!isAdmin && !isActivated) {
    navItems.push({ name: "Ativação", path: "/activate", icon: CreditCard });
  }

  if (isAdmin) {
    navItems.push({ name: "Configurações", path: "/settings", icon: Settings });
  } else {
    // Non-admins also need settings for profile/subscription
    navItems.push({ name: "Configurações", path: "/settings", icon: Settings });
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden relative">
      {/* Mobile Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 border-r border-slate-200 bg-white flex flex-col transition-transform duration-300 lg:relative lg:translate-x-0",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 bg-emerald-600 rounded-lg flex items-center justify-center text-white">
              <Zap size={20} />
            </div>
            <span className="font-bold text-xl tracking-tight">WhatsCRM</span>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            className="lg:hidden" 
            onClick={() => setIsSidebarOpen(false)}
          >
            <X size={20} />
          </Button>
        </div>

        <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                location.pathname === item.path
                  ? "bg-emerald-50 text-emerald-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              )}
            >
              <item.icon size={18} />
              {item.name}
            </Link>
          ))}
        </nav>

        {!isActivated && location.pathname !== "/activate" && (
          <div className="p-4 m-4 bg-amber-50 rounded-xl border border-amber-100 space-y-3">
            <p className="text-xs text-amber-800 font-medium">Sua conta não está ativa. Ative agora para liberar todos os recursos.</p>
            <Button 
              size="sm" 
              className="w-full bg-amber-600 hover:bg-amber-700 text-[10px] h-7"
              onClick={() => navigate("/activate")}
            >
              Ativar Agora
            </Button>
          </div>
        )}

        <div className="p-4 border-t border-slate-200">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-slate-600 hover:text-red-600 hover:bg-red-50"
            onClick={handleLogout}
          >
            <LogOut size={18} />
            Sair
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-30 flex items-center px-4 lg:px-8 justify-between shrink-0">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon" 
              className="lg:hidden" 
              onClick={() => setIsSidebarOpen(true)}
            >
              <Menu size={20} />
            </Button>
            <h1 className="text-lg font-semibold text-slate-900 truncate max-w-[150px] sm:max-w-none">
              {navItems.find(item => item.path === location.pathname)?.name || "Dashboard"}
            </h1>
            {isAdmin && (
              <span className="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase">
                <ShieldCheck size={10} />
                Admin
              </span>
            )}
            {!isAdmin && userPlan && (
              <span className={cn(
                "hidden sm:flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
                userPlan === "Premium" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700"
              )}>
                <Zap size={10} />
                {userPlan}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 lg:gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium truncate max-w-[120px]">{userName}</p>
              <p className="text-xs text-slate-500 truncate max-w-[120px]">{userEmail}</p>
            </div>
            <div className="h-8 w-8 rounded-full border border-slate-200 shrink-0 bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-xs">
              {userName.charAt(0).toUpperCase()}
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
