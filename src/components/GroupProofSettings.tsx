import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { Button } from "./ui/Button";

export function GroupProofSettings({ jid }: { jid: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const url = `/api/whatsapp/groups/${encodeURIComponent(jid)}/payment-proofs`;

  useEffect(() => {
    const request = new AbortController();
    setError("");
    apiFetch(url, { signal: request.signal }).then((data) => {
      if (!request.signal.aborted) setEnabled(data.enabled === true);
    }).catch((failure: Error) => {
      if (!request.signal.aborted) setError(failure.message);
    });
    return () => request.abort();
  }, [url, revision]);

  async function update(next: boolean) {
    setSaving(true);
    setError("");
    try {
      const result = await apiFetch(url, { method: "PUT", body: JSON.stringify({ enabled: next }) });
      setEnabled(result.enabled === true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível guardar a preferência.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="space-y-3 rounded-xl border border-slate-200 p-4" aria-label="Comprovativos do grupo">
    <h3 className="font-semibold">Comprovativos no grupo</h3>
    <p className="text-sm text-slate-600">O cliente inclui o número AGX do pedido no texto do comprovativo ou na legenda da imagem ou do PDF. A decisão fica a cargo de quem revê o pagamento.</p>
    <div className="flex flex-wrap items-center gap-3 text-sm">
      {enabled !== null && <label className="flex items-center gap-2 font-medium">
        <input type="checkbox" checked={enabled} disabled={saving} onChange={(event) => void update(event.target.checked)} />
        Receber comprovativos deste grupo
      </label>}
      {enabled === null && !error && <span role="status">A carregar configuração…</span>}
      {enabled === null && error && <Button type="button" variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>Tentar novamente</Button>}
      <Link to="/orders?tab=verifications" className="font-semibold text-emerald-800 underline">Rever comprovativos</Link>
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
