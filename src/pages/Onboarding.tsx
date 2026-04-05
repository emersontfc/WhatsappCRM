import { useState } from "react";
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
  Bot
} from "lucide-react";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { apiFetch } from "../lib/api";
import { toast } from "sonner";
import { supabase } from "../supabase";

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
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

  const handleSelect = (field: string, value: string) => {
    setData(prev => ({ ...prev, [field]: value }));
    if (step < 3) setStep(step + 1);
  };

  const activateBot = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não encontrado");

      // 1. Enable AI Agent
      await apiFetch("/api/agent/config", {
        method: "POST",
        body: JSON.stringify({
          is_active: true,
          provider: "gemini",
          model: "gemini-3-flash-preview",
          instructions: `Você é um assistente virtual para um negócio de ${data.businessType}. Seu objetivo principal é ${data.goal}. Seja cordial, prestativo e direto.`
        })
      });

      // 2. Create a default automation if none exists
      const { count } = await supabase
        .from("automations")
        .select("id", { count: "exact" })
        .eq("user_id", user.id);

      if (count === 0) {
        await supabase.from("automations").insert({
          user_id: user.id,
          name: "Boas-vindas",
          trigger: "keyword",
          keyword: "ola, oi, bom dia, boa tarde, boa noite",
          response: "Olá! Seja bem-vindo. Como posso te ajudar hoje?",
          active: true
        });
      }

      toast.success("Smart Bot ativado com sucesso!");
      navigate("/dashboard");
    } catch (err: any) {
      console.error("Onboarding error:", err);
      toast.error("Erro ao ativar o bot: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const currentStep = steps[step - 1];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="max-w-md w-full space-y-8">
        {/* Progress Bar */}
        <div className="flex justify-center gap-2 mb-8">
          {[1, 2, 3].map((s) => (
            <div 
              key={s} 
              className={`h-1.5 w-12 rounded-full transition-all duration-500 ${
                s <= step ? "bg-emerald-500" : "bg-slate-200"
              }`}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          {step <= 2 ? (
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
            </motion.div>
          ) : (
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

              <Button 
                onClick={activateBot}
                disabled={loading}
                className="w-full h-14 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest shadow-lg shadow-emerald-500/20 transition-all"
              >
                {loading ? <RefreshCw className="animate-spin mr-2" /> : "ATIVAR SMART BOT"}
              </Button>

              <button 
                onClick={() => setStep(1)}
                className="text-xs font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest"
              >
                Recomeçar configuração
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
