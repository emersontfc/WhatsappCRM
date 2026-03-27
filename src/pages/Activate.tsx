import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { CreditCard, CheckCircle2, AlertCircle, Zap, Clock, ShieldCheck } from "lucide-react";
import { apiFetch } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "../components/ui/Card";
import { cn } from "../lib/utils";

export default function Activate() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [subscription, setSubscription] = useState<any>(null);
  const [checkingSub, setCheckingSub] = useState(true);

  useEffect(() => {
    const fetchSub = async () => {
      try {
        const response = await apiFetch("/api/ai/subscription");
        if (response.success) {
          setSubscription(response.data);
        }
      } catch (err) {
        console.error("Error fetching subscription:", err);
      } finally {
        setCheckingSub(false);
      }
    };
    fetchSub();
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

      setStatus({ type: "success", message: data.message });
      setCode("");
      
      // Refresh subscription data
      const subResponse = await apiFetch("/api/ai/subscription");
      if (subResponse.success) setSubscription(subResponse.data);

      // Redirect to dashboard after a short delay to show success message
      setTimeout(() => {
        window.location.href = "/dashboard";
      }, 2000);
    } catch (err: any) {
      console.error("Activation error:", err);
      setStatus({ type: "error", message: err.message || "Erro ao ativar senha." });
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

  const isPremium = subscription?.plan === "Premium" || subscription?.role === "admin";
  const daysLeft = subscription?.expires_at 
    ? Math.ceil((new Date(subscription.expires_at).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {isPremium && (
        <Card className="bg-emerald-50 border-emerald-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-800">
              <ShieldCheck className="text-emerald-600" />
              Sua Conta está Ativa
            </CardTitle>
            <CardDescription className="text-emerald-700">
              Você já possui um plano {subscription.plan} ativo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white p-4 rounded-xl border border-emerald-100">
                <p className="text-[10px] font-bold uppercase text-slate-500 mb-1">Plano</p>
                <p className="text-lg font-bold text-emerald-600">{subscription.plan}</p>
              </div>
              <div className="bg-white p-4 rounded-xl border border-emerald-100">
                <p className="text-[10px] font-bold uppercase text-slate-500 mb-1">Expiração</p>
                <p className="text-lg font-bold text-emerald-600">
                  {subscription.expires_at ? new Date(subscription.expires_at).toLocaleDateString() : "Vitalício"}
                </p>
              </div>
            </div>
            {subscription.expires_at && (
              <div className="flex items-center gap-2 text-sm text-emerald-700 bg-white/50 p-3 rounded-lg">
                <Clock size={16} />
                <span>Você ainda tem <strong>{daysLeft} dias</strong> de acesso premium.</span>
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button variant="outline" className="w-full border-emerald-200 text-emerald-700 hover:bg-emerald-100" onClick={() => navigate("/dashboard")}>
              Ir para o Dashboard
            </Button>
          </CardFooter>
        </Card>
      )}

      <Card className={cn(isPremium && "opacity-50 pointer-events-none")}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="text-emerald-600" />
            {isPremium ? "Renovar ou Alterar Senha" : "Ativar Senha Premium"}
          </CardTitle>
          <CardDescription>
            Insira a senha premium recebida após o pagamento via M-Pesa ou eMola para liberar os recursos do sistema.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Senha de Ativação</label>
            <div className="flex gap-2">
              <Input 
                placeholder="Ex: XXXX-XXXX-XXXX" 
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="font-mono tracking-widest"
                disabled={loading}
              />
              <Button onClick={handleActivate} disabled={loading || !code}>
                {loading ? "Ativando..." : "Ativar"}
              </Button>
            </div>
          </div>

          {status && (
            <div className={cn(
              "p-4 rounded-xl flex items-start gap-3 border",
              status.type === "success" ? "bg-emerald-50 border-emerald-100 text-emerald-800" : "bg-red-50 border-red-100 text-red-800"
            )}>
              {status.type === "success" ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
              <p className="text-sm font-medium">{status.message}</p>
            </div>
          )}

          {!isPremium && (
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 space-y-4">
              <h4 className="font-semibold text-slate-900 flex items-center gap-2">
                <Zap size={18} className="text-amber-500" />
                Como funciona?
              </h4>
              <ol className="text-sm text-slate-600 space-y-3 list-decimal list-inside">
                <li>Realize o pagamento via M-Pesa ou eMola para o número do administrador.</li>
                <li>Envie o comprovante para o suporte.</li>
                <li>Receba sua senha premium única.</li>
                <li>Insira a senha acima e clique em "Ativar".</li>
                <li>Seu plano será liberado instantaneamente.</li>
              </ol>
            </div>
          )}
        </CardContent>
        <CardFooter className="bg-slate-50/50 border-t border-slate-100 rounded-b-xl py-4">
          <p className="text-xs text-slate-400 text-center w-full">
            Precisa de ajuda? Entre em contato com o suporte técnico.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
