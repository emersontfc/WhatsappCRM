import React, { useState, useEffect } from "react";
import type { User } from "@supabase/supabase-js";
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
  UserPlus,
  CalendarCheck,
  BookOpen,
  ShoppingCart
} from "lucide-react";
import AgentXLogo from "./AgentXLogo";
import { supabase } from "../supabase";
import { cn } from "../lib/utils";
import { Badge } from "./ui/Badge";
import { apiFetch } from "../lib/api";
import { Button } from "./ui/Button";
import { AgentexCopilot } from "./AgentexCopilot";
import { DEFAULT_NICHE, NICHE_CONFIGS, toCanonicalNiche, type CanonicalBusinessType } from "../lib/niches";

interface LayoutProps {
  children: React.ReactNode;
  user: Pick<User, "id" | "email" | "user_metadata">;
}

export default function Layout({ children, user }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { id: userId, email: userEmail = "" } = user;
  const rawName = user.user_metadata?.full_name;
  const userName = (typeof rawName === "string" && rawName.trim()) || userEmail.split("@")[0] || "Utilizador";
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [subscription, setSubscription] = useState<{ userId: string; plan: string; isAdmin: boolean }>();
  const [niche, setNiche] = useState<{ userId: string; type: CanonicalBusinessType }>();
  const currentSubscription = subscription?.userId === userId ? subscription : undefined;
  const isAdmin = currentSubscription?.isAdmin ?? false;
  const userPlan = currentSubscription?.plan;
  const activeNiche = niche?.userId === userId ? niche.type : DEFAULT_NICHE;

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const options = { accountId: userId, signal, timeout: 8000 };
    let editedNiche = false;
    const handleNicheChange = (event: Event) => {
      const type = (event as CustomEvent<unknown>).detail;
      if (typeof type !== "string") return;
      editedNiche = true;
      setNiche({ userId, type: toCanonicalNiche(type) });
    };
    window.addEventListener("crm_niche_changed", handleNicheChange);

    void apiFetch("/api/company/profile", options).then((response) => {
      if (!signal.aborted && !editedNiche && response?.success && response.data?.userId === userId && typeof response.data.type === "string") {
        setNiche({ userId, type: toCanonicalNiche(response.data.type) });
      }
    }).catch((error) => {
      if (!signal.aborted) console.warn("Não foi possível consultar o perfil da empresa.", error);
    });

    void apiFetch("/api/ai/subscription", options).then((response) => {
      if (signal.aborted || !response?.success || response.data?.id !== userId) return;
      const { plan, subscription: details, role } = response.data;
      const rawPlan = plan || details?.plan;
      setSubscription({
        userId,
        plan: typeof rawPlan === "string" ? rawPlan : "Free",
        isAdmin: role === "admin" || role === "superadmin"
      });
    }).catch((error) => {
      if (!signal.aborted) console.warn("Não foi possível consultar a subscrição.", error);
    });

    return () => {
      controller.abort();
      window.removeEventListener("crm_niche_changed", handleNicheChange);
    };
  }, [userId]);

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
        { name: "Início", path: "/dashboard", icon: LayoutDashboard },
        { name: "Mensagens", path: "/messages", icon: MessageCircle },
        { name: "Marcações e lembretes", path: "/appointments", icon: CalendarCheck },
      ]
    },
    {
      title: "Vendas e clientes",
      items: [
        { name: "Vendedor", path: "/seller", icon: ShoppingCart },
        { name: "Catálogo e pedidos", path: "/orders", icon: ShoppingCart },
        { name: "Entrega de ficheiros", path: "/digital-orders", icon: ShoppingCart },
        { name: "Leads", path: "/leads", icon: UserPlus },
        { name: "Contactos", path: "/contacts", icon: Users },
      ]
    },
    {
      title: "WhatsApp e automações",
      items: [
        { name: "Grupos", path: "/groups", icon: Users2, premiumOnly: true },
        { name: "Mensagens e publicações", path: "/schedule", icon: Clock, premiumOnly: true },
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
        { name: "Documentação", path: "/docs", icon: BookOpen },
        { name: "Configurações", path: "/settings", icon: Settings },
      ]
    }
  ];

  // Filter sections based on plan
  const visibleSections = sections.map(section => ({
    ...section,
    items: section.items.filter(item => {
      if ("premiumOnly" in item && item.premiumOnly && (!userPlan || userPlan === "Free")) {
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
        <div className="p-8 flex items-center justify-between">
          <div className="cursor-pointer" onClick={() => navigate("/dashboard")}>
            <AgentXLogo size="md" />
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
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-10 h-[100dvh]">
        <header className="h-16 sm:h-20 border-b-2 border-slate-50 bg-white/80 backdrop-blur-xl sticky top-0 z-30 flex items-center px-3 sm:px-8 lg:px-12 justify-between shrink-0">
          <div className="flex items-center gap-3 sm:gap-6 min-w-0">
            <Button 
              variant="ghost" 
              size="icon" 
              className="lg:hidden text-slate-500 hover:bg-slate-50 rounded-xl shrink-0" 
              onClick={() => setIsSidebarOpen(true)}
            >
              <Menu size={22} />
            </Button>
            <div className="flex flex-col min-w-0">
              <h1 className="text-base sm:text-xl font-bold text-slate-900 tracking-tight truncate">
                {allNavItems.find(item => item.path === location.pathname)?.name || "Dashboard"}
              </h1>
              <div className="flex items-center gap-1.5 sm:gap-2 mt-0.5">
                {isAdmin && (
                  <Badge variant="success" className="text-[8px] sm:text-[9px] px-1.5 sm:px-2 py-0.5 font-bold uppercase tracking-widest">
                    Administrador
                  </Badge>
                )}
                {userPlan && userPlan.toLowerCase() !== "admin" && (
                  <Badge 
                    variant="info"
                    className="text-[8px] sm:text-[9px] px-1.5 sm:px-2 py-0.5 font-bold uppercase tracking-widest"
                  >
                    {userPlan}
                  </Badge>
                )}
                <span className="inline-flex items-center gap-1 text-[9px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                  {NICHE_CONFIGS[activeNiche]?.icon && React.createElement(NICHE_CONFIGS[activeNiche].icon, { size: 10, className: "text-emerald-600" })}
                  {NICHE_CONFIGS[activeNiche]?.label || "Geral"}
                </span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-3 sm:gap-6 shrink-0">
            <div className="hidden lg:flex items-center gap-2 px-4 py-2 bg-slate-50 rounded-xl border border-slate-100 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              <Clock size={14} className="text-emerald-600" />
              Maputo, MZ
            </div>
            <div className="text-right hidden md:block">
              <p className="text-sm font-bold text-slate-900 leading-none mb-1">{userName}</p>
              <p className="text-[10px] text-slate-400 font-medium">{userEmail}</p>
            </div>
            <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-slate-900 flex items-center justify-center text-emerald-500 font-bold text-base sm:text-lg shadow-lg group cursor-pointer hover:scale-105 transition-all">
              {typeof userName === "string" && userName.length > 0 ? userName.charAt(0).toUpperCase() : "U"}
            </div>
          </div>
        </header>
        
        {/* Responsive Content Body */}
        <div className={cn(
          "flex-1 overflow-y-auto custom-scrollbar",
          location.pathname.startsWith("/messages")
            ? "min-h-0 p-1 sm:p-3 lg:p-6 overflow-hidden flex flex-col"
            : "p-3 sm:p-6 lg:p-10"
        )}>
          <div className={cn(
            "max-w-7xl mx-auto w-full",
            location.pathname.startsWith("/messages") ? "flex-1 flex flex-col min-h-0 min-w-0" : "pb-16 sm:pb-20"
          )}>
            {children}
          </div>
        </div>
      </main>

      {/* Agentex Copilot Slide-over and Floating Trigger */}
      <AgentexCopilot />
    </div>
  );
}
