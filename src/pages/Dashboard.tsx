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
  Search, 
  Copy, 
  Check, 
  Smartphone, 
  KeyRound,
  Calendar,
  CalendarCheck,
  CalendarPlus,
  Stethoscope,
  BellRing,
  Scissors,
  TrendingUp,
  Send,
  BarChart3,
  UserCheck,
  Sparkles,
  Building2,
  CheckCircle,
  User,
  MessageCircle
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

import { BusinessNiche, NICHE_CONFIGS, getStoredNiche } from "../lib/niches";

const WeeklyActivityChart = ({ 
  data, 
  metricLabel = "Mensagens",
  accentColor = "#10b981" 
}: { 
  data: { day: string; count: number; dateStr: string }[];
  metricLabel?: string;
  accentColor?: string;
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  
  const maxCount = Math.max(...data.map(d => d.count), 5);
  const width = 500;
  const height = 145;
  const paddingX = 25;
  const paddingY = 22;
  const graphWidth = width - paddingX * 2;
  const graphHeight = height - paddingY * 2;

  const points = data.map((d, idx) => {
    const x = paddingX + (idx / Math.max(data.length - 1, 1)) * graphWidth;
    const y = height - paddingY - (d.count / maxCount) * graphHeight;
    return { x, y, ...d };
  });

  const pathD = points.reduce((acc, p, i, arr) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const prev = arr[i - 1];
    const cpX1 = prev.x + (p.x - prev.x) / 2;
    const cpY1 = prev.y;
    const cpX2 = prev.x + (p.x - prev.x) / 2;
    const cpY2 = p.y;
    return `${acc} C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${p.x} ${p.y}`;
  }, "");

  const areaD = points.length > 0 
    ? `${pathD} L ${points[points.length - 1].x} ${height - paddingY} L ${points[0].x} ${height - paddingY} Z`
    : "";

  return (
    <div className="w-full relative select-none">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-36 overflow-visible">
        <defs>
          <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accentColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={accentColor} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {[0, 0.5, 1].map((ratio, i) => {
          const y = height - paddingY - ratio * graphHeight;
          return (
            <line
              key={i}
              x1={paddingX}
              y1={y}
              x2={width - paddingX}
              y2={y}
              stroke="#f1f5f9"
              strokeDasharray="4 4"
              strokeWidth="1"
            />
          );
        })}

        {/* Area */}
        {areaD && <path d={areaD} fill="url(#chartGradient)" />}

        {/* Line */}
        {pathD && (
          <path 
            d={pathD} 
            fill="none" 
            stroke={accentColor} 
            strokeWidth="2.5" 
            strokeLinecap="round" 
            strokeLinejoin="round" 
          />
        )}

        {/* Points */}
        {points.map((p, idx) => (
          <g 
            key={idx} 
            className="cursor-pointer" 
            onMouseEnter={() => setHoveredIdx(idx)} 
            onMouseLeave={() => setHoveredIdx(null)}
            onTouchStart={() => setHoveredIdx(idx)}
          >
            {/* Larger invisible touch area for mobile taps */}
            <circle
              cx={p.x}
              cy={p.y}
              r={16}
              fill="transparent"
            />
            <circle
              cx={p.x}
              cy={p.y}
              r={hoveredIdx === idx ? 6 : 3.5}
              fill="#ffffff"
              stroke={accentColor}
              strokeWidth={hoveredIdx === idx ? 3 : 2}
              className="transition-all duration-150"
            />
            <text
              x={p.x}
              y={height - 3}
              textAnchor="middle"
              className={cn(
                "text-[10px] font-bold fill-slate-400 transition-colors",
                hoveredIdx === idx && "fill-slate-900 font-extrabold"
              )}
            >
              {p.day}
            </text>
          </g>
        ))}
      </svg>

      {hoveredIdx !== null && points[hoveredIdx] && (
        <div 
          className="absolute pointer-events-none -top-2 bg-slate-900 text-white text-[11px] font-bold px-2.5 py-1.5 rounded-xl shadow-xl -translate-x-1/2 -translate-y-full transition-all duration-150 border border-slate-700"
          style={{ left: `${(points[hoveredIdx].x / width) * 100}%` }}
        >
          <p className="text-[10px] text-slate-300 font-medium">{points[hoveredIdx].dateStr}</p>
          <p className="font-extrabold text-emerald-400">{points[hoveredIdx].count} {metricLabel}</p>
        </div>
      )}
    </div>
  );
};

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
  const [connectionMethod, setConnectionMethod] = useState<"qr" | "code">("qr");
  const [pairingCountryCode, setPairingCountryCode] = useState("258");
  const [pairingPhone, setPairingPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
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
  const [niche, setNiche] = useState<BusinessNiche>(getStoredNiche);
  const [chartMetric, setChartMetric] = useState<"messages" | "leads">("messages");
  const [messagesUsed, setMessagesUsed] = useState(0);
  const [pipelineTotal, setPipelineTotal] = useState(0);
  const [weeklyActivity, setWeeklyActivity] = useState<{ day: string; count: number; dateStr: string }[]>([]);

  useEffect(() => {
    const handleNicheChange = () => {
      setNiche(getStoredNiche());
    };
    window.addEventListener("crm_niche_changed", handleNicheChange);
    window.addEventListener("storage", handleNicheChange);
    return () => {
      window.removeEventListener("crm_niche_changed", handleNicheChange);
      window.removeEventListener("storage", handleNicheChange);
    };
  }, []);

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
        .limit(20);
      
      const cleanLeads = (data || []).filter((l: any) => {
        const p = (l.phone || "").replace(/\D/g, "");
        return p && !p.startsWith("120363") && p.length >= 8 && p.length <= 14;
      });
      setLeads(cleanLeads);
    };

    const fetchWeeklyData = async (uId: string, metric: "messages" | "leads" = chartMetric) => {
      if (!uId) return;
      try {
        const days = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
        const now = new Date();
        const last7Days: { day: string; count: number; dateStr: string; start: Date; end: Date }[] = [];

        for (let i = 6; i >= 0; i--) {
          const d = new Date();
          d.setDate(now.getDate() - i);
          const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
          const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
          const dayName = days[d.getDay()];
          const dateStr = `${d.getDate()}/${d.getMonth() + 1}`;
          last7Days.push({ day: dayName, count: 0, dateStr, start, end });
        }

        const sevenDaysAgo = last7Days[0].start.toISOString();

        if (metric === "messages") {
          const { data } = await supabase
            .from("messages")
            .select("timestamp")
            .eq("user_id", uId)
            .gte("timestamp", sevenDaysAgo);

          if (data) {
            data.forEach(m => {
              const t = new Date(m.timestamp).getTime();
              const bucket = last7Days.find(b => t >= b.start.getTime() && t <= b.end.getTime());
              if (bucket) bucket.count++;
            });
          }
        } else {
          const { data } = await supabase
            .from("leads")
            .select("created_at")
            .eq("user_id", uId)
            .gte("created_at", sevenDaysAgo);

          if (data) {
            data.forEach(l => {
              const t = new Date(l.created_at).getTime();
              const bucket = last7Days.find(b => t >= b.start.getTime() && t <= b.end.getTime());
              if (bucket) bucket.count++;
            });
          }
        }

        setWeeklyActivity(last7Days.map(b => ({ day: b.day, count: b.count, dateStr: b.dateStr })));
      } catch (e) {
        console.error("Error fetching weekly data:", e);
      }
    };

    fetchStats(userId);
    fetchRecentMessages(userId);
    fetchSystemLogs(userId);
    fetchLeads();
    fetchWeeklyData(userId, chartMetric);

    const interval = setInterval(() => {
      fetchStats(userId);
      fetchRecentMessages(userId);
      fetchSystemLogs(userId);
      fetchLeads();
      fetchWeeklyData(userId, chartMetric);
    }, 30000);

    return () => clearInterval(interval);
  }, [userId, chartMetric]);

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
        
      // Pipeline value calculation
      const { data: leadsWithVal } = await supabase
        .from("leads")
        .select("value")
        .eq("user_id", userId);

      const totalVal = (leadsWithVal || []).reduce((acc: number, curr: any) => acc + (Number(curr.value) || 0), 0);
      setPipelineTotal(totalVal);

      // Messages used today
      const { data: subData } = await supabase
        .from("subscriptions")
        .select("messages_used")
        .eq("user_id", userId)
        .maybeSingle();

      if (subData) {
        setMessagesUsed(subData.messages_used || 0);
      }

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

  const handleRequestPairingCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!userId) return;
    const cleanNumber = pairingPhone.replace(/\D/g, "");
    if (!cleanNumber || cleanNumber.length < 8) {
      toast.error("Por favor, digite um número de telefone válido com o código do país.");
      return;
    }
    const fullPhone = `${pairingCountryCode.replace(/\D/g, "")}${cleanNumber}`;
    setGeneratingCode(true);
    try {
      toast.info("A gerar código de pareamento no WhatsApp...");
      const data = await apiFetch("/api/whatsapp/pair-code", {
        method: "POST",
        body: JSON.stringify({ phoneNumber: fullPhone })
      });
      if (data.success && data.code) {
        setPairingCode(data.code);
        setStatus("pairing_code");
        toast.success("Código gerado! Digite-o no WhatsApp do seu telemóvel.");
      } else {
        throw new Error(data.error || "Não foi possível gerar o código");
      }
    } catch (err: any) {
      console.error("Pairing code error:", err);
      toast.error(err.message || "Erro ao solicitar código de conexão.");
    } finally {
      setGeneratingCode(false);
    }
  };

  const copyPairingCode = () => {
    if (!pairingCode) return;
    navigator.clipboard.writeText(pairingCode.replace(/-/g, ""));
    setCopiedCode(true);
    toast.success("Código copiado!");
    setTimeout(() => setCopiedCode(false), 3000);
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
  const currentNicheConfig = NICHE_CONFIGS[niche];

  // Daily message limit based on subscription plan
  const dailyMessageLimit = plan === "Pro" ? 5000 : plan === "Business" ? 20000 : 500;
  const currentMessagesUsed = messagesUsed || stats.messages;
  const usagePercentage = Math.min(100, Math.round((currentMessagesUsed / dailyMessageLimit) * 100));

  // Dynamic KPI values tailored to the active niche
  const kpi1Value = niche === "vendas" 
    ? (pipelineTotal > 0 ? `${pipelineTotal.toLocaleString()} MZN` : `${stats.leads} Leads`)
    : niche === "clinica"
    ? `${stats.leads} Pacientes`
    : niche === "servicos"
    ? `${stats.leads} Agendamentos`
    : stats.leads.toString();

  const kpi2Value = niche === "clinica"
    ? `${stats.messages} Atendimentos`
    : niche === "vendas"
    ? `${stats.messages} Negociações`
    : niche === "servicos"
    ? `${stats.messages} Sessões`
    : stats.messages.toString();

  const kpi3Value = stats.actions.toString();

  const Kpi1Icon = currentNicheConfig.kpi1.icon;
  const Kpi2Icon = currentNicheConfig.kpi2.icon;
  const Kpi3Icon = currentNicheConfig.kpi3.icon;

  if (activationLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 w-full">
      {/* Header Section */}
      <div className="flex flex-col gap-3.5 sm:gap-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap">
              <h2 className="text-xl sm:text-3xl font-black text-slate-900 tracking-tight">
                Olá, <span className="text-emerald-600">{userName}</span> 👋
              </h2>
              <button
                type="button"
                onClick={() => navigate("/settings?tab=niche")}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] sm:text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300 transition-all shadow-xs cursor-pointer group"
                title="Modo ativo. Clique para alterar o segmento do negócio nas Definições"
              >
                <currentNicheConfig.icon size={13} className="text-emerald-600 group-hover:scale-110 transition-transform" />
                <span>{currentNicheConfig.badge}</span>
                <span className="text-[10px] text-emerald-600 font-semibold group-hover:underline">· Alterar</span>
              </button>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 font-medium max-w-2xl leading-relaxed">
              {currentNicheConfig.tagline}
            </p>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-2 w-full md:w-auto flex-wrap sm:flex-nowrap">
            {/* Smart Bot Toggle */}
            {!isFree && (
              <div 
                onClick={toggleAgent}
                className={cn(
                  "flex items-center gap-2 sm:gap-2.5 px-3 py-1.5 rounded-2xl cursor-pointer transition-all border select-none shrink-0",
                  agent?.is_active 
                    ? "bg-emerald-50 border-emerald-200 text-emerald-700 shadow-xs" 
                    : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
                )}
                title={agent?.is_active ? "Clique para pausar o Smart Bot" : "Clique para ativar o Smart Bot"}
              >
                <div className={cn(
                  "h-6 w-6 sm:h-7 sm:w-7 rounded-xl flex items-center justify-center transition-all",
                  agent?.is_active ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-400"
                )}>
                  <Bot size={14} />
                </div>
                <div className="flex flex-col text-left">
                  <span className="text-[9px] font-black uppercase tracking-widest leading-none">Smart Bot</span>
                  <span className="text-[10px] sm:text-[11px] font-bold">{agent?.is_active ? "ATIVO" : "PAUSADO"}</span>
                </div>
                <div className={cn(
                  "w-7 sm:w-8 h-4 rounded-full relative transition-all ml-0.5 sm:ml-1",
                  agent?.is_active ? "bg-emerald-500" : "bg-slate-300"
                )}>
                  <div className={cn(
                    "absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all shadow-xs",
                    agent?.is_active ? "left-3.5 sm:left-4.5" : "left-0.5"
                  )} />
                </div>
              </div>
            )}

            <div className="flex items-center gap-1.5 shrink-0">
              <ConnectionStatusBadge status={status} />
              
              <Button 
                onClick={() => checkStatus(userId!, true)} 
                variant="outline"
                size="sm"
                className="rounded-xl border-slate-200 font-medium text-xs h-8 sm:h-9 w-8 sm:w-auto px-0 sm:px-3 hover:border-emerald-300 hover:bg-emerald-50/50 flex items-center justify-center"
                title="Sincronizar status do WhatsApp"
              >
                <RefreshCw size={14} className={cn(loading && "animate-spin")} />
              </Button>
            </div>
          </div>
        </div>

        {/* Niche Quick Actions Bar */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5 sm:flex-wrap w-full">
          <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-400 mr-1 flex items-center gap-1 shrink-0">
            <Zap size={13} className="text-amber-500" /> Ações:
          </span>
          {currentNicheConfig.quickActions.map((qa, idx) => {
            const QAIcon = qa.icon;
            return (
              <Button
                key={idx}
                variant={qa.isPrimary ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  if (qa.path === "/schedule") navigate("/schedule");
                  else if (qa.path === "/messages") navigate("/messages");
                  else if (qa.path === "/leads") navigate("/leads");
                  else if (qa.path === "/agent") navigate("/agent");
                  else navigate(qa.path);
                }}
                className={cn(
                  "rounded-xl text-xs font-bold h-8 sm:h-9 px-3 gap-1.5 transition-all shadow-xs shrink-0",
                  qa.isPrimary 
                    ? "bg-emerald-600 hover:bg-emerald-500 text-white" 
                    : "border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/50 text-slate-700 bg-white"
                )}
              >
                <QAIcon size={13} className={qa.isPrimary ? "text-white" : "text-emerald-600"} />
                {qa.label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Stats Grid - 3 Dynamic Niche KPIs + WhatsApp Plan Limit */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        {/* KPI 1 */}
        <Card className="border-slate-100 shadow-xs hover:shadow-md transition-all group overflow-hidden bg-white">
          <div className="p-3 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <div className={cn("h-9 w-9 sm:h-12 sm:w-12 rounded-xl sm:rounded-2xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 shadow-xs", currentNicheConfig.kpi1.bg, currentNicheConfig.kpi1.color)}>
              <Kpi1Icon size={18} className="sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-slate-400 truncate mb-0.5">{currentNicheConfig.kpi1.label}</p>
              <p className="text-base sm:text-2xl font-black text-slate-900 tracking-tight truncate">{kpi1Value}</p>
            </div>
          </div>
        </Card>

        {/* KPI 2 */}
        <Card className="border-slate-100 shadow-xs hover:shadow-md transition-all group overflow-hidden bg-white">
          <div className="p-3 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <div className={cn("h-9 w-9 sm:h-12 sm:w-12 rounded-xl sm:rounded-2xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 shadow-xs", currentNicheConfig.kpi2.bg, currentNicheConfig.kpi2.color)}>
              <Kpi2Icon size={18} className="sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-slate-400 truncate mb-0.5">{currentNicheConfig.kpi2.label}</p>
              <p className="text-base sm:text-2xl font-black text-slate-900 tracking-tight truncate">{kpi2Value}</p>
            </div>
          </div>
        </Card>

        {/* KPI 3 */}
        <Card className="border-slate-100 shadow-xs hover:shadow-md transition-all group overflow-hidden bg-white">
          <div className="p-3 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <div className={cn("h-9 w-9 sm:h-12 sm:w-12 rounded-xl sm:rounded-2xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 shadow-xs", currentNicheConfig.kpi3.bg, currentNicheConfig.kpi3.color)}>
              <Kpi3Icon size={18} className="sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-slate-400 truncate mb-0.5">{currentNicheConfig.kpi3.label}</p>
              <p className="text-base sm:text-2xl font-black text-slate-900 tracking-tight truncate">{kpi3Value}</p>
            </div>
          </div>
        </Card>

        {/* KPI 4: WhatsApp Daily Plan Limit */}
        <Card className="border-slate-100 shadow-xs hover:shadow-md transition-all overflow-hidden bg-gradient-to-br from-white to-slate-50/50">
          <div className="p-3 sm:p-5 space-y-1.5 sm:space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-slate-400 truncate">Limite Diário</span>
              <span className="text-[9px] sm:text-[10px] font-extrabold uppercase px-1.5 sm:px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 shrink-0">
                {plan}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm sm:text-xl font-black text-slate-900 truncate">
                {currentMessagesUsed.toLocaleString()} <span className="text-[10px] sm:text-xs font-bold text-slate-400">/ {dailyMessageLimit.toLocaleString()}</span>
              </span>
              <span className="text-[11px] sm:text-xs font-extrabold text-emerald-600 shrink-0 ml-1">{usagePercentage}%</span>
            </div>
            {/* Progress bar */}
            <div className="w-full bg-slate-100 rounded-full h-1.5 sm:h-2 overflow-hidden">
              <div 
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  usagePercentage > 90 ? "bg-red-500" : usagePercentage > 70 ? "bg-amber-500" : "bg-emerald-500"
                )}
                style={{ width: `${usagePercentage}%` }}
              />
            </div>
            <p className="text-[9px] sm:text-[10px] text-slate-400 font-medium truncate">Renova às 00:00</p>
          </div>
        </Card>
      </div>

      {/* Main Grid: Left (8 cols: Weekly SVG Chart + Niche Hot Items) & Right (4 cols: WhatsApp & Bot) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (lg:col-span-8) */}
        <div className="lg:col-span-8 space-y-6">
          {/* Weekly SVG Chart Card */}
          <Card className="border-slate-100 shadow-xs overflow-hidden bg-white">
            <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <BarChart3 size={17} className="text-emerald-600 shrink-0" />
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base">Tendência de Atividade Semanal</h3>
                </div>
                <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">
                  Volume diário dos últimos 7 dias na sua instância
                </p>
              </div>

              {/* Metric Toggle */}
              <div className="flex bg-slate-100 p-1 rounded-xl w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setChartMetric("messages")}
                  className={cn(
                    "flex-1 sm:flex-none px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5",
                    chartMetric === "messages" ? "bg-white text-emerald-700 shadow-xs" : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  <MessageSquare size={12} />
                  Mensagens
                </button>
                <button
                  type="button"
                  onClick={() => setChartMetric("leads")}
                  className={cn(
                    "flex-1 sm:flex-none px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5",
                    chartMetric === "leads" ? "bg-white text-emerald-700 shadow-xs" : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  <Users size={12} />
                  {niche === "clinica" ? "Pacientes" : niche === "servicos" ? "Agendamentos" : "Leads"}
                </button>
              </div>
            </div>

            <div className="p-3 sm:p-5 pt-2 sm:pt-3">
              <WeeklyActivityChart 
                data={weeklyActivity} 
                metricLabel={chartMetric === "messages" ? "Mensagens" : niche === "clinica" ? "Pacientes" : "Leads"} 
              />
            </div>
          </Card>

          {/* Niche Hot Items ("Próximas Consultas" / "Oportunidades Quentes") */}
          <Card className="border-slate-100 shadow-xs overflow-hidden bg-white">
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <currentNicheConfig.icon size={17} className="text-emerald-600 shrink-0" />
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base">{currentNicheConfig.leadsTitle}</h3>
                </div>
                <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">{currentNicheConfig.leadsSubtitle}</p>
              </div>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => navigate("/leads")} 
                className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 text-xs font-bold gap-1 shrink-0"
              >
                Ver Todos <ChevronRight size={14} />
              </Button>
            </div>

            <div className="divide-y divide-slate-50">
              {leads.length > 0 ? (
                leads.slice(0, 4).map((lead) => {
                  const rawName = (lead.name || "").trim();
                  const isNameNumeric = !rawName || /^\d+$/.test(rawName);
                  const cleanPhone = (lead.phone || "").replace(/\D/g, "");
                  const formattedPhone = cleanPhone.startsWith("258") && cleanPhone.length === 12
                    ? `+258 ${cleanPhone.slice(3, 5)} ${cleanPhone.slice(5, 8)} ${cleanPhone.slice(8)}`
                    : cleanPhone.length > 8 ? `+${cleanPhone}` : (lead.phone || "Contacto");
                  const displayName = isNameNumeric ? formattedPhone : rawName;
                  const displayAvatarLetter = isNameNumeric ? null : rawName.charAt(0).toUpperCase();

                  return (
                    <div key={lead.id} className="p-3.5 sm:p-4 hover:bg-slate-50/80 transition-colors flex items-center justify-between gap-3 sm:gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        {displayAvatarLetter ? (
                          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-emerald-50 to-emerald-100 text-emerald-800 border border-emerald-200/80 flex items-center justify-center font-black text-sm shrink-0 shadow-xs">
                            {displayAvatarLetter}
                          </div>
                        ) : (
                          <div className="h-10 w-10 rounded-2xl bg-slate-100 text-slate-600 border border-slate-200/80 flex items-center justify-center shrink-0 shadow-xs">
                            <User size={18} className="text-slate-500" />
                          </div>
                        )}
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-xs sm:text-sm text-slate-900 truncate">
                              {displayName}
                            </p>
                            <span className="text-[9px] sm:text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100/80 shrink-0">
                              {lead.intent || (niche === "clinica" ? "Consulta" : niche === "servicos" ? "Agendamento" : "Negociação")}
                            </span>
                          </div>
                          <p className="text-[11px] sm:text-xs text-slate-500 truncate italic">
                            "{lead.last_message || 'Iniciou conversa no WhatsApp'}"
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate("/messages")}
                          className="rounded-xl border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 text-emerald-700 font-bold text-xs h-8 px-2.5 sm:px-3 gap-1 shadow-xs"
                        >
                          <MessageSquare size={13} />
                          <span className="hidden sm:inline">Conversar</span>
                        </Button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-8 text-center flex flex-col items-center justify-center space-y-3">
                  <div className="h-14 w-14 rounded-2xl bg-slate-50 text-slate-400 flex items-center justify-center border border-slate-200/80">
                    <currentNicheConfig.icon size={26} className="opacity-60" />
                  </div>
                  <div className="space-y-1 max-w-sm">
                    <p className="text-sm font-bold text-slate-800">{currentNicheConfig.emptyLeadsText}</p>
                    <p className="text-xs text-slate-500">
                      Assim que um cliente ou paciente enviar mensagem pelo WhatsApp, o assistente inteligente irá registrar aqui em tempo real.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate("/contacts")}
                    className="rounded-xl text-xs font-bold border-slate-200 hover:bg-slate-50 text-slate-700"
                  >
                    Ver Lista de Contactos
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Right Column (lg:col-span-4 space-y-6) */}
        <div className="lg:col-span-4 space-y-6">
          {/* Enriched WhatsApp Connection Status Card */}
          <Card className="border-slate-100 shadow-xs overflow-hidden bg-white">
            <CardHeader className="p-5 border-b border-slate-50">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-bold text-slate-900">Conexão WhatsApp</CardTitle>
                <Badge variant={status === "connected" ? "success" : "warning"} className="text-[10px] font-bold">
                  {status === "connected" ? "Instância Ativa" : "Desconectado"}
                </Badge>
              </div>
              <CardDescription className="text-xs">
                {status === "connected" ? "Conexão oficial ativa e sincronizada" : "Conecte sua conta do WhatsApp"}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-5 flex flex-col items-center justify-center text-center">
              <AnimatePresence mode="wait">
                {status === "connected" ? (
                  <motion.div 
                    key="connected"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="w-full space-y-4"
                  >
                    {/* Active instance display */}
                    <div className="p-4 bg-emerald-50/70 rounded-2xl border border-emerald-100 text-left space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className="h-12 w-12 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shadow-md shadow-emerald-500/20">
                            <Phone size={22} />
                          </div>
                          <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-600 border-2 border-white"></span>
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-800">Número do Aparelho</p>
                          <p className="text-base font-bold text-slate-900 truncate">
                            {me?.id ? `+${me.id.split(':')[0]}` : "WhatsApp Operacional"}
                          </p>
                          <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                            <Users size={12} className="text-emerald-600" />
                            <span>{stats.contacts} contactos na base</span>
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-emerald-100/60">
                        <div className="bg-white/80 p-2 rounded-xl border border-emerald-100/60">
                          <p className="text-[9px] font-bold text-slate-400 uppercase">Status do Bot</p>
                          <p className="text-xs font-extrabold text-emerald-700">{agent?.is_active ? "Ativo 24/7" : "Pausado"}</p>
                        </div>
                        <div className="bg-white/80 p-2 rounded-xl border border-emerald-100/60">
                          <p className="text-[9px] font-bold text-slate-400 uppercase">Mensagens Hoje</p>
                          <p className="text-xs font-extrabold text-slate-800">{stats.messages}</p>
                        </div>
                      </div>
                    </div>

                    {/* Quick Instance Actions */}
                    <div className="grid grid-cols-2 gap-2">
                      <Button 
                        variant="outline" 
                        size="sm"
                        className="rounded-xl border-slate-200 text-slate-700 hover:bg-slate-100 font-bold text-xs h-10 gap-1.5" 
                        onClick={pauseSession}
                      >
                        <Pause size={14} />
                        Pausar
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        className="rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50 font-bold text-xs h-10 gap-1.5" 
                        onClick={resetSession}
                      >
                        <Trash2 size={14} />
                        Sair
                      </Button>
                    </div>

                    <Button 
                      onClick={() => navigate("/schedule")}
                      className="w-full h-11 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm transition-all"
                    >
                      <Send size={14} /> Disparar Mensagens
                    </Button>
                  </motion.div>
                ) : (
                  <motion.div 
                    key="disconnected"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full space-y-4"
                  >
                    {/* Method Selector Tabs */}
                    <div className="flex items-center justify-center p-1 bg-slate-100 rounded-xl w-full">
                      <button
                        type="button"
                        onClick={() => { setConnectionMethod("qr"); }}
                        className={cn(
                          "flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5",
                          connectionMethod === "qr" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-800"
                        )}
                      >
                        <QrCode size={14} />
                        QR Code
                      </button>
                      <button
                        type="button"
                        onClick={() => { setConnectionMethod("code"); }}
                        className={cn(
                          "flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5",
                          connectionMethod === "code" ? "bg-white text-emerald-700 shadow-xs" : "text-slate-500 hover:text-slate-800"
                        )}
                      >
                        <Smartphone size={14} />
                        Por Código
                      </button>
                    </div>

                    {/* Content Area */}
                    <div className="relative min-h-[220px] flex flex-col items-center justify-center w-full">
                      {connectionMethod === "code" ? (
                        pairingCode ? (
                          <div className="space-y-4 w-full">
                            <div className="p-4 bg-emerald-50/80 rounded-2xl border border-emerald-200 text-center space-y-3">
                              <p className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">Código de Conexão WhatsApp</p>
                              <div className="flex items-center justify-center gap-2">
                                <span className="font-mono text-2xl font-black tracking-widest text-slate-900 bg-white px-4 py-2 rounded-xl border border-emerald-300 shadow-xs select-all">
                                  {pairingCode}
                                </span>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={copyPairingCode}
                                className="w-full rounded-xl font-bold text-xs gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                              >
                                {copiedCode ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                                {copiedCode ? "Código Copiado!" : "Copiar Código"}
                              </Button>
                            </div>

                            {/* Step by step instructions */}
                            <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 text-left space-y-1.5">
                              <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                                <KeyRound size={14} className="text-emerald-600" /> No WhatsApp do telemóvel:
                              </p>
                              <ol className="text-[11px] text-slate-600 space-y-1 list-decimal list-inside font-medium leading-relaxed">
                                <li>Abra <span className="font-semibold text-slate-800">Aparelhos Conectados</span>.</li>
                                <li>Toque em <span className="font-semibold text-slate-800">Conectar um aparelho</span>.</li>
                                <li>Selecione <span className="font-semibold text-emerald-700">Conectar com número de telefone</span> na base.</li>
                                <li>Digite o código de 8 dígitos acima.</li>
                              </ol>
                            </div>

                            <div className="flex gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => { setPairingCode(null); }}
                                className="flex-1 text-xs font-bold text-slate-500 hover:text-slate-700"
                              >
                                Gerar outro
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={resetSession}
                                className="text-xs font-bold text-red-500 hover:text-red-700"
                              >
                                Cancelar
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <form onSubmit={handleRequestPairingCode} className="space-y-4 w-full">
                            <div className="h-14 w-14 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 mx-auto border border-emerald-100">
                              <Smartphone size={28} />
                            </div>
                            <div className="text-center space-y-1">
                              <p className="text-sm font-bold text-slate-900">Conectar por Código Oficial</p>
                              <p className="text-xs text-slate-500">
                                Digite o número que tem WhatsApp para receber o código.
                              </p>
                            </div>

                            <div className="space-y-1.5 text-left">
                              <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                                Número do WhatsApp
                              </label>
                              <div className="flex gap-2">
                                <div className="w-20 shrink-0">
                                  <div className="relative">
                                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">+</span>
                                    <input
                                      type="text"
                                      value={pairingCountryCode}
                                      onChange={(e) => setPairingCountryCode(e.target.value.replace(/\D/g, ''))}
                                      placeholder="258"
                                      className="w-full pl-5 pr-1 h-10 text-xs font-bold rounded-xl border border-slate-200 bg-white text-slate-800 text-center"
                                      maxLength={4}
                                      title="Código do País"
                                    />
                                  </div>
                                </div>
                                <input
                                  type="tel"
                                  value={pairingPhone}
                                  onChange={(e) => setPairingPhone(e.target.value)}
                                  placeholder="84 123 4567"
                                  className="flex-1 px-3 h-10 text-sm font-medium rounded-xl border border-slate-200 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                                />
                              </div>
                              <p className="text-[10px] text-slate-400 font-medium">Ex: Moçambique (+258), Angola (+244), Brasil (+55)</p>
                            </div>

                            <Button
                              type="submit"
                              disabled={generatingCode || !pairingPhone.trim()}
                              className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider shadow-md shadow-emerald-600/20 transition-all"
                            >
                              {generatingCode ? (
                                <span className="flex items-center gap-2">
                                  <RefreshCw size={14} className="animate-spin" /> A gerar código...
                                </span>
                              ) : (
                                "GERAR CÓDIGO"
                              )}
                            </Button>
                          </form>
                        )
                      ) : (
                        /* QR Code flow */
                        loading || status === "connecting" ? (
                          <div className="flex flex-col items-center gap-4 py-8 px-2 w-full">
                            {/* Animated Pulse Waves around WhatsApp Icon */}
                            <div className="relative flex items-center justify-center my-2">
                              <div className="absolute w-20 h-20 rounded-full bg-emerald-500/15 animate-ping" />
                              <div className="absolute w-16 h-16 rounded-full bg-emerald-500/25 animate-pulse" />
                              <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-emerald-400 text-white flex items-center justify-center shadow-lg shadow-emerald-600/30">
                                <MessageCircle size={28} className="animate-bounce" />
                              </div>
                            </div>

                            <div className="text-center space-y-1 max-w-xs">
                              <p className="text-xs font-black uppercase tracking-widest text-emerald-700 flex items-center justify-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                Conectando ao WhatsApp...
                              </p>
                              <p className="text-[11px] text-slate-500 leading-relaxed">
                                Estabelecendo canal seguro com criptografia de ponta a ponta.
                              </p>
                            </div>

                            {/* Shimmering Progress Bar */}
                            <div className="w-48 h-1.5 bg-slate-100 rounded-full overflow-hidden relative mt-1">
                              <div className="absolute inset-y-0 left-0 w-full bg-gradient-to-r from-emerald-400 via-teal-400 to-emerald-600 rounded-full animate-pulse" />
                            </div>

                            {connectingSince.current && (Date.now() - connectingSince.current > 15000) && (
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className="text-[10px] text-red-500 hover:text-red-600 font-bold uppercase tracking-widest mt-2 hover:bg-red-50 rounded-xl"
                                onClick={resetSession}
                              >
                                Reiniciar Conexão
                              </Button>
                            )}
                          </div>
                        ) : qr ? (
                          <motion.div 
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="space-y-3"
                          >
                            <div className="p-3 bg-white rounded-2xl border border-slate-100 shadow-xl mx-auto w-fit">
                              <QRCodeSVG value={qr} size={170} level="M" includeMargin={false} />
                            </div>
                            <div className="space-y-0.5">
                              <p className="text-xs font-bold text-slate-900">Escaneie o QR Code</p>
                              <p className="text-[10px] text-slate-400 font-medium">WhatsApp {">"} Aparelhos Conectados</p>
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
                          <div className="flex flex-col items-center gap-4 py-4 w-full">
                            <div className="h-20 w-20 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-300 relative">
                              <QrCode size={36} className="opacity-30" />
                              <div className="absolute -bottom-1 -right-1 bg-white p-1 rounded-full shadow-xs border border-slate-100">
                                <Zap size={13} className="text-emerald-500" />
                              </div>
                            </div>
                            <div className="space-y-3 w-full">
                              <div className="space-y-0.5 text-center">
                                <p className="text-sm font-bold text-slate-900">Pronto para conectar?</p>
                                <p className="text-xs text-slate-400">Gere um QR Code para escanear com seu celular.</p>
                              </div>
                              <Button 
                                className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider shadow-md shadow-emerald-500/20 transition-all"
                                onClick={connect}
                                disabled={loading}
                              >
                                {loading ? <RefreshCw className="animate-spin" /> : "GERAR QR CODE"}
                              </Button>
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>

          {/* Smart Bot Card */}
          {!isFree && (
            <Card className="border-slate-100 shadow-xs overflow-hidden bg-white">
              <div className={cn(
                "p-5 flex flex-col items-center text-center space-y-3.5 transition-all",
                agent?.is_active ? "bg-emerald-50/40" : "bg-slate-50/50"
              )}>
                <div className="flex items-center justify-between w-full">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Atendente IA</span>
                  <span className={cn(
                    "text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full",
                    agent?.is_active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"
                  )}>
                    {agent?.is_active ? "Ativo" : "Pausado"}
                  </span>
                </div>

                <div className={cn(
                  "h-14 w-14 rounded-2xl flex items-center justify-center shadow-md transition-transform hover:scale-105",
                  agent?.is_active ? "bg-emerald-500 text-white shadow-emerald-500/20" : "bg-slate-200 text-slate-400"
                )}>
                  <Bot size={28} />
                </div>

                <div className="space-y-0.5">
                  <h4 className="font-bold text-slate-900 text-sm">Smart Bot com IA</h4>
                  <p className="text-xs text-slate-500 leading-relaxed max-w-xs">
                    {agent?.is_active 
                      ? "Atendendo pacientes e clientes, respondendo dúvidas e capturando contatos 24/7." 
                      : "O assistente está pausado. As mensagens recebidas não terão resposta automática."}
                  </p>
                </div>

                <Button 
                  onClick={toggleAgent}
                  className={cn(
                    "w-full h-10 rounded-xl font-bold text-xs uppercase tracking-wider transition-all",
                    agent?.is_active 
                      ? "bg-white text-emerald-700 border-2 border-emerald-300 hover:bg-emerald-50 shadow-xs" 
                      : "bg-emerald-600 text-white hover:bg-emerald-500 shadow-md shadow-emerald-600/20"
                  )}
                >
                  {agent?.is_active ? "Pausar Atendente IA" : "Ativar Atendente IA"}
                </Button>

                <div className="w-full pt-2 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Personalizar Respostas</span>
                  <Button variant="ghost" size="sm" onClick={() => navigate("/agent")} className="text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 font-bold text-xs gap-1 h-8">
                    Treinar IA <ChevronRight size={13} />
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>

        {/* Real-time Monitor (Full 12 Columns across the bottom) */}
        <div className="lg:col-span-12">
          <Card className="border-slate-100 shadow-sm overflow-hidden flex flex-col">
            <div className="p-3.5 sm:p-5 border-b border-slate-100 bg-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
              <div className="flex items-center gap-2.5 sm:gap-3">
                <div className="h-9 w-9 sm:h-10 sm:w-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600 shrink-0">
                  <Activity size={18} />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base">Monitor em Tempo Real</h3>
                  <p className="text-[11px] sm:text-xs text-slate-500">Acompanhe as atividades do seu bot</p>
                </div>
              </div>
              <div className="flex bg-slate-100 p-1 rounded-xl w-full sm:w-auto">
                <button 
                  onClick={() => setActiveTab("messages")}
                  className={cn(
                    "flex-1 sm:flex-none px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all",
                    activeTab === "messages" ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  Mensagens
                </button>
                <button 
                  onClick={() => setActiveTab("logs")}
                  className={cn(
                    "flex-1 sm:flex-none px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all",
                    activeTab === "logs" ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  Logs
                </button>
                {!isFree && (
                  <button 
                    onClick={() => setActiveTab("leads")}
                    className={cn(
                      "flex-1 sm:flex-none px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all",
                      activeTab === "leads" ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                    )}
                  >
                    Leads
                  </button>
                )}
              </div>
            </div>
            <CardContent className="p-0 flex-1">
              <div className="h-[320px] sm:h-[400px] overflow-y-auto custom-scrollbar">
                {activeTab === "messages" ? (
                  <div className="divide-y divide-slate-50">
                    {recentMessages.length > 0 ? (
                      recentMessages.map((msg, i) => (
                        <div key={i} className="p-3 sm:p-4 hover:bg-slate-50/50 transition-colors flex items-start gap-2.5 sm:gap-4">
                          <div className={cn(
                            "h-8 w-8 sm:h-10 sm:w-10 rounded-full flex items-center justify-center shrink-0 shadow-sm font-bold text-xs",
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

      <TemplateModal 
        isOpen={showTemplateModal} 
        onClose={() => setShowTemplateModal(false)} 
      />
    </div>
  );
}
