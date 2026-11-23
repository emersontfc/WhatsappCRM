import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, RefreshCw } from "lucide-react";
import { ApiError, apiFetch } from "../lib/api";
import { Button } from "./ui/Button";

const modules = [
  ["crm", "Contactos e mensagens", "/messages"],
  ["agent", "Agente de IA", "/agent"],
  ["agenda", "Agenda de mensagens", "/schedule"],
  ["sales", "Catálogo, vendas e pagamentos", "/orders"],
  ["delivery", "Entregas digitais", "/digital-orders"],
  ["bookings", "Marcações e lembretes", "/appointments"],
  ["groups", "Moderação de grupos", "/groups"]
] as const;

type Module = typeof modules[number][0];
type State = "ready" | "migration_required" | "unverified" | "unavailable";
type OperationStatus = {
  success: true;
  modules: Record<Module, State>;
  release: string | null;
  whatsapp: string;
  schedulerEnabled: boolean;
  deliveryWorker: { state: "starting" | "running" | "unavailable" | "disabled"; lastSuccessAt: string | null };
};

const labels: Record<State, string> = {
  ready: "Base de dados verificada",
  migration_required: "Atualização da base de dados necessária",
  unverified: "Base de dados por verificar",
  unavailable: "Base de dados indisponível"
};

function badge(status: OperationStatus, module: Module) {
  const state = status.modules[module];
  if (state !== "ready") return labels[state] ?? labels.unavailable;
  if ((module === "agenda" || module === "bookings") && !status.schedulerEnabled) return "Agendador desligado";
  if (module === "delivery") {
    if (status.deliveryWorker.state === "disabled") return "Processamento integrado desligado";
    if (status.deliveryWorker.state === "starting") return "A iniciar o processamento";
    if (status.deliveryWorker.state === "unavailable") return "Processamento interrompido";
    return "Processador respondeu";
  }
  return labels.ready;
}

export function OperationsStatus({ accountId }: { accountId: string }) {
  const [status, setStatus] = useState<OperationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const load = async () => {
      if (busy || document.hidden) return;
      busy = true;
      setLoading(true);
      try {
        const result: OperationStatus = await apiFetch("/api/operations", { signal: controller.signal, timeout: 10000 });
        if (!result?.success || !result.modules || !result.deliveryWorker) throw new Error("Estado da operação indisponível.");
        if (controller.signal.aborted) return;
        setStatus(result);
        setError(null);
      } catch (failure) {
        if (controller.signal.aborted) return;
        const requestId = failure instanceof ApiError ? failure.requestId : undefined;
        setError(requestId ? `Não foi possível confirmar o estado. Pedido ${requestId}.` : "Não foi possível confirmar o estado da operação.");
      } finally {
        busy = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(load, 30000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [accountId, refresh]);

  return <details className="rounded-2xl border border-slate-200 bg-white p-4" open={Boolean(error)}>
    <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
      <Activity size={17} className="text-emerald-700" /> Estado da operação
      {status?.whatsapp === "connected" && !error && <span className="text-xs font-medium text-emerald-800">WhatsApp ligado</span>}
      {status && status.whatsapp !== "connected" && !error && <span className="text-xs font-medium text-amber-800">WhatsApp desligado</span>}
      {status && !error && modules.some(([name]) => status.modules[name] !== "ready") && <span className="text-xs text-amber-800">Módulos por verificar</span>}
      {error && <span className="text-xs text-amber-800">Estado indisponível</span>}
    </summary>
    <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
      {error && <p role="status" className="text-sm text-amber-800">{error}</p>}
      {!status && !error && <p role="status" className="text-sm text-slate-600">A verificar os serviços…</p>}
      {status && !error && <>
        {status.whatsapp !== "connected" && <Link className="text-sm font-semibold text-emerald-800 hover:underline"
          to="/dashboard#ligar-whatsapp">Abrir ligação do WhatsApp</Link>}
        <ul className="grid gap-2 sm:grid-cols-2">
          {modules.map(([name, title, path]) => <li key={name} className="rounded-xl bg-slate-50 p-3 text-sm">
            <Link className="font-semibold text-slate-900 hover:underline" to={path}>{title}</Link>
            <p className="text-xs text-slate-600">{badge(status, name)}</p>
          </li>)}
        </ul>
      </>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" size="sm" className="gap-1.5" disabled={loading} onClick={() => setRefresh((n) => n + 1)}>
          <RefreshCw size={14} /> Atualizar estado
        </Button>
        {status?.release && <span className="font-mono text-xs text-slate-500">Versão {status.release.slice(0, 12)}</span>}
      </div>
    </div>
  </details>;
}
