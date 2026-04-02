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
  Copy,
  ExternalLink,
  Pause
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
          .select("*, contacts(name, phone)")
          .eq("user_id", uId)
          .order("timestamp", { ascending: false })
          .limit(10);
        
        if (msgError) console.error("Error fetching messages:", msgError);
        else console.log("Fetched messages:", initialMessages?.length);
        
        if (initialMessages) {
          // Filter to show unique contacts (active chats)
          const uniqueChats: any[] = [];
          const seenContacts = new Set();
          
          for (const msg of initialMessages) {
            if (!seenContacts.has(msg.contact_id)) {
              seenContacts.add(msg.contact_id);
              uniqueChats.push(msg);
            }
            if (uniqueChats.length >= 5) break;
          }
          
          setRecentMessages(uniqueChats);
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
            // Re-fetch top 10 when changes occur
            const { data: updatedMessages } = await supabase
              .from("messages")
              .select("*, contacts(name, phone)")
              .eq("user_id", uId)
              .order("timestamp", { ascending: false })
              .limit(10);
            
            if (updatedMessages) {
              const uniqueChats: any[] = [];
              const seenContacts = new Set();
              
              for (const msg of updatedMessages) {
                if (!seenContacts.has(msg.contact_id)) {
                  seenContacts.add(msg.contact_id);
                  uniqueChats.push(msg);
                }
                if (uniqueChats.length >= 5) break;
              }
              setRecentMessages(uniqueChats);
            }
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
    <div className="p-6 lg:p-10 space-y-8 max-w-7xl mx-auto">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-3xl font-bold text-slate-900 tracking-tight">
            Bem-vindo, <span className="text-emerald-600">{userName}</span>
          </h2>
          <p className="text-slate-500 font-medium">
            Monitore suas conexões e mensagens em tempo real.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ConnectionStatusBadge status={status} />
          <Button 
            onClick={() => checkStatus(userId!, true)} 
            variant="outline"
            className="rounded-xl border-slate-200 font-medium text-sm h-10"
          >
            <RefreshCw size={16} className={cn("mr-2", loading && "animate-spin")} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsConfig.map((stat, i) => (
          <Card key={i} className="border-slate-100 shadow-sm hover:shadow-md transition-all group">
            <div className="p-6 flex items-center gap-4">
              <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center shrink-0", stat.bg, stat.color)}>
                <stat.icon size={24} />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">{stat.name}</p>
                <p className="text-2xl font-bold text-slate-900">{stat.value}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Connection Status Card */}
        <div className="lg:col-span-5 xl:col-span-4">
          <Card className="border-slate-100 shadow-sm h-full flex flex-col">
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
                          {/* Method Selector */}
                          <div className="flex p-1 bg-slate-50 rounded-xl border border-slate-100">
                            <button 
                              className={cn("flex-1 py-2 text-xs font-bold rounded-lg transition-all", connectMethod === "number" ? "bg-white text-slate-900 shadow-sm" : "text-slate-400")}
                              onClick={() => setConnectMethod("number")}
                            >
                              Número
                            </button>
                            <button 
                              className={cn("flex-1 py-2 text-xs font-bold rounded-lg transition-all", connectMethod === "qr" ? "bg-white text-slate-900 shadow-sm" : "text-slate-400")}
                              onClick={() => setConnectMethod("qr")}
                            >
                              QR Code
                            </button>
                          </div>

                          {/* Content Area */}
                          <div className="relative min-h-[200px] flex flex-col items-center justify-center">
                            {loading || status === "connecting" ? (
                              <div className="flex flex-col items-center gap-3">
                                <div className="h-12 w-12 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Iniciando...</p>
                              </div>
                            ) : qr && connectMethod === "qr" ? (
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
                            ) : pairingCode && connectMethod === "number" ? (
                              <motion.div 
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="space-y-6 w-full"
                              >
                                <div className="p-6 bg-emerald-50 rounded-2xl border border-emerald-100 shadow-sm">
                                  <p className="text-[10px] font-black text-emerald-600 mb-4 uppercase tracking-[0.2em]">Código de Pareamento</p>
                                  <div className="flex justify-center gap-2">
                                    {pairingCode.split('').map((char, i) => (
                                      <div key={i} className="w-9 h-12 bg-white border border-emerald-200 rounded-xl flex items-center justify-center text-xl font-black text-emerald-600 shadow-sm">
                                        {char}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <div className="space-y-1">
                                  <p className="text-sm font-bold text-slate-900">Digite no seu WhatsApp</p>
                                  <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest">Aparelhos Conectados {">"} Conectar com número</p>
                                </div>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="text-[10px] font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest"
                                  onClick={() => {
                                    setPairingCode(null);
                                    setStatus("disconnected");
                                  }}
                                >
                                  Tentar outro número
                                </Button>
                              </motion.div>
                            ) : connectMethod === "number" ? (
                              <div className="w-full space-y-4">
                                <div className="space-y-2 text-left">
                                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Número com DDI</label>
                                  <div className="relative">
                                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                                    <Input 
                                      placeholder="Ex: 258840000000" 
                                      className="h-14 px-12 bg-white border-slate-200 rounded-2xl focus:ring-emerald-500/20 text-base font-bold tracking-tight"
                                      value={phoneNumber}
                                      onChange={e => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                                    />
                                  </div>
                                </div>
                                <Button 
                                  className="w-full h-14 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest shadow-lg shadow-emerald-500/20 transition-all"
                                  onClick={connect}
                                  disabled={loading || !phoneNumber}
                                >
                                  {loading ? <RefreshCw className="animate-spin" /> : "GERAR CÓDIGO"}
                                </Button>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center gap-6 py-4">
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
        <div className="lg:col-span-7 xl:col-span-8">
          <Card className="border-slate-100 shadow-sm overflow-hidden h-full flex flex-col">
            <CardHeader className="p-6 border-b border-slate-50 flex flex-row items-center justify-between">
              <CardTitle className="text-lg font-bold text-slate-900">Monitor em Tempo Real</CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Live</span>
                <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              </div>
            </CardHeader>
            <CardContent className="p-0 flex-1">
              <div className="h-[400px] overflow-y-auto custom-scrollbar">
                {recentMessages.length > 0 ? (
                  <div className="divide-y divide-slate-50">
                    {recentMessages.map((msg, i) => (
                      <div key={i} className="p-4 hover:bg-slate-50/50 transition-colors">
                        <div className="flex items-start gap-3">
                          <div className={cn(
                            "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
                            msg.type === "outbound" ? "bg-emerald-50 text-emerald-600" : "bg-blue-50 text-blue-600"
                          )}>
                            {msg.type === "outbound" ? <Zap size={14} /> : <MessageSquare size={14} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-[10px] font-bold text-slate-400 uppercase">
                                {msg.type === "outbound" ? "Enviada" : "Recebida"}
                              </span>
                              <span className="text-[10px] text-slate-300">
                                {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <p className="text-sm font-bold text-slate-900 truncate">
                              {msg.contacts?.name || msg.to || msg.from || "Desconhecido"}
                            </p>
                            <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">{msg.text}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center p-8 text-center">
                    <Terminal size={32} className="text-slate-200 mb-3" />
                    <p className="text-sm font-bold text-slate-400">Aguardando atividade...</p>
                    <p className="text-xs text-slate-300 mt-1">Mensagens aparecerão aqui em tempo real</p>
                  </div>
                )}
              </div>
            </CardContent>
            <div className="p-4 bg-slate-50/50 border-t border-slate-50">
              <Button 
                variant="ghost" 
                className="w-full h-9 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-900"
                onClick={() => navigate("/messages")}
              >
                Ver Histórico Completo
                <ChevronRight size={14} className="ml-1" />
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
