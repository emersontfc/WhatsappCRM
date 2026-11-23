import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, Circle, FileText, Package, RefreshCw, Wallet } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { apiFetch } from "../lib/api";
import { sellerMethodKeys, sellerMethods, type PaymentDestinations, type SellerOverview, type SellerSettings } from "../../shared/seller";

const field = "block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-emerald-700";
const action = "inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 focus-visible:ring-2 focus-visible:ring-emerald-700";
const orderStatus: Record<string, string> = {
  created: "Novo", awaiting_payment: "Aguarda pagamento", verification_pending: "Rever comprovativo",
  paid: "Pago · entrega pendente", fulfilled: "Entregue", rejected: "Pagamento rejeitado",
  cancelled: "Cancelado", refunded: "Reembolsado", expired: "Expirado", failed: "Falhou"
};

export default function Seller() {
  const [overview, setOverview] = useState<SellerOverview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false);
  const settingsSection = useRef<HTMLElement>(null);

  useEffect(() => {
    const request = new AbortController();
    setLoading(true);
    setError("");
    apiFetch("/api/commerce/seller", { signal: request.signal }).then(({ data }) => {
      setOverview(data);
    }).catch((failure) => {
      if (!request.signal.aborted) {
        setOverview(null);
        setError(failure instanceof Error ? failure.message : "Não foi possível carregar o Vendedor.");
      }
    }).finally(() => {
      if (!request.signal.aborted) setLoading(false);
    });
    return () => request.abort();
  }, [revision]);

  const complete = overview && overview.agentActive && overview.whatsappConnected && overview.readyProducts > 0 && Boolean(overview.settings);
  return <div className="mx-auto max-w-6xl space-y-6 pb-8">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-sm text-slate-600">Prepara a loja e acompanha as vendas do WhatsApp.</p>
      </div>
      <Button variant="outline" disabled={loading} onClick={() => setRevision((value) => value + 1)} className="gap-2">
        <RefreshCw size={16} aria-hidden /> Atualizar
      </Button>
    </header>

    {error && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">{error}</p>}
    {loading && !overview && <p role="status" className="text-sm text-slate-600">A consultar a tua loja…</p>}
    {overview && <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <section aria-labelledby="seller-setup" className="rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 p-5">
            <h2 id="seller-setup" className="text-lg font-semibold">Preparar a primeira venda</h2>
            {complete && <p className="mt-1 text-sm text-emerald-800">Configuração concluída. Testa o percurso com outro número de WhatsApp.</p>}
          </div>
          <ul className="divide-y divide-slate-100">
            <SetupStep ready={overview.whatsappConnected} title="Ligar o WhatsApp"
              detail={overview.whatsappConnected ? "Ligado" : "Liga o número da loja no painel."} href="/dashboard#ligar-whatsapp" />
            <SetupStep ready={overview.agentActive} title="Ativar o agente"
              detail={overview.agentActive ? "Ativo para vendas" : "Seleciona Vendas ou Multifuncional e ativa o agente."}
              href="/agent?focus=specialization" />
            <SetupStep ready={overview.readyProducts > 0} title="Preparar o catálogo"
              detail={overview.readyProducts > 0 ? `${overview.readyProducts} de ${overview.products} produtos prontos para venda.`
                : "Define preço, stock e o ficheiro dos produtos digitais."} href="/orders?tab=products" />
            <SetupStep ready={Boolean(overview.settings)} title="Definir como receber"
              detail={overview.settings ? sellerMethodKeys.filter((method) => overview.settings?.payment_destinations[method])
                .map((method) => sellerMethods[method]).join(" · ") : "Configura M-Pesa, e-Mola ou transferência bancária."}
              onClick={() => { setEditing(true); settingsSection.current?.scrollIntoView({ block: "start" }); }} />
          </ul>
        </section>

        <section ref={settingsSection} aria-labelledby="seller-payment" className="scroll-mt-4 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="seller-payment" className="flex items-center gap-2 text-lg font-semibold"><Wallet size={18} aria-hidden /> Pagamento e avisos</h2>
            {overview.settings && !editing && <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Editar</Button>}
          </div>
          {overview.settings && !editing
            ? <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
                {sellerMethodKeys.map((method) => {
                  const destination = overview.settings?.payment_destinations[method];
                  return destination && <div key={method} className="contents">
                    <dt className="text-slate-600">{sellerMethods[method]}</dt>
                    <dd className="break-words">{destination.recipient} · {destination.name}</dd>
                  </div>;
                })}
                <dt className="text-slate-600">Aviso por WhatsApp</dt>
                <dd>{overview.settings.notification_phone ? `+${overview.settings.notification_phone}` : "Apenas no painel"}</dd>
              </dl>
            : <PaymentSettings settings={overview.settings} onSave={(settings) => {
                setOverview((current) => current && { ...current, settings });
                setEditing(false);
              }} />}
          <p className="mt-4 text-sm text-slate-600">Confirma o recebimento no prestador antes de aprovar pelo painel. O número de aviso apenas recebe notificações.</p>
        </section>
      </div>

      <div className="space-y-6">
        <section aria-labelledby="seller-actions" className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 id="seller-actions" className="text-lg font-semibold">A tratar</h2>
          <div className="mt-3 grid gap-2">
            <Link className="flex min-h-12 items-center gap-3 rounded-xl bg-amber-50 px-3 py-2 font-medium text-amber-950 hover:bg-amber-100" to="/orders?tab=verifications">
              <FileText size={16} aria-hidden /> Comprovativos pendentes <strong className="ml-auto">{overview.pendingReviews}</strong>
            </Link>
            <Link className="flex min-h-12 items-center gap-3 rounded-xl bg-slate-100 px-3 py-2 font-medium hover:bg-slate-200" to="/orders?status=paid">
              <Package size={16} aria-hidden /> Entregas por concluir <strong className="ml-auto">{overview.pendingDeliveries}</strong>
            </Link>
          </div>
        </section>
        <section aria-labelledby="seller-orders" className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="seller-orders" className="text-lg font-semibold">Pedidos recentes</h2>
            <Link className={action} to="/orders">Ver pedidos <ArrowRight size={14} aria-hidden /></Link>
          </div>
          {overview.orders.length === 0
            ? <p className="mt-3 text-sm text-slate-600">Os pedidos criados no WhatsApp aparecem aqui.</p>
            : <ul className="mt-2 divide-y divide-slate-100">
                {overview.orders.map((order) => <li key={order.id} className="py-2">
                  <Link className="flex flex-wrap items-start justify-between gap-2 rounded-lg p-2 hover:bg-slate-50" to={`/orders?q=${encodeURIComponent(order.order_number)}`}>
                    <span className="grid text-sm"><strong>{order.order_number}</strong><span className="text-slate-600">{order.customer_name || "Cliente"}</span></span>
                    <span className="grid text-right text-sm"><strong>{Number(order.total_amount).toLocaleString("pt-MZ")} {order.currency}</strong>
                      <span className="text-slate-600">{orderStatus[order.status] ?? order.status}</span></span>
                  </Link>
                </li>)}
              </ul>}
        </section>
        <div className="flex flex-wrap gap-2">
          <Link className={action} to="/messages">Abrir conversas <ArrowRight size={14} aria-hidden /></Link>
          <Link className={action} to="/leads">Ver leads <ArrowRight size={14} aria-hidden /></Link>
        </div>
      </div>
    </div>}
  </div>;
}

function SetupStep({ ready, title, detail, href, onClick }: {
  ready: boolean; title: string; detail: string; href?: string; onClick?: () => void;
}) {
  const Icon = ready ? CheckCircle2 : Circle;
  const className = "flex w-full items-start gap-3 p-4 text-left hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-700";
  const content = <>
    <Icon size={19} aria-hidden className={`mt-0.5 shrink-0 ${ready ? "text-emerald-700" : "text-slate-400"}`} />
    <span className="grid flex-1"><strong className="font-medium">{title}</strong><span className="text-sm text-slate-600">{detail}</span></span>
    <ArrowRight size={16} aria-hidden className="mt-1 shrink-0 text-slate-500" />
  </>;
  return <li>{href ? <Link className={className} to={href}>{content}</Link>
    : <button type="button" className={className} onClick={onClick}>{content}</button>}</li>;
}

function PaymentSettings({ settings, onSave }: { settings: SellerSettings | null; onSave: (settings: SellerSettings) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const values = new FormData(event.currentTarget);
      const destinations: PaymentDestinations = {};
      for (const method of sellerMethodKeys) {
        const recipient = String(values.get(`${method}_recipient`) ?? "").trim();
        const name = String(values.get(`${method}_name`) ?? "").trim();
        if (recipient || name) {
          if (!recipient || !name) throw new Error(`Preenche o destino e o titular de ${sellerMethods[method]}.`);
          destinations[method] = { recipient, name };
        }
      }
      if (!Object.keys(destinations).length) throw new Error("Preenche pelo menos um método para receber pagamentos.");
      const body = { payment_method: values.get("payment_method"), payment_destinations: destinations,
        notification_phone: values.get("notification_phone") };
      const { data } = await apiFetch("/api/commerce/seller/settings", { method: "PUT", body: JSON.stringify(body) });
      onSave(data);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível guardar.");
    } finally {
      setSaving(false);
    }
  }
  return <form onSubmit={save} className="mt-4 grid gap-4">
    <p className="text-sm text-slate-600">Preenche os métodos que queres aceitar. Podes guardar os três juntos.</p>
    {sellerMethodKeys.map((method) => <fieldset key={method} className="grid gap-3 rounded-xl border border-slate-200 px-3 pb-3 pt-1 sm:grid-cols-2">
      <legend className="px-1 text-sm font-semibold text-slate-900">{sellerMethods[method]}</legend>
      <label className="grid gap-1 text-sm font-medium">{method === "bank_transfer" ? "Conta ou NIB" : "Número"}
        <Input name={`${method}_recipient`} maxLength={60} inputMode={method === "bank_transfer" ? "text" : "tel"}
          defaultValue={settings?.payment_destinations[method]?.recipient} />
      </label>
      <label className="grid gap-1 text-sm font-medium">Nome do titular
        <Input name={`${method}_name`} minLength={2} maxLength={100} defaultValue={settings?.payment_destinations[method]?.name} />
      </label>
    </fieldset>)}
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-sm font-medium">Método sugerido
        <select name="payment_method" className={field} defaultValue={settings?.payment_method ?? ""}>
          <option value="">Primeiro método preenchido</option>
          {sellerMethodKeys.map((method) => <option key={method} value={method}>{sellerMethods[method]}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium">WhatsApp para avisos (opcional)
        <Input name="notification_phone" type="tel" defaultValue={settings?.notification_phone || ""} />
      </label>
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div><Button type="submit" disabled={saving}>{saving ? "A guardar…" : "Guardar métodos"}</Button></div>
  </form>;
}
