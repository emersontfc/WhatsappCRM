import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { 
  QrCode, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle,
  MessageSquare,
  Users,
  Clock,
  Zap,
  ShieldAlert,
  ChevronRight,
  Phone,
  Key,
  Trash2,
  Terminal,
  Activity,
  ExternalLink,
  Pause,
  UserPlus,
  Bot,
  Settings as SettingsIcon,
  Search
} from "lucide-react";
import { toast } from "sonner";
import { supabase, getUserId, getUser } from "../supabase";
import { Button } from "../components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/Card";
import { cn } from "../lib/utils";
import { useActivation } from "../lib/useActivation";
import { apiFetch } from "../lib/api";
import { Badge } from "../components/ui/Badge";
import { TemplateModal } from "../components/TemplateModal";
import { QRCodeSVG } from "qrcode.react";

const ConnectionStatusBadge = ({ status }: { status: string | null }) => {
  let label = "Desconectado";
  let variant: "success" | "warning" | "error" | "info" = "error";
  let pulse = false;

  if (status === "connected") {
    label = "Conectado";
    variant = "success";
  } else if (status === "connecting" || status === "qr") {
    label = "Conectando";
    variant = "warning";
    pulse = true;
  }

  return (
    <Badge variant={variant} pulse={pulse} className="px-3 py-1.5 text-[10px] uppercase tracking-widest font-bold bg-white border border-slate-100 shadow-sm">
      <span className={cn("w-1.5 h-1.5 rounded-full mr-2", 
        variant === "success" ? "bg-emerald-500" : 
        variant === "warning" ? "bg-amber-500" : 
        "bg-red-500"
      )} />
      <span className="text-slate-700">{label}</span>
    </Badge>
  );
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { isActivated, plan, planDetails, loading: activationLoading } = useActivation();
  const [status, setStatus] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [me, setMe] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({
    contacts: 0,
    messages: 0,
    scheduled: 0,
    automations: 0,
    leads: 0,
    actions: 0
  });
  const [agent, setAgent] = useState<any>(null);
  const [recentMessages, setRecentMessages] = useState<any[]>([]);
  const [systemLogs, setSystemLogs] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"messages" | "logs" | "leads">("messages");
  const [leads, setLeads] = useState<any[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState("Usuário");
  const [showTemplateModal, setShowTemplateModal] = useState(false);

  // 🔥 APENAS ESTA PARTE FOI ALTERADA — resto mantém igual

useEffect(() => {
  const fetchUserData = async () => {
    try {
      const user = await getUser();

      if (!user) return;

      setUserId(user.id);
      setUserName(
        user.user_metadata?.full_name ||
        user.email?.split("@")[0] ||
        "Usuário"
      );

      if (user.template_applied === false) {
        setShowTemplateModal(true);
      }

      // ✅ BUSCAR AGENT
      const { data: agentData, error } = await supabase
        .from("agents")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Erro ao buscar agent:", error);
      }

      // 🔥 SE NÃO EXISTIR → CRIA AUTOMATICAMENTE
      if (!agentData) {
        console.log("Agent não encontrado, criando automaticamente...");

        const { data: newAgent, error: insertError } = await supabase
          .from("agents")
          .insert({
            user_id: user.id,
            is_active: false
          })
          .select()
          .single();

        if (insertError) {
          console.error("Erro ao criar agent:", insertError);
        } else {
          setAgent(newAgent);
        }
      } else {
        setAgent(agentData);
      }

    } catch (err) {
      console.error("Erro no fetchUserData:", err);
    }
  };

  fetchUserData();
}, []);

  useEffect(() => {
    if (!userId) return;

    const fetchLeads = async () => {
      const { data } = await supabase
        .from("leads")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10);
      setLeads(data || []);
    };

    fetchStats(userId);
    fetchRecentMessages(userId);
    fetchSystemLogs(userId);
    fetchLeads();

    const interval = setInterval(() => {
      fetchStats(userId);
      fetchRecentMessages(userId);
      fetchSystemLogs(userId);
      fetchLeads();
    }, 30000);

    return () => clearInterval(interval);
  }, [userId]);

  const debugAuth = async () => {
    try {
      const frontendUrl = (import.meta.env.VITE_SUPABASE_URL || "NOT_SET").substring(0, 15) + "...";
      const backendResponse = await apiFetch("/api/debug/auth");
      
      const backendUrl = backendResponse.supabaseUrl;
      const match = frontendUrl === backendUrl;
      
      if (match) {
        toast.success("Configuração de Auth consistente entre Frontend e Backend.");
      } else {
        toast.error(`Inconsistência de Auth detectada! Frontend: ${frontendUrl}, Backend: ${backendUrl}. Verifique as variáveis de ambiente no Render.`);
      }
      
      console.log("Debug Auth Result:", {
        frontendUrl,
        backendUrl,
        match,
        backendInfo: backendResponse
      });
    } catch (err: any) {
      console.error("Debug auth failed:", err);
      toast.error("Falha ao verificar configuração de auth: " + err.message);
    }
  };

  const fetchRecentMessages = async (uId: string) => {
    if (!uId) return;
    const { data: initialMessages } = await supabase
      .from("messages")
      .select("*")
      .eq("user_id", uId)
      .order("timestamp", { ascending: false })
      .limit(20);
    
    if (initialMessages && initialMessages.length > 0) {
      const contactIds = [...new Set(initialMessages.map(m => m.contact_id))];
      const { data: contactsData } = await supabase
        .from("contacts")
        .select("id, name, phone")
        .in("id", contactIds);
        
      const contactsMap = new Map(contactsData?.map(c => [c.id, c]) || []);
      
      const mappedMessages = initialMessages.map(msg => ({
        ...msg,
        contacts: contactsMap.get(msg.contact_id)
      }));
      
      setRecentMessages(mappedMessages);
    }
  };

  const fetchSystemLogs = async (uId: string) => {
    if (!uId) return;
    const { data } = await supabase
      .from("logs")
      .select("*")
      .eq("user_id", uId)
      .order("created_at", { ascending: false })
      .limit(20);
    setSystemLogs(data || []);
  };

  const fetchStats = async (userId: string) => {
    try {
      if (!userId) return;
      
      console.log("Fetching stats for:", userId);
      
      // Contacts count
      const { count: contactsCount, error: contactsError } = await supabase
        .from("contacts")
        .select("id", { count: 'exact' })
        .eq("user_id", userId)
        .limit(1);
      
      if (contactsError) console.error("Error fetching contacts:", contactsError);
      else console.log("Fetched contacts count:", contactsCount);
      
      // Messages count (outbound)
      const { count: messagesCount, error: messagesError } = await supabase
        .from("messages")
        .select("id", { count: 'exact' })
        .eq("user_id", userId)
        .eq("type", "outbound")
        .limit(1);
        
      if (messagesError) console.error("Error fetching messages count:", messagesError);
      else console.log("Fetched messages count:", messagesCount);

      // Scheduled messages count
      const { count: scheduledCount, error: scheduledError } = await supabase
        .from("scheduled_messages")
        .select("id", { count: 'exact' })
        .eq("user_id", userId)
        .limit(1);
        
      if (scheduledError) console.error("Error fetching scheduled messages count:", scheduledError);
      else console.log("Fetched scheduled count:", scheduledCount);

      // Automations count
      const { count: automationsCount } = await supabase
        .from("automations")
        .select("id", { count: 'exact' })
        .eq("user_id", userId)
        .limit(1);

      // Leads count
      const { count: leadsCount } = await supabase
        .from("leads")
        .select("id", { count: 'exact' })
        .eq("user_id", userId)
        .limit(1);

      // Actions count
      const { count: actionsCount } = await supabase
        .from("agent_logs")
        .select("id", { count: 'exact' })
        .eq("user_id", userId)
        .limit(1);
        
      setStats({
        contacts: contactsCount || 0,
        messages: messagesCount || 0,
        scheduled: scheduledCount || 0,
        automations: automationsCount || 0,
        leads: leadsCount || 0,
        actions: actionsCount || 0
      });
    } catch (err) {
      console.error("Error fetching stats:", err);
    }
  };

  const isCheckingStatus = useRef(false);
  const connectingSince = useRef<number | null>(null);
  const qrSince = useRef<number | null>(null);

  const checkStatus = async (uId: string, manual = false) => {
    if (!uId || uId === "guest-user" || isCheckingStatus.current) return;
    
    // Check if we have a valid session before calling the API to avoid 401s
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      if (manual) toast.error("Sessão expirada. Por favor, faça login novamente.");
      return;
    }
    
    isCheckingStatus.current = true;
    try {
      // Use the simplified status endpoint
      const data = await apiFetch(`/api/whatsapp/status`);
      
      if (data.status === "connected") {
        connectingSince.current = null;
        qrSince.current = null;
        setStatus("connected");
        setQr(null);
        if (manual) toast.success("Conectado com sucesso!");
        
        // Fetch 'me' info if connected
        try {
          const meData = await apiFetch(`/api/whatsapp/me`);
          if (meData.me) setMe(meData.me);
        } catch (e) {}
      } else if (data.status === "qr") {
        connectingSince.current = null;
        
        // Check how long it's been showing QR
        if (!qrSince.current) {
          qrSince.current = Date.now();
        } else if (Date.now() - qrSince.current > 120000) { // 120 seconds timeout for QR
          console.log("[WhatsApp] QR timeout reached, resetting...");
          qrSince.current = null;
          await resetSession();
          setStatus("disconnected");
          setQr(null);
          toast.error("O código expirou. Tente novamente.");
          return;
        }

        // Fetch QR code specifically FIRST to avoid UI flicker
        const qrData = await apiFetch(`/api/whatsapp/qr`);
        
        if (qrData.qr) {
          setQr(qrData.qr);
          setStatus("qr");
        } else {
          // If status is QR but no code yet, just wait
          setStatus("connecting");
          setQr(null);
        }
      } else if (data.status === "connecting") {
        qrSince.current = null;
        // Check how long it's been connecting
        if (!connectingSince.current) {
          connectingSince.current = Date.now();
        } else if (Date.now() - connectingSince.current > 60000) { // 60 seconds timeout for connecting
          console.log("[WhatsApp] Connecting timeout reached, resetting...");
          connectingSince.current = null;
          await resetSession();
          setStatus("disconnected");
          setQr(null);
          toast.error("A conexão demorou muito. Tente novamente.");
          return;
        }
        // Just wait if it's still connecting
        setStatus("connecting");
        setQr(null);
      } else {
        connectingSince.current = null;
        qrSince.current = null;
        setStatus(data.status || "disconnected");
        setQr(null);
        if (manual && data.status === "disconnected") toast.info("Desconectado.");
      }
      
      setError(null);
    } catch (err: any) {
      const errMsg = (err?.message || String(err)).toLowerCase();
      // Silently ignore expected/benign errors during polling
      const isExpectedError = 
        errMsg.includes("load failed") || 
        errMsg.includes("failed to fetch") || 
        errMsg.includes("demorou muito para responder") ||
        errMsg.includes("erro de conexão") ||
        errMsg.includes("status 404") ||
        errMsg.includes("not found") ||
        errMsg.includes("aborted") ||
        errMsg.includes("status 401") ||
        errMsg.includes("unauthorized") ||
        errMsg.includes("html error") ||
        errMsg.includes("404");

      if (isExpectedError) {
        if (manual) console.warn(`[WhatsApp] Expected error during manual check: ${errMsg}`);
        return;
      }
      console.error(`[WhatsApp] Failed to check status for ${uId}:`, err);
      if (manual) toast.error(`Erro ao verificar status: ${err.message}`);
    } finally {
      isCheckingStatus.current = false;
    }
  };

  const connect = async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch(`/api/whatsapp/connect`, {
        method: "POST",
      });
      
      setStatus(data.status || "connecting");
      toast.info("Iniciando conexão...");
    } catch (err: any) {
      console.error("[WhatsApp] Failed to connect:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const resetSession = async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`/api/whatsapp/reset`, {
        method: "POST",
      });
      setStatus("disconnected");
      setQr(null);
      setMe(null);
      toast.success("Sessão resetada com sucesso!");
    } catch (err: any) {
      console.error("Failed to reset:", err);
      setError(err.message);
      toast.error("Erro ao resetar sessão.");
    } finally {
      setLoading(false);
    }
  };

  const pauseSession = async () => {
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`/api/whatsapp/pause`, {
        method: "POST",
      });
      setStatus("paused");
      setMe(null);
      toast.success("Conexão pausada com sucesso!");
    } catch (err: any) {
      console.error("Failed to pause:", err);
      setError(err.message);
      toast.error("Erro ao pausar conexão.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activationLoading || !isActivated) return;
    const init = async () => {
      const uId = await getUserId();
      console.log("Dashboard init, userId:", uId, "isActivated:", isActivated);
      console.log("Supabase client initialized:", !!supabase);
      
      if (uId && uId !== "guest-user") {
        setUserId(uId);
        await checkStatus(uId);
        await fetchStats(uId);
        
        console.log("Fetching messages for:", uId);
        // Initial fetch for recent messages
        const { data: initialMessages, error: msgError } = await supabase
          .from("messages")
          .select("*")
          .eq("user_id", uId)
          .order("timestamp", { ascending: false })
          .limit(20);
        
        if (msgError) console.error("Error fetching messages:", msgError);
        
        if (initialMessages && initialMessages.length > 0) {
          const contactIds = [...new Set(initialMessages.map(m => m.contact_id))];
          const { data: contactsData } = await supabase
            .from("contacts")
            .select("id, name, phone")
            .in("id", contactIds);
            
          const contactsMap = new Map(contactsData?.map(c => [c.id, c]) || []);
          
          const mappedMessages = initialMessages.map(msg => ({
            ...msg,
            contacts: contactsMap.get(msg.contact_id)
          }));
          
          setRecentMessages(mappedMessages);
        }

        // Initial fetch for logs
        const { data: initialLogs } = await supabase
          .from("logs")
          .select("*")
          .eq("user_id", uId)
          .order("created_at", { ascending: false })
          .limit(20);
        
        if (initialLogs) {
          setSystemLogs(initialLogs);
        }
        
        // Real-time subscription for messages
        const messagesSubscription = supabase
          .channel('dashboard-messages')
          .on('postgres_changes', { 
            event: '*', 
            schema: 'public', 
            table: 'messages',
            filter: `user_id=eq.${uId}`
          }, async () => {
            const { data: updatedMessages } = await supabase
              .from("messages")
              .select("*")
              .eq("user_id", uId)
              .order("timestamp", { ascending: false })
              .limit(20);
            
            if (updatedMessages && updatedMessages.length > 0) {
              const contactIds = [...new Set(updatedMessages.map(m => m.contact_id))];
              const { data: contactsData } = await supabase
                .from("contacts")
                .select("id, name, phone")
                .in("id", contactIds);
                
              const contactsMap = new Map(contactsData?.map(c => [c.id, c]) || []);
              
              const mappedMessages = updatedMessages.map(msg => ({
                ...msg,
                contacts: contactsMap.get(msg.contact_id)
              }));
              setRecentMessages(mappedMessages);
            }
          })
          .subscribe();

        // Real-time subscription for logs
        const logsSubscription = supabase
          .channel('dashboard-logs')
          .on('postgres_changes', { 
            event: 'INSERT', 
            schema: 'public', 
            table: 'logs',
            filter: `user_id=eq.${uId}`
          }, (payload) => {
            setSystemLogs(prev => [payload.new, ...prev].slice(0, 20));
          })
          .subscribe();
        
        return () => {
          supabase.removeChannel(messagesSubscription);
          supabase.removeChannel(logsSubscription);
        };
      }
      return () => {};
    };

    const cleanupPromise = init();

    let ticks = 0;
    const interval = setInterval(async () => {
      const uId = await getUserId();
      if (uId && uId !== "guest-user") {
        await checkStatus(uId);
        
        // Only fetch stats every 6th tick (30 seconds) to reduce database load
        ticks++;
        if (ticks % 6 === 0) {
          await fetchStats(uId);
        }
      }
    }, 5000);

    return () => {
      clearInterval(interval);
      cleanupPromise.then(cleanup => cleanup && cleanup());
    };
  }, [activationLoading, isActivated]);

  const toggleAgent = async () => {
    if (!userId || !agent) return;
    const newState = !agent.is_active;
    try {
      await apiFetch("/api/agent/config", {
        method: "POST",
        body: JSON.stringify({ is_active: newState })
      });
      setAgent({ ...agent, is_active: newState });
      toast.success(newState ? "Smart Bot ativado!" : "Smart Bot desativado.");
    } catch (err) {
      toast.error("Erro ao alterar estado do bot.");
    }
  };

  const isFree = plan === "Free";

  const statsConfig = [
    { name: "Leads Capturados", value: stats.leads.toString(), icon: UserPlus, color: "text-blue-500", bg: "bg-blue-500/10", hideIfFree: true },
    { name: "Mensagens Bot", value: stats.messages.toString(), icon: MessageSquare, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { name: "Ações Inteligentes", value: stats.actions.toString(), icon: Zap, color: "text-amber-500", bg: "bg-amber-500/10", hideIfFree: true },
    { name: "Automações", value: stats.automations.toString(), icon: Activity, color: "text-purple-500", bg: "bg-purple-500/10" },
  ].filter(stat => !(isFree && stat.hideIfFree));

  if (activationLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-10 space-y-8 max-w-7xl mx-auto">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <h2 className="text-3xl font-bold text-slate-900 tracking-tight">
            Bem-vindo, <span className="text-emerald-600">{userName}</span>
          </h2>
          <p className="text-slate-500 font-medium">
            Seu assistente inteligente está pronto.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Smart Bot Toggle */}
          {!isFree && (
            <div 
              onClick={toggleAgent}
              className={cn(
                "flex items-center gap-3 px-4 py-2 rounded-2xl cursor-pointer transition-all border-2",
                agent?.is_active 
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm shadow-emerald-100" 
                  : "bg-slate-50 border-slate-200 text-slate-500"
              )}
            >
              <div className={cn(
                "h-8 w-8 rounded-xl flex items-center justify-center transition-all",
                agent?.is_active ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-400"
              )}>
                <Bot size={18} />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-black uppercase tracking-widest leading-none mb-0.5">Smart Bot</span>
                <span className="text-xs font-bold">{agent?.is_active ? "ATIVADO" : "DESATIVADO"}</span>
              </div>
              <div className={cn(
                "w-10 h-5 rounded-full relative transition-all ml-2",
                agent?.is_active ? "bg-emerald-500" : "bg-slate-300"
              )}>
                <div className={cn(
                  "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                  agent?.is_active ? "left-6" : "left-1"
                )} />
              </div>
            </div>
          )}

          <ConnectionStatusBadge status={status} />
          <Button 
            onClick={() => checkStatus(userId!, true)} 
            variant="outline"
            className="rounded-xl border-slate-200 font-medium text-sm h-10 px-4"
          >
            <RefreshCw size={16} className={cn(loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsConfig.map((stat, i) => (
          <Card key={i} className="border-slate-100 shadow-sm hover:shadow-md transition-all group overflow-hidden">
            <div className="p-6 flex items-center gap-4">
              <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-110", stat.bg, stat.color)}>
                <stat.icon size={24} />
              </div>
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-0.5">{stat.name}</p>
                <p className="text-2xl font-bold text-slate-900">{stat.value}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Recent Activity Section */}
        <div className="lg:col-span-12">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-slate-900">Atividade Recente</h3>
            <Button variant="ghost" size="sm" onClick={() => navigate("/activity")} className="text-emerald-600 font-bold">
              Ver Tudo
              <ChevronRight size={16} className="ml-1" />
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Last 3 Logs */}
            {systemLogs.slice(0, 3).map((log) => (
              <Card key={log.id} className="p-4 border-slate-100 shadow-sm flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Badge variant={log.level === 'error' ? 'error' : log.level === 'warn' ? 'warning' : log.level === 'success' ? 'success' : 'info'} className="text-[10px] uppercase font-black tracking-widest">
                      {log.level}
                    </Badge>
                    <span className="text-[10px] text-slate-400 font-bold">
                      {new Date(log.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 line-clamp-2 font-medium">
                    {log.message}
                  </p>
                </div>
              </Card>
            ))}
          </div>
        </div>

        {/* Left Column: Bot Control & Status */}
        <div className="lg:col-span-4 space-y-6">
          {/* Bot Status Card */}
          {!isFree && (
            <Card className="border-slate-100 shadow-sm overflow-hidden">
              <div className={cn(
                "p-6 flex flex-col items-center text-center space-y-4",
                agent?.is_active ? "bg-emerald-50/50" : "bg-slate-50/50"
              )}>
                <div className={cn(
                  "h-20 w-20 rounded-3xl flex items-center justify-center shadow-lg transition-all",
                  agent?.is_active ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-400"
                )}>
                  <Bot size={40} />
                </div>
                <div className="space-y-1">
                  <h3 className="font-bold text-slate-900 text-lg">Smart Bot</h3>
                  <p className="text-sm text-slate-500">
                    {agent?.is_active 
                      ? "Respondendo clientes e capturando leads." 
                      : "O bot está pausado no momento."}
                  </p>
                </div>
                <Button 
                  onClick={toggleAgent}
                  className={cn(
                    "w-full h-12 rounded-xl font-bold transition-all",
                    agent?.is_active 
                      ? "bg-white text-emerald-600 border-2 border-emerald-200 hover:bg-emerald-50" 
                      : "bg-emerald-600 text-white hover:bg-emerald-500"
                  )}
                >
                  {agent?.is_active ? "PAUSAR BOT" : "ATIVAR BOT"}
                </Button>
              </div>
              <div className="p-4 bg-white border-t border-slate-50 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Configurações</span>
                <Button variant="ghost" size="sm" onClick={() => navigate("/agent")} className="text-slate-400 hover:text-emerald-600">
                  <SettingsIcon size={16} />
                </Button>
              </div>
            </Card>
          )}

          {/* Connection Status Card */}
          <Card className="border-slate-100 shadow-sm overflow-hidden">
            <CardHeader className="p-6 border-b border-slate-50">
              <CardTitle className="text-lg font-bold text-slate-900">Conexão WhatsApp</CardTitle>
              <CardDescription className="text-xs">Status da sua instância</CardDescription>
            </CardHeader>
            <CardContent className="p-6 flex-1 flex flex-col items-center justify-center text-center space-y-6">
                  {/* Connection Methods / Display */}
                  <div className="w-full flex-1 flex flex-col items-center justify-center min-h-[280px]">
                    <AnimatePresence mode="wait">
                      {status === "connected" ? (
                        <motion.div 
                          key="connected"
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          className="space-y-6 w-full"
                        >
                          <div className="relative mx-auto w-24 h-24">
                            <div className="absolute inset-0 bg-emerald-500/10 blur-2xl rounded-full" />
                            <div className="relative h-24 w-24 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 border-2 border-white shadow-lg">
                              <CheckCircle2 size={48} />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <p className="text-xl font-bold text-slate-900">Conectado</p>
                            <p className="text-sm text-slate-500 font-medium">
                              {me?.id ? me.id.split(':')[0] : "Instância Ativa"}
                            </p>
                          </div>
                          <div className="grid grid-cols-2 gap-3 pt-2">
                            <Button variant="outline" className="rounded-xl border-slate-200 font-medium text-sm h-11" onClick={pauseSession}>
                              <Pause size={16} className="mr-2" />
                              Pausar
                            </Button>
                            <Button variant="outline" className="rounded-xl border-red-100 text-red-600 hover:bg-red-50 font-medium text-sm h-11" onClick={resetSession}>
                              <Trash2 size={16} className="mr-2" />
                              Sair
                            </Button>
                          </div>
                        </motion.div>
                      ) : (
                        <motion.div 
                          key="disconnected"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="w-full space-y-6"
                        >
                          {/* Content Area */}
                          <div className="relative min-h-[200px] flex flex-col items-center justify-center">
                            {loading || status === "connecting" ? (
                              <div className="flex flex-col items-center gap-4">
                                <div className="h-12 w-12 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
                                <div className="text-center space-y-1">
                                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Iniciando...</p>
                                  {connectingSince.current && (Date.now() - connectingSince.current > 15000) && (
                                    <Button 
                                      variant="ghost" 
                                      size="sm" 
                                      className="text-[10px] text-red-500 hover:text-red-600 font-bold uppercase tracking-widest mt-2"
                                      onClick={resetSession}
                                    >
                                      Demorando muito? Resetar
                                    </Button>
                                  )}
                                </div>
                              </div>
                            ) : qr ? (
                              <motion.div 
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="space-y-4"
                              >
                                <div className="p-4 bg-white rounded-3xl border border-slate-100 shadow-2xl shadow-emerald-500/5 mx-auto w-fit relative group">
                                  <div className="absolute -inset-1 bg-emerald-500/10 rounded-[32px] blur opacity-0 group-hover:opacity-100 transition-opacity" />
                                  <div className="relative bg-white p-2 rounded-2xl">
                                    <QRCodeSVG value={qr} size={180} level="M" includeMargin={false} />
                                  </div>
                                </div>
                                <div className="space-y-1">
                                  <p className="text-sm font-bold text-slate-900">Escaneie o QR Code</p>
                                  <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest">Abra o WhatsApp {">"} Aparelhos Conectados</p>
                                </div>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 uppercase tracking-widest"
                                  onClick={connect}
                                >
                                  Atualizar QR Code
                                </Button>
                              </motion.div>
                            ) : (
                              <div className="flex flex-col items-center gap-6 py-4 w-full max-w-sm mx-auto">
                                <div className="h-24 w-24 bg-slate-50 rounded-[2rem] border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-300 relative">
                                  <QrCode size={40} className="opacity-20" />
                                  <div className="absolute -bottom-1 -right-1 bg-white p-1.5 rounded-full shadow-sm border border-slate-100">
                                    <Zap size={14} className="text-emerald-500" />
                                  </div>
                                </div>
                                <div className="space-y-4 w-full">
                                  <div className="space-y-1">
                                    <p className="text-sm font-bold text-slate-900">Pronto para conectar?</p>
                                    <p className="text-xs text-slate-400 font-medium">Gere um QR Code para escanear com seu celular.</p>
                                  </div>
                                  <Button 
                                    className="w-full h-14 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest shadow-lg shadow-emerald-500/20 transition-all"
                                    onClick={connect}
                                    disabled={loading}
                                  >
                                    {loading ? <RefreshCw className="animate-spin" /> : "GERAR QR CODE"}
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
            </CardContent>
          </Card>
        </div>

        {/* Real-time Monitor */}
        <div className="lg:col-span-8">
          <Card className="border-slate-100 shadow-sm overflow-hidden flex flex-col">
            <div className="p-5 border-b border-slate-100 bg-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600">
                  <Activity size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900">Monitor em Tempo Real</h3>
                  <p className="text-xs text-slate-500">Acompanhe as atividades do seu bot</p>
                </div>
              </div>
              <div className="flex bg-slate-100 p-1 rounded-lg w-full sm:w-auto">
                <button 
                  onClick={() => setActiveTab("messages")}
                  className={cn(
                    "flex-1 sm:flex-none px-4 py-1.5 text-xs font-bold rounded-md transition-all",
                    activeTab === "messages" ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  Mensagens
                </button>
                <button 
                  onClick={() => setActiveTab("logs")}
                  className={cn(
                    "flex-1 sm:flex-none px-4 py-1.5 text-xs font-bold rounded-md transition-all",
                    activeTab === "logs" ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  Logs
                </button>
                {!isFree && (
                  <button 
                    onClick={() => setActiveTab("leads")}
                    className={cn(
                      "flex-1 sm:flex-none px-4 py-1.5 text-xs font-bold rounded-md transition-all",
                      activeTab === "leads" ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                    )}
                  >
                    Leads
                  </button>
                )}
              </div>
            </div>
            <CardContent className="p-0 flex-1">
              <div className="h-[400px] overflow-y-auto custom-scrollbar">
                {activeTab === "messages" ? (
                  <div className="divide-y divide-slate-50">
                    {recentMessages.length > 0 ? (
                      recentMessages.map((msg, i) => (
                        <div key={i} className="p-4 hover:bg-slate-50/50 transition-colors flex items-start gap-4">
                          <div className={cn(
                            "h-10 w-10 rounded-full flex items-center justify-center shrink-0 shadow-sm font-bold text-xs",
                            msg.type === "inbound" ? "bg-blue-50 text-blue-600" : "bg-emerald-50 text-emerald-600"
                          )}>
                            {(msg.contacts?.name || msg.contacts?.phone || "D").charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start mb-1">
                              <p className="font-bold text-sm text-slate-900 truncate">
                                {msg.contacts?.name || msg.contacts?.phone || "Desconhecido"}
                              </p>
                              <span className="text-[10px] font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <p className="text-sm text-slate-600 line-clamp-2 leading-relaxed">
                              {msg.text}
                            </p>
                            <div className="flex items-center gap-3 mt-2">
                              <span className={cn(
                                "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded",
                                msg.type === "inbound" ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"
                              )}>
                                {msg.type === "inbound" ? "Recebida" : "Enviada"}
                              </span>
                              {msg.is_automated && (
                                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-100 text-amber-700 flex items-center gap-1">
                                  <Zap size={10} />
                                  Automática
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
                        <MessageSquare size={32} className="text-slate-200 mb-3" />
                        <p className="text-sm font-bold text-slate-400">Aguardando mensagens...</p>
                      </div>
                    )}
                  </div>
                ) : activeTab === "logs" ? (
                  <div className="divide-y divide-slate-50 font-mono">
                    {systemLogs.length > 0 ? (
                      systemLogs.map((log) => (
                        <div key={log.id} className="p-4 hover:bg-slate-50/50 transition-colors flex items-start gap-4">
                          <div className={cn(
                            "h-2 w-2 rounded-full mt-2 shrink-0",
                            log.level === "error" ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" :
                            log.level === "warn" ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" :
                            log.level === "success" ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" :
                            "bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"
                          )} />
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start mb-1">
                              <span className={cn(
                                "text-[10px] font-bold uppercase tracking-widest",
                                log.level === "error" ? "text-red-600" :
                                log.level === "warn" ? "text-amber-600" :
                                log.level === "success" ? "text-emerald-600" :
                                "text-blue-600"
                              )}>
                                {log.level}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                {new Date(log.created_at).toLocaleTimeString()}
                              </span>
                            </div>
                            <p className="text-xs text-slate-700 leading-relaxed">
                              {log.message}
                            </p>
                            {log.details && Object.keys(log.details).length > 0 && (
                              <pre className="mt-2 text-[10px] bg-slate-900 text-slate-300 p-2 rounded-lg overflow-x-auto max-h-32">
                                {JSON.stringify(log.details, null, 2)}
                              </pre>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
                        <Terminal size={32} className="text-slate-200 mb-3" />
                        <p className="text-sm font-bold text-slate-400">Nenhum log disponível...</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="divide-y divide-slate-50">
                    {leads.length > 0 ? (
                      leads.map((lead) => (
                        <div key={lead.id} className="p-4 hover:bg-slate-50/50 transition-colors flex items-start gap-4">
                          <div className="h-10 w-10 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center shrink-0 shadow-sm">
                            <UserPlus size={18} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start mb-1">
                              <p className="font-bold text-sm text-slate-900 truncate">
                                {lead.name || lead.phone}
                              </p>
                              <span className="text-[10px] font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                                {new Date(lead.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 mb-2">
                              {lead.intent ? `Intenção: ${lead.intent}` : "Interação inicial"}
                            </p>
                            <p className="text-sm text-slate-600 line-clamp-1 italic">
                              "{lead.last_message}"
                            </p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
                        <UserPlus size={32} className="text-slate-200 mb-3" />
                        <p className="text-sm font-bold text-slate-400">Nenhum lead capturado ainda.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
            <div className="p-4 bg-slate-50/50 border-t border-slate-50">
              <Button 
                variant="ghost" 
                className="w-full h-9 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-900"
                onClick={() => navigate(activeTab === "messages" ? "/messages" : activeTab === "logs" ? "/activity" : "/leads")}
              >
                {activeTab === "messages" ? "Ver Histórico Completo" : activeTab === "logs" ? "Ver Todos os Logs" : "Ver Todos os Leads"}
                <ChevronRight size={14} className="ml-1" />
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
