import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { whatsappCommandExamples, whatsappCommandsSettingsPath } from "../lib/agentxGuides";
import { Button } from "./ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/Card";

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
    <CardHeader><CardTitle>Comandos e avisos pelo WhatsApp</CardTitle></CardHeader>
    <CardContent className="grid gap-4">
      <div className="space-y-2 text-sm text-slate-700">
        <p>Do teu WhatsApp autorizado, abre uma conversa individual com o número ligado ao AgentX. Envia <code className="font-semibold text-emerald-900">/agentx</code> para veres os comandos.</p>
        <Link to={whatsappCommandsSettingsPath} className="inline-block font-semibold text-emerald-800 underline underline-offset-2">Autorizar números no perfil</Link>
        <p className="text-xs text-slate-600">Também podes escrever na conversa contigo mesmo a partir do próprio número ligado.</p>
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-semibold">Ver comandos</summary>
        <ul className="mt-3 grid gap-2">
          {whatsappCommandExamples.map(({ label, text, detail }) => <li key={text} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{label}</p>
              <code className="break-words text-xs">{text}</code>
              <p className="mt-1 text-xs text-slate-600">{detail}</p>
            </div>
            <Button type="button" size="sm" variant="outline" aria-label={`Copiar comando ${label}`} onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                toast.success("Comando copiado");
              } catch {
                toast.error("Seleciona o texto do comando para o copiares.");
              }
            }}>Copiar</Button>
          </li>)}
        </ul>
      </details>
      <div className="space-y-2 border-t border-slate-100 pt-3">
        <div className="space-y-1 text-sm text-slate-700">
          <p className="font-semibold text-slate-900">Avisos de atendimento humano</p>
          <p>Quando a IA encaminha uma conversa, o AgentX tenta enviar um aviso para o número do administrador indicado no perfil. Em Mensagens, usa o filtro Humano para encontrar a conversa e responder.</p>
          <Link to="/messages" className="inline-block font-semibold text-emerald-800 underline underline-offset-2">Abrir Mensagens</Link>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={alerts === true} disabled={alerts === null || saving}
            onChange={(event) => void update(event.target.checked)} />
          Avisar no número ligado quando um cliente escrever, até uma vez por contacto a cada 30 minutos.
        </label>
        {unavailable && <p className="text-sm text-slate-600" role="status">Preferências de aviso indisponíveis.</p>}
        <p className="text-xs text-slate-600">Em Vendedor, o WhatsApp para avisos recebe notificações de pagamento. A aprovação é feita no painel.</p>
      </div>
      {agendaLink && <Link to="/schedule" className="text-sm font-medium text-emerald-700 underline">Abrir agenda</Link>}
    </CardContent>
  </Card>;
}
