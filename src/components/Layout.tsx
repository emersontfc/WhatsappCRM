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
  Activity,
  MessageCircle,
  MessageSquareText,
  FileText,
  Users2,
  Hash,
  UserPlus
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

  // Navigation items for the sidebar organized by sections
  const sections = [
    {
      title: "Principal",
      items: [
        { name: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
        { name: "Mensagens", path: "/messages", icon: MessageCircle },
        { name: "Agendamentos", path: "/schedule", icon: CalendarIcon, premiumOnly: true },
      ]
    },
    {
      title: "Audiência",
      items: [
        { name: "Leads", path: "/leads", icon: UserPlus, premiumOnly: true },
        { name: "Contatos", path: "/contacts", icon: Users },
        { name: "Grupos", path: "/groups", icon: Users2, premiumOnly: true },
      ]
    },
    {
      title: "Automação & IA",
      items: [
        { name: "Agente IA", path: "/agent", icon: Bot, premiumOnly: true },
        { name: "Automações", path: "/automations", icon: Zap },
        { name: "Menu Inteligente", path: "/menu-builder", icon: Hash, premiumOnly: true },
        { name: "Respostas Rápidas", path: "/quick-replies", icon: MessageSquareText },
        { name: "Modelos", path: "/models", icon: FileText, premiumOnly: true },
      ]
    },
    {
      title: "Sistema",
      items: [
        { name: "Atividade", path: "/activity", icon: Activity },
        { name: "Configurações", path: "/settings", icon: Settings },
      ]
    }
  ];

  // Filter sections based on plan
  const visibleSections = sections.map(section => ({
    ...section,
    items: section.items.filter(item => {
      if ((item as any).premiumOnly && userPlan === "Free") {
        return false;
      }
      return true;
    })
  })).filter(section => section.items.length > 0);

  // Add conditional items to the System section
  if (isAdmin) {
    visibleSections.find(s => s.title === "Sistema")?.items.push({ name: "Gerenciar Packs", path: "/admin/packs", icon: Package });
  }

  if (userPlan === "Free") {
    visibleSections.find(s => s.title === "Sistema")?.items.push({ name: "Upgrade", path: "/activate", icon: CreditCard });
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent"></div>
      </div>
    );
  }

  const allNavItems = visibleSections.flatMap(s => s.items);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden relative font-sans text-slate-900 transition-colors duration-300">
      {/* Background Glows */}
      <div className="fixed top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500/5 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/5 blur-[120px] rounded-full" />
      </div>

      {/* Mobile Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-72 border-r-2 border-slate-100 bg-white flex flex-col transition-all duration-500 lg:relative lg:translate-x-0 shadow-2xl lg:shadow-none",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-10 flex items-center justify-between">
          <div className="flex items-center gap-4 group cursor-pointer" onClick={() => navigate("/dashboard")}>
            <div className="h-12 w-12 bg-emerald-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-emerald-600/20 group-hover:rotate-6 transition-all duration-300">
              <Rocket size={24} />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-2xl tracking-tight text-slate-900 leading-none">Agentex</span>
              <span className="text-[10px] uppercase tracking-widest text-emerald-600 font-bold mt-1">CRM Pro</span>
            </div>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            className="lg:hidden text-slate-400 hover:bg-slate-50 rounded-xl" 
            onClick={() => setIsSidebarOpen(false)}
          >
            <X size={20} />
          </Button>
        </div>

        <nav className="flex-1 px-6 py-4 space-y-8 overflow-y-auto custom-scrollbar">
          {visibleSections.map((section) => (
            <div key={section.title} className="space-y-2">
              <div className="px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">{section.title}</div>
              <div className="space-y-1">
                {section.items.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={cn(
                        "flex items-center gap-3 px-6 py-3 rounded-xl text-sm font-medium transition-all duration-200 group relative",
                        isActive
                          ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20"
                          : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                      )}
                    >
                      <item.icon size={18} className={cn("transition-all duration-200", isActive ? "text-white" : "text-slate-400 group-hover:text-emerald-600")} />
                      {item.name}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-6 border-t-2 border-slate-50 bg-slate-50/30">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all font-medium text-sm"
            onClick={handleLogout}
          >
            <LogOut size={18} />
            Sair da Conta
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-10">
        <header className="h-20 border-b-2 border-slate-50 bg-white/80 backdrop-blur-xl sticky top-0 z-30 flex items-center px-8 lg:px-12 justify-between shrink-0">
          <div className="flex items-center gap-6">
            <Button 
              variant="ghost" 
              size="icon" 
              className="lg:hidden text-slate-500 hover:bg-slate-50 rounded-xl" 
              onClick={() => setIsSidebarOpen(true)}
            >
              <Menu size={24} />
            </Button>
            <div className="flex flex-col">
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                {allNavItems.find(item => item.path === location.pathname)?.name || "Dashboard"}
              </h1>
              <div className="flex items-center gap-2 mt-0.5">
                {isAdmin && (
                  <Badge variant="success" className="text-[9px] px-2 py-0.5 font-bold uppercase tracking-widest">
                    Admin
                  </Badge>
                )}
                {userPlan && (
                  <Badge 
                    variant="info"
                    className="text-[9px] px-2 py-0.5 font-bold uppercase tracking-widest"
                  >
                    Plano {userPlan}
                  </Badge>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="hidden lg:flex items-center gap-2 px-4 py-2 bg-slate-50 rounded-xl border border-slate-100 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              <Clock size={14} className="text-emerald-600" />
              Maputo, MZ
            </div>
            <div className="text-right hidden md:block">
              <p className="text-sm font-bold text-slate-900 leading-none mb-1">{userName}</p>
              <p className="text-[10px] text-slate-400 font-medium">{userEmail}</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-slate-900 flex items-center justify-center text-emerald-500 font-bold text-lg shadow-lg group cursor-pointer hover:scale-105 transition-all">
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
