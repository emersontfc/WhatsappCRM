import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
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
  Copy,
  ExternalLink,
  Pause,
  Moon,
  Sun
} from "lucide-react";
import { toast } from "sonner";
import { supabase, getUserId, getUser } from "../supabase";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
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
  } else if (status === "connecting" || status === "qr" || status === "pairing") {
    label = "Conectando";
    variant = "warning";
    pulse = true;
  }

  return (
    <Badge variant={variant} pulse={pulse} className="px-3 py-1 text-[10px] uppercase tracking-widest font-black">
      <span className={cn("w-1.5 h-1.5 rounded-full mr-2", 
        variant === "success" ? "bg-emerald-500" : 
        variant === "warning" ? "bg-amber-500" : "bg-red-500"
      )} />
      {label}
    </Badge>
  );
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { isActivated, plan, planDetails, loading: activationLoading } = useActivation();
  const [status, setStatus] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [me, setMe] = useState<any>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectMethod, setConnectMethod] = useState<"qr" | "number">("number");
  const [stats, setStats] = useState({
    contacts: 0,
    messages: 0,
    scheduled: 0,
    automations: 0
  });
  const [recentMessages, setRecentMessages] = useState<any[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState("Usuário");
  const [showTemplateModal, setShowTemplateModal] = useState(false);

  useEffect(() => {
    const fetchUserData = async () => {
      const user = await getUser();
      if (user) {
        setUserId(user.id);
        setUserName(user.user_metadata?.full_name || user.email?.split("@")[0] || "Usuário");
        if (user.template_applied === false) {
          setShowTemplateModal(true);
        }
      }
    };
    fetchUserData();
  }, []);

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
      const { count: automationsCount, error: automationsError } = await supabase
        .from("automations")
        .select("id", { count: 'exact' })
        .eq("user_id", userId)
        .limit(1);
        
      if (automationsError) console.error("Error fetching automations count:", automationsError);
      else console.log("Fetched automations count:", automationsCount);
      
      setStats({
        contacts: contactsCount || 0,
        messages: messagesCount || 0,
        scheduled: scheduledCount || 0,
        automations: automationsCount || 0
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
        setPairingCode(null);
        if (manual) toast.success("Conectado com sucesso!");
        
        // Fetch 'me' info if connected
        try {
          const meData = await apiFetch(`/api/whatsapp/me`);
          if (meData.me) setMe(meData.me);
        } catch (e) {}
      } else if (data.status === "qr" || data.status === "pairing") {
        connectingSince.current = null;
        
        // Check how long it's been showing QR/Pairing
        if (!qrSince.current) {
          qrSince.current = Date.now();
        } else if (Date.now() - qrSince.current > 30000) { // 30 seconds timeout
          console.log("[WhatsApp] QR/Pairing timeout reached, resetting...");
          qrSince.current = null;
          await resetSession();
          setStatus("disconnected");
          setQr(null);
          setPairingCode(null);
          toast.error("O código expirou. Tente novamente.");
          return;
        }

        // Fetch QR/Pairing code specifically FIRST to avoid UI flicker
        const qrData = await apiFetch(`/api/whatsapp/qr`);
        
        if (qrData.qr) {
          setQr(qrData.qr);
          setPairingCode(null);
          setStatus(data.status);
        } else if (qrData.pairingCode) {
          setPairingCode(qrData.pairingCode);
          setQr(null);
          setStatus(data.status);
        } else if (qrData.status === "connecting") {
          // Just wait if it's still connecting
          setStatus("connecting");
          setQr(null);
          setPairingCode(null);
        } else if (!qrData.qr && !qrData.pairingCode && data.status !== "connecting") {
          // Only reconnect if we are supposed to have a code but don't, and we aren't already connecting
          if (manual) {
            toast.info("Gerando novo código...");
            await connect();
          }
        }
        if (manual) toast.info(data.status === "qr" ? "Aguardando leitura do QR Code." : "Aguardando pareamento.");
      } else if (data.status === "connecting") {
        qrSince.current = null;
        // Check how long it's been connecting
        if (!connectingSince.current) {
          connectingSince.current = Date.now();
        } else if (Date.now() - connectingSince.current > 30000) { // 30 seconds timeout
          console.log("[WhatsApp] Connecting timeout reached, resetting...");
          connectingSince.current = null;
          await resetSession();
          setStatus("disconnected");
          setQr(null);
          setPairingCode(null);
          toast.error("A conexão demorou muito. Tente novamente.");
          return;
        }
        // Just wait if it's still connecting
        setStatus("connecting");
        setQr(null);
        setPairingCode(null);
      } else {
        connectingSince.current = null;
        qrSince.current = null;
        setStatus(data.status || "disconnected");
        setQr(null);
        setPairingCode(null);
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
        body: JSON.stringify({ phoneNumber: connectMethod === "number" ? phoneNumber : undefined })
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
      setPairingCode(null);
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
          .limit(5);
        
        if (msgError) console.error("Error fetching messages:", msgError);
        else console.log("Fetched messages:", initialMessages?.length);
        
        if (initialMessages) {
          setRecentMessages(initialMessages);
        }
        
        // Real-time subscription for messages
        const messagesSubscription = supabase
          .channel('public:messages')
          .on('postgres_changes', { 
            event: '*', 
            schema: 'public', 
            table: 'messages',
            filter: `user_id=eq.${uId}`
          }, async () => {
            // Re-fetch top 5 when changes occur
            const { data: updatedMessages } = await supabase
              .from("messages")
              .select("*")
              .eq("user_id", uId)
              .order("timestamp", { ascending: false })
              .limit(5);
            if (updatedMessages) setRecentMessages(updatedMessages);
          })
          .subscribe();
        
        return () => {
          supabase.removeChannel(messagesSubscription);
        };
      }
      return () => {};
    };

    const cleanupPromise = init();

    const interval = setInterval(async () => {
      const uId = await getUserId();
      if (uId && uId !== "guest-user") {
        await checkStatus(uId);
        await fetchStats(uId);
      }
    }, 5000);

    return () => {
      clearInterval(interval);
      cleanupPromise.then(cleanup => cleanup && cleanup());
    };
  }, [activationLoading, isActivated]);

  const statsConfig = [
    { name: "Total Contatos", value: stats.contacts.toString(), icon: Users, color: "text-blue-500", bg: "bg-blue-500/10" },
    { name: "Mensagens Enviadas", value: stats.messages.toString(), icon: MessageSquare, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { name: "Agendamentos", value: stats.scheduled.toString(), icon: Clock, color: "text-amber-500", bg: "bg-amber-500/10" },
    { name: "Automações Ativas", value: stats.automations.toString(), icon: Zap, color: "text-purple-500", bg: "bg-purple-500/10" },
  ];

  if (activationLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent"></div>
      </div>
    );
  }

  const isFree = plan === "Free";

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Welcome Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white/60 dark:bg-slate-900/60 backdrop-blur-md p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-slate-800/50 shadow-sm relative overflow-hidden group">
        <div className="absolute -right-20 -top-20 w-64 h-64 bg-emerald-500/5 blur-3xl rounded-full group-hover:scale-125 transition-transform duration-700" />
        <div className="relative z-10">
          <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter">Olá, {userName}! 👋</h2>
          <p className="text-slate-500 dark:text-slate-400 font-medium">Bem-vindo de volta ao seu centro de automação inteligente.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 relative z-10">
          <Button 
            variant="outline" 
            className="rounded-2xl h-12 px-6 font-bold"
            onClick={() => checkStatus(userId || "", true)}
          >
            <RefreshCw size={18} className={cn("mr-2", isCheckingStatus.current && "animate-spin")} />
            Atualizar Status
          </Button>
          <Button 
            variant="glow"
            className="rounded-2xl h-12 px-6 font-bold"
            onClick={() => navigate("/automations")}
          >
            <Zap size={18} className="mr-2" />
            Nova Automação
          </Button>
        </div>
      </div>

      {/* Plan Info Banner */}
      <div className={cn(
        "p-8 rounded-[2.5rem] flex flex-col sm:flex-row items-start sm:items-center justify-between border relative overflow-hidden group transition-all duration-700 backdrop-blur-md",
        isFree 
          ? "bg-white/60 dark:bg-slate-900/60 border-slate-200/50 dark:border-slate-800/50 shadow-sm" 
          : (plan === "Premium" || plan === "Admin" 
            ? "bg-amber-500/10 dark:bg-amber-500/5 border-amber-500/20 shadow-xl shadow-amber-500/5" 
            : "bg-emerald-500/10 dark:bg-emerald-500/5 border-emerald-500/20 shadow-xl shadow-emerald-500/5")
      )}>
        <div className="absolute -right-20 -top-20 w-64 h-64 bg-emerald-500/5 blur-3xl rounded-full group-hover:scale-125 transition-transform duration-700" />
        
        <div className="flex items-center gap-6 relative z-10">
          <div className={cn(
            "h-16 w-16 rounded-2xl flex items-center justify-center shrink-0 shadow-2xl transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3",
            isFree 
              ? "bg-slate-100 dark:bg-slate-800 text-slate-400" 
              : (plan === "Premium" || plan === "Admin" 
                ? "bg-gradient-to-br from-amber-400 to-amber-600 text-white" 
                : "bg-gradient-to-br from-emerald-400 to-emerald-600 text-white")
          )}>
            <Zap size={32} className={cn(!isFree && "animate-glow-pulse")} />
          </div>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tighter">
                {isFree ? "Plano Gratuito" : `Plano ${plan}`}
              </h3>
              {!isFree && (
                <Badge variant="success" pulse className="text-[10px] font-black uppercase tracking-widest px-3 py-0.5">Ativo</Badge>
              )}
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 font-medium max-w-lg leading-relaxed">
              {isFree ? (
                "Você está usando a versão limitada. Faça upgrade para escalar seu negócio."
              ) : planDetails ? (
                <>
                  <span className="text-emerald-500 dark:text-emerald-400 font-black">{planDetails.max_messages_per_day}</span> mensagens/dia • 
                  <span className="text-emerald-600 dark:text-emerald-400 font-black ml-1">{planDetails.max_contacts}</span> contatos • 
                  <span className="text-emerald-600 dark:text-emerald-400 font-black ml-1">{planDetails.max_connections}</span> conexão(ões)
                </>
              ) : (
                "Sua conta premium está configurada e pronta para automação em massa."
              )}
            </p>
          </div>
        </div>
        {(isFree || (plan !== "Premium" && plan !== "Admin")) && (
          <Button 
            variant="glow"
            className="mt-6 sm:mt-0 rounded-2xl h-14 px-8 font-black text-sm uppercase tracking-widest relative z-10"
            onClick={() => navigate("/activate")}
          >
            Fazer Upgrade Agora
          </Button>
        )}
      </div>

      {/* Bento Grid Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {statsConfig.map((stat, index) => (
          <Card 
            key={stat.name} 
            className="group p-8 rounded-[2.5rem] border-slate-200/50 dark:border-slate-800/50 hover:border-emerald-500/30 transition-all duration-500 relative overflow-hidden shimmer"
            style={{ animationDelay: `${index * 100}ms` }}
          >
            <div className="absolute -right-4 -bottom-4 opacity-[0.03] group-hover:opacity-[0.07] transition-opacity dark:text-white">
              <stat.icon size={100} />
            </div>
            <div className={cn("h-14 w-14 rounded-2xl flex items-center justify-center mb-6 transition-all duration-300 group-hover:scale-110 group-hover:rotate-6 shadow-lg shadow-black/5", stat.bg, stat.color)}>
              <stat.icon size={28} />
            </div>
            <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] mb-1">{stat.name}</p>
            <div className="flex items-baseline gap-2">
              <p className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter">{stat.value}</p>
              <Badge variant="success" className="text-[10px] px-2 py-0 h-5">+12%</Badge>
            </div>
          </Card>
        ))}
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        {/* Connection Card */}
        <div className="xl:col-span-4 space-y-8">
          <Card glow className="p-8 rounded-[2.5rem] border-slate-200/50 dark:border-slate-800/50 relative overflow-hidden group h-full flex flex-col">
            <div className="flex items-center justify-between mb-10">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 shadow-inner">
                  <QrCode size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tighter">WhatsApp</h3>
                  <p className="text-[9px] text-slate-400 uppercase tracking-[0.2em] font-black">Instância Ativa</p>
                </div>
              </div>
              <ConnectionStatusBadge status={status} />
            </div>

            <div className="flex-1 flex flex-col items-center justify-center min-h-[350px]">
              {error && (
                <div className="w-full mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/50 rounded-2xl flex items-start gap-3 text-red-600 dark:text-red-400 animate-in fade-in zoom-in duration-300">
                  <AlertCircle size={20} className="shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-xs font-bold uppercase tracking-wider">Erro de Conexão</p>
                    <p className="text-[11px] opacity-80 leading-relaxed mt-1">{error}</p>
                  </div>
                  <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 transition-colors">
                    <Trash2 size={16} />
                  </button>
                </div>
              )}

              {status === "connected" ? (
                <div className="text-center space-y-6 w-full animate-in fade-in zoom-in duration-500">
                  <div className="relative mx-auto w-24 h-24">
                    <div className="absolute inset-0 bg-emerald-500/20 blur-3xl rounded-full animate-glow-pulse" />
                    <div className="relative h-24 w-24 bg-emerald-500/10 rounded-3xl flex items-center justify-center text-emerald-500 border border-emerald-500/20 mx-auto shadow-xl">
                      <CheckCircle2 size={56} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xl font-black text-slate-900 dark:text-white tracking-tighter">Conectado e Ativo</p>
                    <div className="flex items-center justify-center gap-2 bg-slate-100/50 dark:bg-slate-800/50 py-2 px-4 rounded-xl border border-slate-200/50 dark:border-slate-700/50 w-fit mx-auto">
                      <Phone size={14} className="text-emerald-500" />
                      <span className="text-sm font-mono font-bold text-slate-600 dark:text-slate-300">
                        {me?.id ? me.id.split(':')[0] : "Número Ativo"}
                      </span>
                      {me?.id && (
                        <button 
                          onClick={() => {
                            navigator.clipboard.writeText(me.id.split(':')[0]);
                            toast.success("Número copiado!");
                          }}
                          className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-slate-400 transition-colors"
                        >
                          <Copy size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-3 pt-4">
                    <Button 
                      variant="outline" 
                      className="w-full py-6 rounded-2xl font-bold" 
                      onClick={pauseSession} 
                      disabled={loading}
                    >
                      <Pause size={20} className="mr-2" />
                      Pausar Automação
                    </Button>
                    <Button 
                      variant="ghost" 
                      className="w-full text-red-500 hover:text-red-600 hover:bg-red-500/10 rounded-2xl font-bold" 
                      onClick={resetSession} 
                      disabled={loading}
                    >
                      <Trash2 size={18} className="mr-2" />
                      Desconectar Conta
                    </Button>
                  </div>
                </div>
              ) : status === "qr" && qr ? (
                <div className="text-center space-y-8 w-full animate-in fade-in zoom-in duration-500">
                  <div className="p-6 bg-white dark:bg-white rounded-[2.5rem] shadow-2xl shadow-emerald-500/10 mx-auto w-fit relative group border border-slate-100 dark:border-slate-800">
                    <div className="absolute inset-0 bg-emerald-500/5 blur-xl rounded-full group-hover:scale-110 transition-transform" />
                    <div className="relative bg-white p-2 rounded-xl z-10">
                      <QRCodeSVG value={qr} size={200} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xl font-black text-slate-900 dark:text-white tracking-tighter">Escaneie o QR Code</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed max-w-[240px] mx-auto">
                      Abra o WhatsApp {">"} Aparelhos Conectados<br />e aponte sua câmera para cá.
                    </p>
                  </div>
                  <div className="flex flex-col gap-3 pt-2">
                    <Button 
                      variant="outline" 
                      className="w-full py-6 rounded-2xl font-bold" 
                      onClick={() => userId && checkStatus(userId, true)}
                    >
                      <RefreshCw size={18} className="mr-2" />
                      Atualizar QR Code
                    </Button>
                    <Button 
                      variant="ghost" 
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-xs font-bold" 
                      onClick={resetSession}
                    >
                      Cancelar e tentar novamente
                    </Button>
                  </div>
                </div>
              ) : status === "pairing" && pairingCode ? (
                <div className="text-center space-y-8 w-full animate-in fade-in zoom-in duration-500">
                  <div className="space-y-4">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Código de Pareamento</p>
                    <div className="flex justify-center gap-2 sm:gap-3">
                      {pairingCode.split('').map((char, i) => (
                        <div key={i} className="w-10 h-14 sm:w-12 sm:h-16 bg-slate-100/50 dark:bg-slate-800/50 border-2 border-slate-200 dark:border-slate-700 rounded-2xl flex items-center justify-center text-xl sm:text-2xl font-black text-emerald-500 shadow-inner">
                          {char}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="p-6 bg-emerald-500/5 dark:bg-emerald-500/10 rounded-3xl border border-emerald-500/20 text-left space-y-4">
                    <div className="flex items-center gap-2 text-emerald-500">
                      <Activity size={16} />
                      <p className="text-[10px] font-black uppercase tracking-widest">Passo a Passo</p>
                    </div>
                    <ol className="text-xs text-slate-600 dark:text-slate-400 space-y-3 list-decimal list-inside leading-relaxed font-medium">
                      <li>Abra o <span className="text-slate-900 dark:text-white font-black">WhatsApp</span> no seu celular</li>
                      <li>Vá em <span className="text-slate-900 dark:text-white font-black">Aparelhos Conectados</span></li>
                      <li>Toque em <span className="text-slate-900 dark:text-white font-black">Conectar um aparelho</span></li>
                      <li>Escolha <span className="text-slate-900 dark:text-white font-black">Conectar com número</span></li>
                      <li>Digite o código acima no seu celular</li>
                    </ol>
                  </div>
                  <div className="flex flex-col gap-3">
                    <Button 
                      variant="outline" 
                      className="w-full py-6 rounded-2xl font-bold" 
                      onClick={() => userId && checkStatus(userId)}
                    >
                      <RefreshCw size={18} className="mr-2" />
                      Verificar Conexão
                    </Button>
                    <Button 
                      variant="ghost" 
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-xs font-bold" 
                      onClick={resetSession}
                    >
                      Voltar e tentar novamente
                    </Button>
                  </div>
                </div>
              ) : status === "paused" ? (
                <div className="text-center space-y-6 w-full animate-in fade-in zoom-in duration-500">
                  <div className="h-24 w-24 bg-amber-50 dark:bg-amber-900/20 rounded-3xl flex items-center justify-center text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-900/50 mx-auto">
                    <Pause size={56} />
                  </div>
                  <div className="space-y-2">
                    <p className="text-xl font-bold text-slate-900 dark:text-white">Conexão Pausada</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Seu bot está temporariamente offline.</p>
                  </div>
                  <div className="flex flex-col gap-3 pt-4">
                    <Button 
                      className="w-full py-6 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20" 
                      onClick={connect} 
                      disabled={loading}
                    >
                      <Zap size={20} className="mr-2" />
                      Retomar Automação
                    </Button>
                    <Button 
                      variant="ghost" 
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-2xl" 
                      onClick={resetSession} 
                      disabled={loading}
                    >
                      <Trash2 size={18} className="mr-2" />
                      Desconectar Conta
                    </Button>
                  </div>
                </div>
              ) : (status === "connecting" || loading || status === null) ? (
                <div className="text-center space-y-6 py-12 w-full">
                  <div className="relative mx-auto w-24 h-24">
                    <div className="absolute inset-0 bg-emerald-500/5 blur-3xl rounded-full animate-pulse" />
                    <div className="relative h-24 w-24 bg-white dark:bg-slate-900 rounded-3xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 border border-slate-100 dark:border-slate-800 shadow-sm">
                      <RefreshCw size={48} className="animate-spin" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xl font-bold text-slate-900 dark:text-white">
                      {connectMethod === "qr" ? "Gerando QR Code..." : "Gerando Código..."}
                    </p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Preparando ambiente seguro...</p>
                  </div>
                </div>
              ) : (
                <div className="text-center space-y-8 py-4 w-full animate-in fade-in slide-in-from-top-4 duration-500">
                  <div className="flex p-1.5 bg-slate-100 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
                    <button 
                      className={cn(
                        "flex-1 py-3 text-xs font-bold rounded-xl transition-all duration-300",
                        connectMethod === "number" ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      )}
                      onClick={() => setConnectMethod("number")}
                    >
                      Parear por Número
                    </button>
                    <button 
                      className={cn(
                        "flex-1 py-3 text-xs font-bold rounded-xl transition-all duration-300",
                        connectMethod === "qr" ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      )}
                      onClick={() => setConnectMethod("qr")}
                    >
                      Parear por QR Code
                    </button>
                  </div>

                  {connectMethod === "number" ? (
                    <div className="space-y-6 text-left animate-in fade-in slide-in-from-left-4 duration-500">
                      <div className="space-y-3">
                        <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest ml-1">Seu Número WhatsApp</label>
                        <div className="relative group">
                          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                            <Phone size={18} className="text-slate-400 group-focus-within:text-emerald-600 transition-colors" />
                          </div>
                          <Input 
                            placeholder="Ex: 5511999999999" 
                            className="pl-12 py-7 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 rounded-2xl focus:ring-emerald-500/20 focus:border-emerald-500 text-lg font-medium dark:text-white"
                            value={phoneNumber}
                            onChange={e => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                          />
                        </div>
                        <p className="text-[11px] text-slate-400 italic ml-1 flex items-center gap-1.5">
                          <AlertCircle size={12} />
                          Inclua DDI + DDD (apenas números).
                        </p>
                      </div>
                      <Button 
                        className="w-full py-7 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-lg shadow-lg shadow-emerald-600/20 transition-all hover:scale-[1.02] active:scale-[0.98]" 
                        onClick={connect} 
                        disabled={loading || !phoneNumber}
                      >
                        <Key size={20} className="mr-2" />
                        Gerar Código Agora
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
                      <div className="h-24 w-24 bg-slate-100 dark:bg-slate-800 rounded-3xl flex items-center justify-center text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 mx-auto">
                        <QrCode size={56} />
                      </div>
                      <div className="space-y-2">
                        <p className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Conexão Instantânea</p>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Escaneie o código com seu celular para conectar em segundos.</p>
                      </div>
                      <Button 
                        className="w-full py-7 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-lg shadow-lg shadow-emerald-600/20 transition-all hover:scale-[1.02] active:scale-[0.98]" 
                        onClick={connect} 
                        disabled={loading}
                      >
                        <Zap size={20} className="mr-2" />
                        Gerar QR Code
                      </Button>
                    </div>
                  )}

                  <div className="pt-6 border-t border-slate-100 dark:border-slate-800">
                    <Button 
                      variant="ghost" 
                      className="w-full text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 rounded-xl text-xs py-4"
                      onClick={() => userId && checkStatus(userId, true)}
                    >
                      <RefreshCw size={14} className="mr-2" />
                      Já escaneou? Verificar conexão manual
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Messages and Activity Bento Grid */}
        <div className="xl:col-span-8 grid grid-cols-1 gap-8">
          {/* Recent Messages / Monitor */}
          <Card className="p-8 rounded-[2.5rem] border-slate-200/50 dark:border-slate-800/50 relative overflow-hidden group flex flex-col h-full">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-500 shadow-inner">
                  <Terminal size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tighter">Monitor em Tempo Real</h3>
                  <p className="text-[9px] text-slate-400 uppercase tracking-[0.2em] font-black">Logs do Sistema</p>
                </div>
              </div>
              <div className="flex items-center gap-2 px-4 py-1.5 bg-emerald-500/10 rounded-full border border-emerald-500/20">
                <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse-soft" />
                <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">Live Feed</span>
              </div>
            </div>
            
            <div className="flex-1 bg-slate-950 rounded-3xl p-8 font-mono text-xs min-h-[350px] overflow-y-auto space-y-4 border border-slate-800 shadow-inner custom-scrollbar relative">
              {recentMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-600 space-y-6">
                  <div className="p-6 bg-slate-900 rounded-full border border-slate-800 shadow-sm">
                    <MessageSquare size={48} className="opacity-20" />
                  </div>
                  <p className="italic font-medium">Aguardando novas mensagens...</p>
                </div>
              ) : (
                recentMessages.map((msg, i) => (
                  <div 
                    key={msg.id} 
                    className="text-slate-400 border-l-2 border-emerald-500/30 pl-6 py-2 hover:bg-white/5 rounded-r-xl transition-all animate-in fade-in slide-in-from-left-2 duration-300 group/msg"
                    style={{ animationDelay: `${i * 50}ms` }}
                  >
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-slate-500 font-black bg-slate-900 px-2 py-0.5 rounded text-[9px] border border-slate-800">
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </span> 
                      <span className={cn(
                        "text-[9px] font-black uppercase tracking-widest",
                        msg.type === 'outbound' ? 'text-blue-500' : 'text-emerald-500'
                      )}>
                        {msg.type === 'outbound' ? 'Enviada' : 'Recebida'}
                      </span>
                    </div>
                    <span className="text-sm leading-relaxed block group-hover/msg:translate-x-1 transition-transform text-slate-300">{msg.text}</span>
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Quick Actions / Activity */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="p-10 rounded-[3rem] bg-gradient-to-br from-blue-600 to-indigo-700 text-white group hover:scale-[1.02] transition-all duration-500 cursor-pointer shadow-2xl shadow-blue-500/20 relative overflow-hidden" onClick={() => navigate("/automations")}>
              <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/10 blur-3xl rounded-full group-hover:scale-150 transition-transform duration-700" />
              <div className="h-14 w-14 rounded-2xl bg-white/20 backdrop-blur-md text-white flex items-center justify-center mb-8 shadow-lg group-hover:rotate-12 transition-transform">
                <Zap size={28} />
              </div>
              <h4 className="text-2xl font-black mb-3 tracking-tighter">Automações Inteligentes</h4>
              <p className="text-blue-50 text-sm leading-relaxed opacity-80 font-medium">Configure respostas automáticas baseadas em palavras-chave e IA de última geração.</p>
              <div className="mt-8 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest bg-white/20 w-fit px-5 py-2.5 rounded-full backdrop-blur-md hover:bg-white/30 transition-colors">
                Configurar Agora <ChevronRight size={16} />
              </div>
            </div>

            <div className="p-10 rounded-[3rem] bg-gradient-to-br from-emerald-600 to-teal-700 text-white group hover:scale-[1.02] transition-all duration-500 cursor-pointer shadow-2xl shadow-emerald-500/20 relative overflow-hidden" onClick={() => navigate("/schedule")}>
              <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/10 blur-3xl rounded-full group-hover:scale-150 transition-transform duration-700" />
              <div className="h-14 w-14 rounded-2xl bg-white/20 backdrop-blur-md text-white flex items-center justify-center mb-8 shadow-lg group-hover:rotate-12 transition-transform">
                <Clock size={28} />
              </div>
              <h4 className="text-2xl font-black mb-3 tracking-tighter">Agendamentos em Massa</h4>
              <p className="text-emerald-50 text-sm leading-relaxed opacity-80 font-medium">Programe campanhas inteiras para serem enviadas no momento exato do seu público.</p>
              <div className="mt-8 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest bg-white/20 w-fit px-5 py-2.5 rounded-full backdrop-blur-md hover:bg-white/30 transition-colors">
                Agendar Mensagem <ChevronRight size={16} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
