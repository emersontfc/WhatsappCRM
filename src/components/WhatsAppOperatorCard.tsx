import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { Button } from "./ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/Card";

const commands = [
  ["Mensagens por ler", "/agentx mensagens"],
  ["Leads recentes", "/agentx leads"],
  ["Próximos envios", "/agentx agenda"],
  ["Publicar Status de texto", "/agentx status Novidades da loja"],
  ["Agendar um Status", "/agentx agendar-status amanhã às 09:00 | Novidades da loja"],
  ["Agendar mensagem", "/agentx agendar 258841234567 | amanhã às 09:00 | Bom dia!"]
];

export function WhatsAppOperatorCard({ agendaLink = true }: { agendaLink?: boolean }) {
  const [alerts, setAlerts] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    apiFetch("/api/whatsapp/operator-settings")
      .then(({ data }) => { if (active) setAlerts(data.contact_alerts); })
      .catch(() => { if (active) setUnavailable(true); });
    return () => { active = false; };
  }, []);

  const update = async (contact_alerts: boolean) => {
    setSaving(true);
    try {
      const { data } = await apiFetch("/api/whatsapp/operator-settings", {
        method: "PUT", body: JSON.stringify({ contact_alerts })
      });
      setAlerts(data.contact_alerts);
    } catch {
      toast.error("Não foi possível guardar o aviso.");
    } finally {
      setSaving(false);
    }
  };

  return <Card>
    <CardHeader><CardTitle>Comandos pelo WhatsApp</CardTitle></CardHeader>
    <CardContent className="grid gap-4">
      <p className="text-sm text-slate-600">Usa estes comandos na conversa contigo mesmo, a partir do número ligado ao AgentX.</p>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={alerts === true} disabled={alerts === null || saving}
          onChange={(event) => void update(event.target.checked)} />
        Avisar-me no WhatsApp quando um cliente escrever (até um aviso por contacto a cada 30 minutos).
      </label>
      {unavailable && <p className="text-sm text-slate-600" role="status">Preferências de aviso indisponíveis.</p>}
      <details>
        <summary className="cursor-pointer text-sm font-semibold">Ver comandos</summary>
        <ul className="mt-3 grid gap-2">
          {commands.map(([label, command]) => <li key={command} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">{label}</p>
              <code className="break-all text-xs">{command}</code>
            </div>
            <Button size="sm" variant="outline" aria-label={`Copiar comando: ${label}`} onClick={async () => {
              try {
                await navigator.clipboard.writeText(command);
                toast.success("Comando copiado");
              } catch {
                toast.error("Seleciona o texto do comando para o copiares.");
              }
            }}>Copiar</Button>
          </li>)}
        </ul>
      </details>
      {agendaLink && <Link to="/schedule" className="text-sm font-medium text-emerald-700 underline">Abrir agenda</Link>}
    </CardContent>
  </Card>;
}
