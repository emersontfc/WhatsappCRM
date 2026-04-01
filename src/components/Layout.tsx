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
  Package,
  Terminal,
  Rocket,
  Clock,
  Sun,
  Moon
} from "lucide-react";
import { supabase, getUser } from "../supabase";
import { cn } from "../lib/utils";
import { Badge } from "./ui/Badge";
import { apiFetch } from "../lib/api";
import { Button } from "./ui/Button";

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
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') || 'light';
    }
    return 'light';
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

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
          
          // Standardized: plan is always present
          setIsActivated(true);
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

  // Navigation items for the sidebar
  const navItems = [
    { name: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
    { name: "Contatos", path: "/contacts", icon: Users },
    { name: "Mensagens", path: "/messages", icon: MessageSquare },
    { name: "Automações", path: "/automations", icon: Zap },
    { name: "Respostas Rápidas", path: "/quick-replies", icon: MessageSquare },
    { name: "Grupos", path: "/groups", icon: Users },
    { name: "Modelos", path: "/models", icon: MessageSquare },
    { name: "Agente IA", path: "/agent", icon: Bot },
    { name: "Agendamentos", path: "/schedule", icon: CalendarIcon },
  ];

  if (isAdmin) {
    navItems.push({ name: "Gerenciar Packs", path: "/admin/packs", icon: Package });
  }

  if (userPlan === "Free") {
    navItems.push({ name: "Upgrade", path: "/activate", icon: CreditCard });
  }

  navItems.push({ name: "Configurações", path: "/settings", icon: Settings });

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950 overflow-hidden relative font-sans text-slate-900 dark:text-slate-100 transition-colors duration-300">
      {/* Background Glows */}
      <div className="fixed top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500/5 dark:bg-emerald-500/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/5 dark:bg-blue-500/10 blur-[120px] rounded-full" />
      </div>

      {/* Mobile Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/20 dark:bg-slate-900/40 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-72 border-r border-slate-200/50 dark:border-slate-800/50 bg-white/70 dark:bg-slate-950/70 backdrop-blur-xl flex flex-col transition-all duration-500 lg:relative lg:translate-x-0 shadow-2xl lg:shadow-none",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-8 flex items-center justify-between">
          <div className="flex items-center gap-3 group cursor-pointer" onClick={() => navigate("/dashboard")}>
            <div className="h-10 w-10 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-emerald-500/20 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300">
              <Rocket size={22} />
            </div>
            <div className="flex flex-col">
              <span className="font-black text-xl tracking-tighter text-slate-900 dark:text-white group-hover:text-emerald-500 transition-colors">Agentex</span>
              <span className="text-[9px] uppercase tracking-[0.3em] text-emerald-600/80 font-bold">Automation Hub</span>
            </div>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            className="lg:hidden text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl" 
            onClick={() => setIsSidebarOpen(false)}
          >
            <X size={20} />
          </Button>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-1.5 overflow-y-auto custom-scrollbar">
          <div className="px-4 mb-4 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400/60">Menu Principal</div>
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-300 group relative overflow-hidden",
                  isActive
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shadow-[inset_0_0_20px_rgba(16,185,129,0.05)]"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/50 dark:hover:bg-slate-800/50"
                )}
              >
                {isActive && (
                  <div className="absolute left-0 top-2 bottom-2 w-1 bg-emerald-500 rounded-r-full shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                )}
                <item.icon size={18} className={cn("transition-all duration-300 group-hover:scale-110", isActive ? "text-emerald-500" : "text-slate-400 group-hover:text-emerald-500")} />
                {item.name}
                {isActive && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500 animate-glow-pulse" />
                )}
              </Link>
            );
          })}
        </nav>

        {userPlan === "Free" && location.pathname !== "/activate" && (
          <div className="p-6 m-4 bg-gradient-to-br from-emerald-500/5 to-blue-500/5 dark:from-emerald-500/10 dark:to-blue-500/10 rounded-2xl border border-emerald-500/10 dark:border-emerald-500/20 space-y-4 relative overflow-hidden group">
            <div className="absolute -top-10 -right-10 w-24 h-24 bg-emerald-500/10 blur-2xl rounded-full group-hover:scale-150 transition-transform duration-700" />
            <div className="relative z-10">
              <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-black uppercase tracking-widest mb-1">Upgrade Disponível</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed font-medium mb-4">Libere automações ilimitadas e o Agente IA avançado hoje mesmo.</p>
              <Button 
                variant="glow"
                size="sm" 
                className="w-full text-[11px] h-9 rounded-xl"
                onClick={() => navigate("/activate")}
              >
                Mudar para Pro
              </Button>
            </div>
          </div>
        )}

        <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-xl transition-all"
            onClick={handleLogout}
          >
            <LogOut size={20} />
            <span className="font-medium">Sair da Conta</span>
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-10">
        <header className="h-20 border-b border-slate-200/50 dark:border-slate-800/50 bg-white/60 dark:bg-slate-950/60 backdrop-blur-xl sticky top-0 z-30 flex items-center px-6 lg:px-10 justify-between shrink-0">
          <div className="flex items-center gap-6">
            <Button 
              variant="ghost" 
              size="icon" 
              className="lg:hidden text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl" 
              onClick={() => setIsSidebarOpen(true)}
            >
              <Menu size={24} />
            </Button>
            <div className="flex flex-col">
              <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tighter">
                {navItems.find(item => item.path === location.pathname)?.name || "Dashboard"}
              </h1>
              <div className="flex items-center gap-2 mt-0.5">
                {isAdmin && (
                  <Badge variant="success" className="text-[9px] px-1.5 py-0 h-4">
                    <ShieldCheck size={10} className="mr-1" />
                    Admin
                  </Badge>
                )}
                {userPlan && (
                  <Badge 
                    variant={userPlan === "Premium" ? "warning" : "info"} 
                    className="text-[9px] px-1.5 py-0 h-4"
                    pulse={userPlan === "Premium"}
                  >
                    <Zap size={10} className="mr-1" />
                    {userPlan}
                  </Badge>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all duration-300 hover:rotate-12"
              title={theme === 'light' ? 'Ativar Modo Escuro' : 'Ativar Modo Claro'}
            >
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            </Button>
            <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 bg-slate-100/50 dark:bg-slate-800/50 rounded-full border border-slate-200/50 dark:border-slate-700/50 text-[10px] font-black text-slate-500 uppercase tracking-widest">
              <Clock size={12} className="text-emerald-500" />
              GMT+2
            </div>
            <div className="text-right hidden md:block">
              <p className="text-sm font-black text-slate-900 dark:text-white leading-none mb-0.5">{userName}</p>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest opacity-60">{userEmail}</p>
            </div>
            <div className="h-11 w-11 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900 flex items-center justify-center text-emerald-500 font-black text-lg shadow-inner group cursor-pointer hover:scale-105 transition-transform">
              {userName.charAt(0).toUpperCase()}
            </div>
          </div>
        </header>
        
        <div className="flex-1 overflow-y-auto p-6 lg:p-10 custom-scrollbar">
          <div className="max-w-7xl mx-auto pb-20">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
