import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { 
  ShoppingBag, 
  Briefcase, 
  MoreHorizontal, 
  MessageSquare, 
  UserPlus, 
  RefreshCw,
  CheckCircle2,
  ArrowRight,
  Bot,
  AlertCircle,
  ChevronLeft,
  X
} from "lucide-react";
import { Button } from "../components/ui/Button";
import { apiFetch } from "../lib/api";
import { toast } from "soner";
import { supabase } from "../supabase";

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [data, setData] = useState({
    businessType: "",
    goal: ""
  });

  const steps = [
    {
      title: "Qual o seu tipo de negócio?",
      description: "Isso nos ajuda a configurar as melhores respostas para você.",
      options: [
        { id: "products", label: "Venda de Produtos", icon: ShoppingBag },
        { id: "services", label: "Prestação de Serviços", icon: Briefcase },
        { id: "other", label: "Outros", icon: MoreHorizontal },
      ],
      field: "businessType"
    },
    {
      title: "O que você quer que o Bot faça?",
      description: "Escolha o objetivo principal da sua automação.",
      options: [
        { id: "respond", label: "Responder Clientes", icon: MessageSquare },
        { id: "capture", label: "Capturar Leads", icon: UserPlus },
        { id: "followup", label: "Seguimento Automático", icon: RefreshCw },
      ],
      field: "goal"
    }
  ];

  // Check if user should see onboarding (only if they have a premium subscription)
  useEffect(() => {
    const checkUserPlan = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          navigate("/login");
          return;
        }

        // Check if user has a subscription (plan)
        const { data: subscription, error: subError } = await supabase
          .from("subscriptions")
          .select("plan, status")
          .eq("user_id", user.id)
          .single();

        if (subError && subError.code !== 'PGRST116') {
          console.error("Error checking subscription:", subError);
        }

        // If no subscription or plan is 'Free', redirect to dashboard
        if (!subscription || subscription.plan === "Free") {
          navigate("/dashboard");
          return;
        }

        // Check if user already completed onboarding
        const { data: userProfile } = await supabase
          .from("users")
          .select("id")
          .eq("id", user.id)
          .single();

        if (userProfile) {
          setChecking(false);
        }
      } catch (err) {
        console.error("Error in checkUserPlan:", err);
        setChecking(false);
      }
    };

    checkUserPlan();
  }, [navigate]);

  const handleSelect = (field: string, value: string) => {
    setError(null);
    setData(prev => ({ ...prev, [field]: value }));
    if (step < steps.length) {
      setStep(step + 1);
    } else {
      setStep(3);
    }
  };

  const skipOnboarding = async () => {
    setLoading(true);
    try {
      toast.success("Configuração pulada! Bem-vindo ao Agentex 🚀");
      setTimeout(() => {
        navigate("/dashboard");
      }, 800);
    } catch (err: any) {
      console.error("Error skipping onboarding:", err);
      toast.error("Erro ao pular configuração");
    } finally {
      setLoading(false);
    }
  };

  const activateBot = async () => {
    if (!data.businessType || !data.goal) {
      setError("Por favor, complete todas as etapas antes de ativar o bot");
      toast.error("Configuração incompleta");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não encontrado");

      // 1. Enable AI Agent
      const agentResponse = await apiFetch("/api/agent/config", {
        method: "POST",
        body: JSON.stringify({
          is_active: true,
          provider: "gemini",
          model: "gemini-3-flash-preview",
          instructions: `Você é um assistente virtual para um negócio de ${data.businessType}. Seu objetivo principal é ${data.goal}. Seja cordial, prestativo e direto.`
        })
      });

      if (!agentResponse.ok) {
        throw new Error("Erro ao ativar o agente IA");
      }

      // 2. Create a default automation if none exists
      try {
        const { count, error: countError } = await supabase
          .from("automations")
          .select("id", { count: "exact" })
          .eq("user_id", user.id);

        if (countError) {
          console.warn("Warning checking automations:", countError);
        }

        if (!count || count === 0) {
          const { error: insertError } = await supabase.from("automations").insert({
            user_id: user.id,
            name: "Boas-vindas",
            trigger: "keyword",
            keyword: "ola, oi, bom dia, boa tarde, boa noite",
            response: "Olá! Seja bem-vindo. Como posso te ajudar hoje?",
            active: true
          });

          if (insertError) {
            console.warn("Warning creating default automation:", insertError);
          }
        }
      } catch (err) {
        console.warn("Error managing automations:", err);
      }

      toast.success("Smart Bot ativado com sucesso! 🚀");
      
      setTimeout(() => {
        navigate("/dashboard");
      }, 1000);
    } catch (err: any) {
      console.error("Onboarding error:", err);
      const errorMessage = err.message || "Erro ao ativar o bot";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent"></div>
      </div>
    );
  }

  const currentStep = step <= steps.length ? steps[step - 1] : null;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="max-w-md w-full space-y-8">
        {/* Header with Skip Button */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex justify-center gap-2 flex-1">
            {[1, 2, 3].map((s) => (
              <div 
                key={s} 
                className={`h-1.5 w-12 rounded-full transition-all duration-500 ${
                  s <= step ? "bg-emerald-500" : "bg-slate-200"
                }`}
              />
            ))}
          </div>
          
          {/* Skip Button - Always visible */}
          <button
            onClick={skipOnboarding}
            disabled={loading}
            className="ml-4 p-2 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Pular configuração"
          >
            <X size={20} className="text-slate-400 hover:text-slate-600" />
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700"
          >
            <AlertCircle size={20} className="flex-shrink-0" />
            <p className="text-sm font-medium">{error}</p>
          </motion.div>
        )}

        <AnimatePresence mode="wait">
          {step <= 2 && currentStep ? (
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="text-center space-y-2">
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                  {currentStep.title}
                </h1>
                <p className="text-slate-500 text-sm">
                  {currentStep.description}
                </p>
              </div>

              <div className="grid gap-3">
                {currentStep.options.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => handleSelect(currentStep.field, opt.id)}
                    className="flex items-center gap-4 p-4 bg-white border border-slate-100 rounded-2xl hover:border-emerald-500 hover:bg-emerald-50/50 transition-all text-left group shadow-sm"
                  >
                    <div className="h-12 w-12 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-emerald-100 group-hover:text-emerald-600 transition-colors">
                      <opt.icon size={24} />
                    </div>
                    <span className="font-bold text-slate-700 group-hover:text-slate-900">
                      {opt.label}
                    </span>
                    <ArrowRight size={16} className="ml-auto text-slate-300 group-hover:text-emerald-500" />
                  </button>
                ))}
              </div>

              {step > 1 && (
                <button 
                  onClick={() => setStep(step - 1)}
                  className="flex items-center justify-center gap-2 text-xs font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest w-full py-2"
                >
                  <ChevronLeft size={16} />
                  Voltar
                </button>
              )}
            </motion.div>
          ) : step === 3 ? (
            <motion.div
              key="final"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center space-y-8"
            >
              <div className="relative mx-auto w-24 h-24">
                <div className="absolute inset-0 bg-emerald-500/20 blur-3xl rounded-full animate-pulse" />
                <div className="relative h-24 w-24 bg-white rounded-3xl flex items-center justify-center text-emerald-600 shadow-xl border border-emerald-100">
                  <Bot size={48} />
                </div>
              </div>

              <div className="space-y-2">
                <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
                  Tudo pronto!
                </h1>
                <p className="text-slate-500">
                  Seu bot está configurado e pronto para começar a trabalhar.
                </p>
              </div>

              <div className="bg-emerald-50 p-6 rounded-3xl border border-emerald-100 space-y-4 text-left">
                <div className="flex items-center gap-3 text-emerald-700">
                  <CheckCircle2 size={20} />
                  <span className="text-sm font-bold">IA Ativada</span>
                </div>
                <div className="flex items-center gap-3 text-emerald-700">
                  <CheckCircle2 size={20} />
                  <span className="text-sm font-bold">Captura de Leads Ativada</span>
                </div>
                <div className="flex items-center gap-3 text-emerald-700">
                  <CheckCircle2 size={20} />
                  <span className="text-sm font-bold">Seguimento Automático Pronto</span>
                </div>
              </div>

              <div className="space-y-3">
                <Button 
                  onClick={activateBot}
                  disabled={loading}
                  className="w-full h-14 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="animate-spin mr-2" size={20} />
                      Ativando...
                    </>
                  ) : (
                    "ATIVAR SMART BOT"
                  )}
                </Button>

                {!loading && (
                  <button 
                    onClick={() => setStep(1)}
                    className="text-xs font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest w-full"
                  >
                    Editar configuração
                  </button>
                )}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
