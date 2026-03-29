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
import { TemplateModal } from "../components/TemplateModal";

const ConnectionStatusBadge = ({ status }: { status: string | null }) => {
  let label = "Desconectado";
  let bgColor = "bg-red-100";
  let textColor = "text-red-700";
  let dotColor = "bg-red-500";

  if (status === "connected") {
    label = "Conectado";
    bgColor = "bg-green-100";
    textColor = "text-green-700";
    dotColor = "bg-green-500";
  } else if (status === "connecting" || status === "qr") {
    label = "Conectando";
    bgColor = "bg-yellow-100";
    textColor = "text-yellow-700";
    dotColor = "bg-yellow-500";
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${bgColor} ${textColor}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      {label}
    </span>
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
  const [logs, setLogs] = useState<any[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkUserTemplate = async () => {
      const user = await getUser();
      // Only show modal if user exists and template hasn't been applied
      if (user && user.template_applied === false) {
        setShowTemplateModal(true);
      }
    };
    checkUserTemplate();
  }, []);

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
      const data = await apiFetch(`/api/whatsapp/status/${uId}`);
      
      if (data.status === "connected") {
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
        setStatus(data.status);
        
        // Fetch QR/Pairing code specifically
        const qrData = await apiFetch(`/api/whatsapp/qr/${uId}`);
        if (qrData.qr) {
          setQr(qrData.qr);
          setPairingCode(null);
        } else if (qrData.pairingCode) {
          setPairingCode(qrData.pairingCode);
          setQr(null);
        } else if (qrData.status === "connecting" || !qrData.qr) {
          // If in QR/Pairing state but no code, try to reconnect
          if (manual) toast.info("Gerando novo código...");
          await connect();
        }
        if (manual) toast.info(data.status === "qr" ? "Aguardando leitura do QR Code." : "Aguardando pareamento.");
      } else {
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
      const data = await apiFetch(`/api/whatsapp/connect/${userId}`, {
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
      await apiFetch(`/api/whatsapp/reset/${userId}`, {
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
      await apiFetch(`/api/whatsapp/pause/${userId}`, {
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
    if (autoScroll) {
      logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  const clearLogs = async () => {
    try {
      const userId = await getUserId();
      const { error } = await supabase.from("logs").delete().eq("user_id", userId);
      if (error) throw error;
      setLogs([]);
      toast.success("Logs limpos!");
    } catch (err) {
      toast.error("Erro ao limpar logs.");
    }
  };

  const testBot = async () => {
    setLoading(true);
    try {
      if (!me?.id) throw new Error("WhatsApp não conectado");
      
      await apiFetch(`/api/whatsapp/send/${userId}`, {
        method: "POST",
        body: JSON.stringify({ 
          jid: me.id, 
          text: "🤖 Teste do WhatsCRM: Bot funcionando corretamente!" 
        }),
      });
      
      toast.success("Mensagem de teste enviada para você mesmo!");
    } catch (err: any) {
      setError(err.message);
      toast.error(err.message);
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
        
        console.log("Fetching messages and logs for:", uId);
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

        // Initial fetch for logs
        const { data: initialLogs, error: logError } = await supabase
          .from("logs")
          .select("*")
          .eq("user_id", uId)
          .order("created_at", { ascending: false })
          .limit(10);
        
        if (logError) console.error("Error fetching logs:", logError);
        else console.log("Fetched logs:", initialLogs?.length);
        
        if (initialLogs) {
          setLogs(initialLogs);
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

        // Real-time subscription for logs
        const logsSubscription = supabase
          .channel('public:logs')
          .on('postgres_changes', { 
            event: '*', 
            schema: 'public', 
            table: 'logs',
            filter: `user_id=eq.${uId}`
          }, async () => {
            // Re-fetch top 10 when changes occur
            const { data: updatedLogs } = await supabase
              .from("logs")
              .select("*")
              .eq("user_id", uId)
              .order("created_at", { ascending: false })
              .limit(10);
            if (updatedLogs) setLogs(updatedLogs);
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
    { name: "Total Contatos", value: stats.contacts.toString(), icon: Users, color: "text-blue-600", bg: "bg-blue-50" },
    { name: "Mensagens Enviadas", value: stats.messages.toString(), icon: MessageSquare, color: "text-emerald-600", bg: "bg-emerald-50" },
    { name: "Agendamentos", value: stats.scheduled.toString(), icon: Clock, color: "text-amber-600", bg: "bg-amber-50" },
    { name: "Automações Ativas", value: stats.automations.toString(), icon: Zap, color: "text-purple-600", bg: "bg-purple-50" },
  ];

  if (activationLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent"></div>
      </div>
    );
  }

  if (!isActivated) {
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="py-12 text-center space-y-4">
            <Zap size={48} className="mx-auto text-amber-400" />
            <h3 className="text-xl font-bold text-amber-900">Conta não Ativada</h3>
            <p className="text-amber-700 max-w-md mx-auto">
              Você precisa ativar sua conta com um código de licença para usar o Dashboard.
            </p>
            <Button onClick={() => navigate("/activate")} className="bg-amber-600 hover:bg-amber-700">
              Ativar Agora
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Plan Info Banner */}
      {isActivated && (
        <div className={cn(
          "p-4 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between border gap-4",
          plan === "Premium" || plan === "Admin" ? "bg-amber-50 border-amber-100" : "bg-emerald-50 border-emerald-100"
        )}>
          <div className="flex items-center gap-3">
            <div className={cn(
              "h-10 w-10 rounded-xl flex items-center justify-center shrink-0",
              plan === "Premium" || plan === "Admin" ? "bg-amber-100 text-amber-600" : "bg-emerald-100 text-emerald-600"
            )}>
              <Zap size={20} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">Plano Atual: {plan}</p>
              <p className="text-xs text-slate-500">
                {planDetails ? (
                  <>
                    Limites: {planDetails.max_messages_per_day} msgs/dia • {planDetails.max_contacts} contatos • {planDetails.max_connections} conexão(ões)
                  </>
                ) : (
                  "Sua conta está ativa e pronta para uso."
                )}
              </p>
            </div>
          </div>
          {plan !== "Premium" && plan !== "Admin" && (
            <Button 
              size="sm" 
              variant="outline" 
              className="border-amber-200 text-amber-700 hover:bg-amber-100 shrink-0"
              onClick={() => navigate("/activate")}
            >
              Fazer Upgrade
            </Button>
          )}
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
        {statsConfig.map((stat) => (
          <Card key={stat.name} className="overflow-hidden">
            <CardContent className="p-3 sm:p-6 flex flex-col sm:flex-row items-center sm:items-start gap-2 sm:gap-4 text-center sm:text-left">
              <div className={cn("p-2 sm:p-3 rounded-lg sm:rounded-xl shrink-0", stat.bg, stat.color)}>
                <stat.icon size={20} className="sm:w-6 sm:h-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] sm:text-sm font-medium text-slate-500 truncate">{stat.name}</p>
                <p className="text-base sm:text-2xl font-bold text-slate-900 truncate">{stat.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* WhatsApp Connection Card */}
      <TemplateModal isOpen={showTemplateModal} onClose={() => setShowTemplateModal(false)} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {/* WhatsApp Connection Card */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <QrCode size={20} className="text-emerald-600" />
                Conexão WhatsApp
              </div>
              <ConnectionStatusBadge status={status} />
            </CardTitle>
            <CardDescription>
              Conecte seu celular para começar a enviar mensagens.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center py-6 space-y-6">
            {error && (
              <div className="w-full p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 text-red-600">
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-xs font-bold uppercase">Erro de Conexão</p>
                  <p className="text-[10px] opacity-80">{error}</p>
                </div>
                <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
                  <Trash2 size={14} />
                </button>
              </div>
            )}

            {status === "connected" ? (
              <div className="text-center space-y-4 w-full">
                <div className="mx-auto h-20 w-20 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600">
                  <CheckCircle2 size={48} />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-emerald-700">Conectado</p>
                  <p className="text-sm text-slate-500 flex items-center justify-center gap-2">
                    {me?.id ? `Número: ${me.id.split(':')[0]}` : "Seu WhatsApp está pronto para uso."}
                    {me?.id && (
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(me.id.split(':')[0]);
                          toast.success("Número copiado!");
                        }}
                        className="p-1 hover:bg-slate-100 rounded text-slate-400"
                      >
                        <Copy size={12} />
                      </button>
                    )}
                  </p>
                </div>
                <div className="flex flex-col gap-2 w-full">
                  <Button className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700" onClick={testBot} disabled={loading}>
                    <Zap size={18} />
                    Testar Bot (Enviar para mim)
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1 gap-2" onClick={pauseSession} disabled={loading}>
                      <Pause size={18} />
                      Pausar Conexão
                    </Button>
                    <Button variant="ghost" className="text-red-500 hover:bg-red-50" size="icon" onClick={resetSession} disabled={loading}>
                      <Trash2 size={18} />
                    </Button>
                  </div>
                </div>
              </div>
            ) : status === "qr" && qr ? (
              <div className="text-center space-y-4 w-full">
                <div className="p-4 bg-white border-2 border-slate-100 rounded-2xl shadow-inner mx-auto w-fit">
                  <img src={qr} alt="QR Code" className="h-48 w-48" />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-slate-900">Escaneie o QR Code</p>
                  <p className="text-sm text-slate-500">Abra o WhatsApp {">"} Aparelhos Conectados.</p>
                </div>
                <Button variant="ghost" size="sm" className="gap-2" onClick={() => userId && checkStatus(userId, true)}>
                  <RefreshCw size={14} />
                  Atualizar
                </Button>
                <Button variant="ghost" size="sm" className="text-slate-400 text-[10px]" onClick={resetSession}>
                  Limpar sessão e tentar novamente
                </Button>
              </div>
            ) : status === "pairing" && pairingCode ? (
              <div className="text-center space-y-6 w-full">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-slate-500">Seu código de pareamento:</p>
                  <div className="flex justify-center gap-2">
                    {pairingCode.split('').map((char, i) => (
                      <div key={i} className="w-8 h-10 bg-slate-100 border border-slate-200 rounded-lg flex items-center justify-center text-xl font-bold text-emerald-600">
                        {char}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100 text-left">
                  <p className="text-xs font-bold text-emerald-800 uppercase mb-2">Como usar:</p>
                  <ol className="text-xs text-emerald-700 space-y-1 list-decimal list-inside">
                    <li>Abra o WhatsApp no seu celular</li>
                    <li>Vá em Configurações {">"} Aparelhos Conectados</li>
                    <li>Toque em "Conectar um aparelho"</li>
                    <li>Toque em "Conectar com número de telefone"</li>
                    <li>Digite o código acima no seu celular</li>
                  </ol>
                </div>
                <Button variant="ghost" size="sm" className="gap-2" onClick={() => userId && checkStatus(userId)}>
                  <RefreshCw size={14} />
                  Verificar Conexão
                </Button>
                <Button variant="ghost" size="sm" className="text-slate-400 text-[10px]" onClick={resetSession}>
                  Limpar sessão e tentar novamente
                </Button>
              </div>
            ) : status === "paused" ? (
              <div className="text-center space-y-4 w-full">
                <div className="mx-auto h-20 w-20 bg-amber-100 rounded-full flex items-center justify-center text-amber-600">
                  <Pause size={48} />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-amber-700">Conexão Pausada</p>
                  <p className="text-sm text-slate-500">Seu bot está offline. Retome a conexão para voltar a enviar e receber mensagens.</p>
                </div>
                <div className="flex flex-col gap-2 w-full">
                  <Button className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700" onClick={connect} disabled={loading}>
                    <Zap size={18} />
                    Retomar Conexão
                  </Button>
                  <Button variant="ghost" className="text-red-500 hover:bg-red-50" onClick={resetSession} disabled={loading}>
                    <Trash2 size={16} className="mr-2" />
                    Desconectar Completamente
                  </Button>
                </div>
              </div>
            ) : (status === "connecting" || loading || status === null) ? (
              <div className="text-center space-y-4 py-8 w-full">
                <div className="mx-auto h-20 w-20 bg-slate-100 rounded-full flex items-center justify-center text-emerald-500">
                  <RefreshCw size={48} className="animate-spin" />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-slate-900">
                    {connectMethod === "qr" ? "Gerando QR Code..." : "Gerando Código..."}
                  </p>
                  <p className="text-sm text-slate-500">Isso pode levar alguns segundos.</p>
                </div>
              </div>
            ) : (
              <div className="text-center space-y-6 py-4 w-full">
                <div className="flex p-1 bg-slate-100 rounded-xl">
                  <button 
                    className={cn(
                      "flex-1 py-2 text-xs font-bold rounded-lg transition-all",
                      connectMethod === "number" ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                    )}
                    onClick={() => setConnectMethod("number")}
                  >
                    Por Número
                  </button>
                  <button 
                    className={cn(
                      "flex-1 py-2 text-xs font-bold rounded-lg transition-all",
                      connectMethod === "qr" ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                    )}
                    onClick={() => setConnectMethod("qr")}
                  >
                    Por QR Code
                  </button>
                </div>

                {connectMethod === "number" ? (
                  <div className="space-y-4">
                    <div className="space-y-2 text-left">
                      <label className="text-xs font-bold text-slate-500 uppercase">Número do WhatsApp</label>
                      <div className="relative">
                        <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <Input 
                          placeholder="Ex: 5511999999999" 
                          className="pl-10"
                          value={phoneNumber}
                          onChange={e => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                        />
                      </div>
                      <p className="text-[10px] text-slate-400 italic">Inclua o código do país e DDD (apenas números).</p>
                    </div>
                    <Button className="w-full gap-2" onClick={connect} disabled={loading || !phoneNumber}>
                      <Key size={18} />
                      Gerar Código de Pareamento
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="mx-auto h-20 w-20 bg-slate-100 rounded-full flex items-center justify-center text-slate-400">
                      <QrCode size={48} />
                    </div>
                    <div className="space-y-1">
                      <p className="font-semibold text-slate-900">Conexão por QR Code</p>
                      <p className="text-sm text-slate-500">Gere um código para escanear com a câmera.</p>
                    </div>
                    <Button className="w-full gap-2" onClick={connect} disabled={loading}>
                      <Zap size={18} />
                      Gerar QR Code
                    </Button>
                  </div>
                )}

                <div className="pt-4 border-t border-slate-100 flex flex-col gap-2 w-full">
                  <p className="text-[10px] text-slate-400">Já escaneou no seu celular?</p>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 text-xs gap-2"
                    onClick={() => userId && checkStatus(userId, true)}
                  >
                    <RefreshCw size={14} />
                    Verificar Conexão Manualmente
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Live Logs Section */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Terminal size={20} className="text-slate-600" />
                Logs em Tempo Real
              </CardTitle>
              <CardDescription>Acompanhe o que o bot está fazendo agora.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setAutoScroll(!autoScroll)}
                className={cn(
                  "px-2 py-1 rounded text-[10px] font-bold uppercase transition-colors",
                  autoScroll ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                )}
              >
                Auto-scroll: {autoScroll ? "ON" : "OFF"}
              </button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-500" onClick={clearLogs}>
                <Trash2 size={14} />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="bg-slate-950 rounded-xl p-4 font-mono text-[10px] sm:text-xs h-[300px] overflow-y-auto space-y-2 border border-slate-800 shadow-2xl custom-scrollbar">
              {logs.length === 0 ? (
                <p className="text-slate-600 italic">Aguardando eventos...</p>
              ) : (
                <div className="space-y-2">
                  {[...logs].reverse().map((log, i) => (
                    <div key={log.id || i} className="flex gap-2 border-b border-slate-900 pb-2 last:border-0">
                      <span className="text-slate-500 shrink-0">
                        [{new Date(log.created_at).toLocaleTimeString()}]
                      </span>
                      <span className={cn(
                        "font-bold uppercase shrink-0 w-16",
                        log.level === "success" ? "text-emerald-400" :
                        log.level === "error" ? "text-red-400" :
                        log.level === "warning" ? "text-amber-400" :
                        "text-blue-400"
                      )}>
                        {log.level}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-slate-300 break-words">{log.message}</p>
                        {log.details && (
                          <pre className="mt-1 text-[10px] text-slate-500 overflow-x-auto bg-slate-900/50 p-1 rounded">
                            {typeof log.details === 'string' ? log.details : JSON.stringify(log.details, null, 2)}
                          </pre>
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity / Feed */}
        <Card className="lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity size={20} className="text-blue-600" />
                Atividade Recente
              </CardTitle>
              <CardDescription>Ultimas mensagens e eventos do sistema.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate("/automations")} className="text-emerald-600 gap-1">
              Ver Automações
              <ChevronRight size={14} />
            </Button>
          </CardHeader>
          <CardContent>
            {recentMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-4">
                <MessageSquare size={48} strokeWidth={1.5} />
                <p className="text-sm">Nenhuma atividade registrada ainda.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {recentMessages.map((msg) => (
                  <div key={msg.id} className="flex items-start gap-4 p-3 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors">
                    <div className={cn(
                      "h-10 w-10 rounded-full flex items-center justify-center shrink-0",
                      msg.type === "inbound" ? "bg-blue-100 text-blue-600" : "bg-emerald-100 text-emerald-600"
                    )}>
                      <MessageSquare size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold text-slate-900 truncate">
                          {msg.type === "inbound" ? "Mensagem Recebida" : "Mensagem Enviada"}
                        </p>
                        <span className="text-[10px] text-slate-400 whitespace-nowrap">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 line-clamp-1">{msg.text}</p>
                      {msg.is_automated && (
                        <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 bg-purple-50 text-purple-600 text-[8px] font-bold uppercase rounded">
                          <Zap size={8} /> Automação
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
