import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { 
  CreditCard, 
  CheckCircle2, 
  AlertCircle, 
  Zap, 
  Clock, 
  ShieldCheck, 
  Crown, 
  Check, 
  Phone, 
  MessageSquare,
  Sparkles,
  ArrowRight,
  Send,
  Users
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { cn } from "../lib/utils";

interface PlanItem {
  id?: string;
  name: string;
  price: number;
  max_connections: number;
  max_contacts: number;
  max_messages_per_day: number;
  ai_enabled: boolean;
  automation_level: string;
  features: string[];
  popular?: boolean;
}

const DEFAULT_PLANS: PlanItem[] = [
  {
    name: "Starter",
    price: 300,
    max_connections: 1,
    max_contacts: 500,
    max_messages_per_day: 150,
    ai_enabled: false,
    automation_level: "basic",
    features: [
      "1 Conexão WhatsApp",
      "Até 500 Contatos",
      "150 Mensagens / dia",
      "Kanban de Leads Comercial",
      "Exportação de Leads (CSV)",
      "Automações Básicas",
      "Suporte via WhatsApp"
    ]
  },
  {
    name: "Pro",
    price: 900,
    popular: true,
    max_connections: 2,
    max_contacts: 2500,
    max_messages_per_day: 600,
    ai_enabled: true,
    automation_level: "advanced",
    features: [
      "2 Conexões WhatsApp",
      "Até 2.500 Contatos",
      "600 Mensagens / dia",
      "Pipeline Completo de Leads",
      "Agente de IA Integrado",
      "Automações Avançadas & Menus",
      "Agendamento de Mensagens",
      "Suporte Prioritário"
    ]
  },
  {
    name: "Premium",
    price: 1800,
    max_connections: 5,
    max_contacts: 10000,
    max_messages_per_day: 2000,
    ai_enabled: true,
    automation_level: "unlimited",
    features: [
      "Até 5 Conexões WhatsApp",
      "Contatos Ilimitados (10.000+)",
      "2.000 Mensagens / dia",
      "CRM & Leads Sem Restrições",
      "IA Atendente 24/7 com Memória",
      "Disparo em Massa & Campanhas",
      "Gestão de Grupos & Comunidades",
      "Suporte VIP Dedicado"
    ]
  }
];

export default function Activate() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [subscription, setSubscription] = useState<any>(null);
  const [checkingSub, setCheckingSub] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<string>("Pro");

  useEffect(() => {
    let isMounted = true;
    const fetchSub = async () => {
      try {
        const response = await apiFetch("/api/ai/subscription");
        if (isMounted && response?.success && response.data) {
          setSubscription(response.data);
        }
      } catch (err) {
        console.error("Error fetching subscription:", err);
      } finally {
        if (isMounted) setCheckingSub(false);
      }
    };
    fetchSub();
    return () => { isMounted = false; };
  }, []);

  const handleActivate = async () => {
    if (!code.trim()) return;
    setLoading(true);
    setStatus(null);

    try {
      const data = await apiFetch("/api/auth/activate-license", {
        method: "POST",
        body: JSON.stringify({ code: code.trim() }),
      });

      setStatus({ type: "success", message: data.message || "Licença ativada com sucesso!" });
      setCode("");
      
      const subResponse = await apiFetch("/api/ai/subscription");
      if (subResponse?.success && subResponse.data) {
        setSubscription(subResponse.data);
      }

      setTimeout(() => {
        navigate("/dashboard");
      }, 1500);
    } catch (err: any) {
      console.error("Activation error:", err);
      setStatus({ type: "error", message: err.message || "Erro ao ativar senha de acesso." });
    } finally {
      setLoading(false);
    }
  };

  if (checkingSub) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent"></div>
      </div>
    );
  }

  const isAdmin = subscription?.role === "admin" || subscription?.plan === "Admin";
  const userPlan = isAdmin ? "Admin" : (subscription?.plan || "Free");
  const isFree = userPlan === "Free";
  const isActivePlan = !isFree || isAdmin;
  
  const daysLeft = subscription?.expires_at 
    ? Math.max(0, Math.ceil((new Date(subscription.expires_at).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)))
    : 0;

  const contactSupportUrl = `https://wa.me/258848858288?text=${encodeURIComponent(`Olá! Quero ativar o plano ${selectedPlan} no AgentX CRM. Pode me enviar os dados para pagamento?`)}`;

  return (
    <div className="max-w-5xl mx-auto space-y-10 animate-in fade-in duration-500 pb-16">
      
      {/* 👑 ADMIN BANNER */}
      {isAdmin && (
        <Card className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border-amber-200 shadow-sm overflow-hidden relative">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-amber-500 text-white rounded-xl shadow-md">
                <Crown size={24} />
              </div>
              <div>
                <CardTitle className="text-xl font-bold text-amber-950 flex items-center gap-2">
                  Conta de Administrador Ativa
                  <Badge className="bg-amber-500 text-white border-none text-[10px] font-bold uppercase tracking-wider">
                    Acesso Total
                  </Badge>
                </CardTitle>
                <CardDescription className="text-amber-800 text-sm">
                  Você possui privilégios de Administrador com acesso irrestrito a todos os recursos do AgentX.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-1">
            <div className="bg-white/80 p-3 rounded-xl border border-amber-100">
              <p className="text-slate-500 font-medium">Contatos</p>
              <p className="text-base font-bold text-slate-900">Ilimitados</p>
            </div>
            <div className="bg-white/80 p-3 rounded-xl border border-amber-100">
              <p className="text-slate-500 font-medium">Mensagens / dia</p>
              <p className="text-base font-bold text-slate-900">Sem limite</p>
            </div>
            <div className="bg-white/80 p-3 rounded-xl border border-amber-100">
              <p className="text-slate-500 font-medium">Agente de IA</p>
              <p className="text-base font-bold text-emerald-600">Habilitado 24/7</p>
            </div>
            <div className="bg-white/80 p-3 rounded-xl border border-amber-100">
              <p className="text-slate-500 font-medium">Painel Admin</p>
              <button 
                onClick={() => navigate("/admin/packs")}
                className="text-base font-bold text-amber-700 hover:underline flex items-center gap-1"
              >
                Gerenciar ➔
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 🛡️ ACTIVE SUBSCRIPTION STATUS (Non-admin) */}
      {!isAdmin && isActivePlan && (
        <Card className="bg-emerald-50/70 border-emerald-200">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2 text-emerald-800">
              <ShieldCheck className="text-emerald-600" size={24} />
              <CardTitle className="text-lg">Sua Assinatura está Ativa</CardTitle>
            </div>
            <CardDescription className="text-emerald-700">
              Você está utilizando o plano <strong>{userPlan}</strong> com todos os recursos comerciais liberados.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white p-4 rounded-xl border border-emerald-100 shadow-sm">
              <p className="text-[10px] font-bold uppercase text-slate-400 mb-1">Plano Atual</p>
              <p className="text-xl font-bold text-emerald-600">{userPlan}</p>
            </div>
            <div className="bg-white p-4 rounded-xl border border-emerald-100 shadow-sm">
              <p className="text-[10px] font-bold uppercase text-slate-400 mb-1">Validade do Acesso</p>
              <p className="text-xl font-bold text-emerald-600">
                {subscription?.expires_at ? `${daysLeft} dias restantes` : "Vitalício"}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 🚀 CABEÇALHO COMERCIAL DE PLANOS */}
      <div className="text-center space-y-3">
        <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-xs px-3 py-1 font-bold">
          <Sparkles size={13} className="mr-1 text-emerald-600 inline" /> Planos & Atualizações
        </Badge>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
          Potencialize suas Vendas e Gestão de Leads
        </h1>
        <p className="text-slate-500 max-w-2xl mx-auto text-sm sm:text-base">
          Escolha o plano ideal para a sua operação. Conecte seu WhatsApp, capture leads em tempo real e atenda com automação inteligente.
        </p>
      </div>

      {/* 📦 GRID DE PLANOS COMERCIAIS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
        {DEFAULT_PLANS.map((planItem) => {
          const isSelected = selectedPlan === planItem.name;
          const isCurrentPlan = userPlan.toLowerCase() === planItem.name.toLowerCase();

          return (
            <div
              key={planItem.name}
              onClick={() => setSelectedPlan(planItem.name)}
              className={cn(
                "relative rounded-3xl p-6 transition-all duration-300 flex flex-col justify-between cursor-pointer border-2 bg-white",
                planItem.popular 
                  ? "border-emerald-500 shadow-xl shadow-emerald-500/10 scale-100 md:scale-105 z-10" 
                  : "border-slate-200 hover:border-slate-300 shadow-sm",
                isSelected && !planItem.popular && "border-slate-900"
              )}
            >
              {planItem.popular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-[11px] font-bold uppercase tracking-wider px-3.5 py-1 rounded-full shadow-md flex items-center gap-1">
                  <Sparkles size={12} /> Mais Recomendado
                </div>
              )}

              <div>
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold text-slate-900">{planItem.name}</h3>
                  {isCurrentPlan && (
                    <Badge variant="outline" className="border-emerald-500 text-emerald-700 bg-emerald-50 text-[10px]">
                      Plano Atual
                    </Badge>
                  )}
                </div>

                <div className="mt-4 mb-6">
                  <span className="text-3xl sm:text-4xl font-black text-slate-900">{planItem.price} MT</span>
                  <span className="text-slate-500 text-xs font-semibold ml-1.5">/ mês</span>
                </div>

                <ul className="space-y-3 mb-6 text-xs text-slate-600">
                  {planItem.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <div className="p-0.5 rounded-full bg-emerald-100 text-emerald-700 shrink-0 mt-0.5">
                        <Check size={12} strokeWidth={3} />
                      </div>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="pt-4 border-t border-slate-100">
                <a
                  href={`https://wa.me/258848858288?text=${encodeURIComponent(`Olá! Quero assinar o plano *${planItem.name}* (${planItem.price} MT/mês) no AgentX CRM. Como posso pagar por M-Pesa / eMola?`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "w-full py-3 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-sm",
                    planItem.popular
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20"
                      : "bg-slate-900 hover:bg-slate-800 text-white"
                  )}
                >
                  <MessageSquare size={14} />
                  Contratar via WhatsApp
                </a>
              </div>
            </div>
          );
        })}
      </div>

      {/* 💳 INSTRUÇÕES DE PAGAMENTO M-PESA & EMOLA */}
      <Card className="border-slate-200 bg-gradient-to-br from-slate-50 to-emerald-50/30 overflow-hidden">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Zap size={20} className="text-amber-500" />
            Pagamento Rápido via M-Pesa ou eMola (Moçambique)
          </CardTitle>
          <CardDescription className="text-xs">
            Ativação imediata em 3 passos simples. Sem cartão de crédito necessário.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm space-y-2">
            <div className="w-7 h-7 rounded-full bg-red-100 text-red-600 font-bold flex items-center justify-center text-xs">
              1
            </div>
            <p className="font-bold text-slate-900">Envie o Pagamento</p>
            <p className="text-slate-600 text-[11px] leading-relaxed">
              Transfira o valor do plano escolhido via M-Pesa ou eMola:
            </p>
            <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100 font-mono text-[11px] space-y-1">
              <p><strong>M-Pesa:</strong> 84 885 8288</p>
              <p><strong>eMola:</strong> 87 620 0662</p>
              <p className="text-[10px] text-slate-500 font-sans">Titular: Emerson Charles</p>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm space-y-2">
            <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-600 font-bold flex items-center justify-center text-xs">
              2
            </div>
            <p className="font-bold text-slate-900">Envie o Comprovante</p>
            <p className="text-slate-600 text-[11px] leading-relaxed">
              Envie o print ou SMS de confirmação para o suporte no WhatsApp:
            </p>
            <a
              href="https://wa.me/258848858288?text=Ola%21+Acabei+de+fazer+o+pagamento+do+meu+plano+no+AgentX+CRM.+Segue+o+comprovante%3A"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-emerald-600 font-bold hover:underline pt-1 text-[11px]"
            >
              <Phone size={13} /> Enviar Comprovante (+258 84 885 8288)
            </a>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm space-y-2">
            <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-600 font-bold flex items-center justify-center text-xs">
              3
            </div>
            <p className="font-bold text-slate-900">Receba sua Senha</p>
            <p className="text-slate-600 text-[11px] leading-relaxed">
              Você receberá imediatamente a senha exclusiva de ativação para inserir no campo abaixo e desbloquear o sistema.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 🔑 FORMULÁRIO DE ATIVAÇÃO COM CÓDIGO */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <CreditCard className="text-emerald-600" size={20} />
            Ativar Senha de Acesso (Licença)
          </CardTitle>
          <CardDescription className="text-xs">
            Já tem a sua senha fornecida pelo administrador? Insira abaixo para ativar ou renovar seu plano na hora.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Senha de Ativação
            </label>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <Input 
                placeholder="Ex: XXXX-XXXX-XXXX" 
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="font-mono tracking-widest text-sm uppercase h-11"
                disabled={loading}
              />
              <Button 
                onClick={handleActivate} 
                disabled={loading || !code.trim()}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 h-11 shrink-0"
              >
                {loading ? "Ativando..." : "Ativar Licença"}
              </Button>
            </div>
          </div>

          {status && (
            <div className={cn(
              "p-3.5 rounded-xl flex items-start gap-2.5 border text-xs font-medium",
              status.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"
            )}>
              {status.type === "success" ? <CheckCircle2 size={18} className="shrink-0 mt-0.5" /> : <AlertCircle size={18} className="shrink-0 mt-0.5" />}
              <p>{status.message}</p>
            </div>
          )}
        </CardContent>
        <CardFooter className="bg-slate-50 border-t border-slate-100 py-3 text-xs text-slate-500 flex justify-between items-center">
          <span>Precisa de ajuda? Fale conosco a qualquer momento.</span>
          <a 
            href="https://wa.me/258848858288" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-emerald-600 font-bold hover:underline"
          >
            Suporte WhatsApp ➔
          </a>
        </CardFooter>
      </Card>

    </div>
  );
}
