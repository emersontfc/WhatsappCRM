import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { ApiError, apiFetch } from "../lib/api";

const api = "/api/v2/commerce";
const field = "w-full rounded-lg border border-slate-300 bg-transparent p-2 dark:border-slate-700";
const roles = ["admin", "finance_admin", "operator", "viewer"] as const;

type Organization = { organization_id: string; role: string; organizations: { name: string } };
type Order = {
  id: string;
  organization_id: string;
  amount: number;
  currency: string;
  status: keyof typeof statuses;
  approved_at: string | null;
  settlement_reference: string | null;
  organizations: { name: string };
  agentx_digital_deliveries: { order_id: string } | { order_id: string }[] | null;
};
type Proof = {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  claimed_amount: number | null;
  transaction_reference: string | null;
  proof_text: string | null;
  repeated_proof: boolean;
  has_attachment: boolean;
};

const statuses = {
  awaiting_payment: "A aguardar pagamento",
  review_pending: "Em análise financeira",
  rejected: "Comprovativo rejeitado",
  paid: "Pagamento confirmado",
  fulfilled: "Pagamento confirmado"
};

const price = (amount: number, currency: string) =>
  new Intl.NumberFormat("pt-MZ", { style: "currency", currency }).format(amount);

function write(path: string, data: Record<string, unknown>, method = "POST") {
  return apiFetch(api + path, { method, body: JSON.stringify(data) });
}

function ActionForm({ children, submit, label }: {
  children: ReactNode;
  submit: (data: FormData) => Promise<void>;
  label: string;
}) {
  const [busy, setBusy] = useState(false);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    setBusy(true);
    try {
      await submit(new FormData(form));
      form.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "A operação falhou");
    } finally {
      setBusy(false);
    }
  }
  return <form className="grid gap-3" onSubmit={onSubmit}>
    <fieldset disabled={busy} className="grid min-w-0 gap-3">{children}</fieldset>
    <Button type="submit" disabled={busy}>{busy ? "A processar…" : label}</Button>
  </form>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <Card>
    <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
    <CardContent className="grid gap-4">{children}</CardContent>
  </Card>;
}

function suggestCompanyIdentifier(name: string) {
  const identifier = name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 63).replace(/-+$/, "");
  return identifier && identifier.length < 3 ? identifier + "-empresa" : identifier;
}

function CreateOrganizationForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [editedIdentifier, setEditedIdentifier] = useState<string | null>(null);
  const identifierHint = useId();
  const suggestion = suggestCompanyIdentifier(name);

  return <ActionForm label="Criar empresa" submit={async (data) => {
    try {
      const result = await write("/organizations", { name: data.get("name"), slug: data.get("slug") });
      setName("");
      setEditedIdentifier(null);
      onCreated(result.data.id);
      toast.success("Empresa criada.");
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        throw new Error("Esse identificador já está em uso. Edita-o e tenta novamente.");
      }
      throw error;
    }
  }}>
    <label className="grid gap-1 text-sm font-medium">Nome da empresa
      <Input name="name" minLength={2} maxLength={120} required value={name}
        onChange={(event) => setName(event.target.value)} />
    </label>
    <div className="grid gap-1">
      <label className="grid gap-1 text-sm font-medium">Identificador
        <Input name="slug" minLength={3} maxLength={63} pattern={String.raw`[a-z0-9][a-z0-9\-]{2,62}`}
          placeholder="loja-central" autoCapitalize="none" spellCheck={false} aria-describedby={identifierHint}
          required value={editedIdentifier ?? suggestion} onChange={(event) => setEditedIdentifier(event.target.value)} />
      </label>
      <p id={identifierHint} className="text-sm text-slate-600 dark:text-slate-300">
        Sugerido a partir do nome. Podes editar com letras minúsculas, números e hífen.
      </p>
      {editedIdentifier !== null && suggestion && <button type="button"
        className="justify-self-start rounded text-sm font-semibold text-emerald-800 underline focus-visible:ring-2 focus-visible:ring-emerald-600 dark:text-emerald-300"
        onClick={() => setEditedIdentifier(null)}>Usar sugestão</button>}
    </div>
  </ActionForm>;
}

function saveFile(file: Blob, name: string) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function receipt(order: Order) {
  const content = [
    "Confirmação de pagamento — sem valor fiscal",
    order.organizations.name,
    `Encomenda: ${order.id}`,
    `Montante: ${price(order.amount, order.currency)}`,
    `Confirmado em: ${new Date(order.approved_at!).toLocaleString("pt-MZ")}`,
    `Referência: ${order.settlement_reference}`,
    "Obrigado pela compra."
  ].join("\n");
  saveFile(new Blob([content], { type: "text/plain;charset=utf-8" }), `pagamento-${order.id}.txt`);
}

function ProofDecision({ submit }: { submit: (data: FormData) => Promise<void> }) {
  const [decision, setDecision] = useState("");
  return <ActionForm label={decision === "reject" ? "Rejeitar comprovativo" : "Confirmar pagamento"} submit={submit}>
    <label className="grid gap-1 text-sm font-medium">Decisão
      <select className={field} name="decision" required value={decision} onChange={(event) => setDecision(event.target.value)}>
        <option value="">Selecionar decisão</option>
        <option value="approve">Aprovar pagamento</option>
        <option value="reject">Rejeitar comprovativo</option>
      </select>
    </label>
    {decision === "approve" && <>
      <label>Método do pagamento<select className={field} name="method" required defaultValue="">
        <option value="">Selecionar método</option><option value="mpesa">M-Pesa</option>
        <option value="emola">e-Mola</option><option value="bank_transfer">Transferência bancária</option><option value="other">Outro</option>
      </select></label>
      <label>Referência oficial confirmada no prestador<Input name="reference" maxLength={100} required /></label>
      <label className="flex items-start gap-2"><input type="checkbox" name="verified" required className="mt-1" />
        Confirmei o recebimento, o montante e a moeda no prestador.
      </label>
    </>}
    {decision === "reject" && <label>Motivo da rejeição<textarea className={field} name="note" maxLength={1000} required /></label>}
  </ActionForm>;
}

function ReviewQueue({ id }: { id: string }) {
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [state, setState] = useState("A carregar…");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setState("A carregar…");
    apiFetch(`${api}/${id}/payment-proofs/pending`).then(({ data }) => {
      if (active) {
        setProofs(data);
        setState("");
      }
    }).catch(() => {
      if (active) {
        setProofs([]);
        setState("Não foi possível carregar a fila.");
      }
    });
    return () => { active = false; };
  }, [id, revision]);

  async function review(proof: Proof, data: FormData) {
    const decision = data.get("decision");
    const reference = data.get("reference");
    const note = data.get("note");
    await write(`/${id}/payment-proofs/${proof.id}/review`, {
      decision, note: note ?? undefined, settlementVerified: data.get("verified") === "on",
      settlementMethod: data.get("method"), settlementReference: reference
    });
    toast.success(decision === "approve" ? "Pagamento confirmado" : "Comprovativo rejeitado");
    setRevision((value) => value + 1);
  }

  return <Section title="Comprovativos por rever">
    <p className="text-sm text-slate-600">Confere a liquidação no prestador antes de registar a decisão.</p>
    <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>Atualizar fila</Button>
    {state ? <p role="status">{state}</p> : proofs.length === 0 && <p>Sem comprovativos pendentes.</p>}
    {!state && proofs.map((proof) => <article className="grid gap-3 rounded-lg border p-4" key={proof.id}>
      <div className="grid gap-1">
        <strong>{price(proof.amount, proof.currency)}</strong>
        <span className="break-all text-sm">Encomenda {proof.order_id}</span>
        {proof.claimed_amount !== null && <span>Montante extraído {proof.claimed_amount}</span>}
        {proof.transaction_reference && <span className="break-all">Referência extraída {proof.transaction_reference}</span>}
        {proof.repeated_proof && <strong>Texto repetido noutro comprovativo desta empresa.</strong>}
      </div>
      {proof.proof_text && <pre className="whitespace-pre-wrap break-all rounded bg-slate-100 p-3 dark:bg-slate-800">{proof.proof_text}</pre>}
      {proof.has_attachment && <Button variant="outline" onClick={async () => {
        try {
          const { data } = await apiFetch(`${api}/${id}/payment-proofs/${proof.id}/attachment`);
          const bytes = Uint8Array.from(atob(data.content), (character) => character.charCodeAt(0));
          saveFile(new Blob([bytes], { type: "application/octet-stream" }), `comprovativo-${proof.id}.${data.extension}`);
        } catch {
          toast.error("Não foi possível obter o comprovativo.");
        }
      }}>Descarregar comprovativo</Button>}
      <ProofDecision submit={(data) => review(proof, data)} />
    </article>)}
  </Section>;
}

function SalesForms({ id }: { id: string }) {
  const [asset, setAsset] = useState("");
  const [orderId, setOrderId] = useState(() => crypto.randomUUID());
  return <Section title="Criar pedido digital">
    <ActionForm label="Guardar ficheiro privado" submit={async (data) => {
      const response = await apiFetch(`${api}/${id}/digital-assets`, { method: "POST", body: data });
      setAsset(response.data.id);
      toast.success("Ficheiro guardado");
    }}>
      <label>Ficheiro a entregar (até 20 MiB)<Input type="file" name="file" required /></label>
    </ActionForm>
    <ActionForm label="Criar pedido" submit={async (data) => {
      await write(`/${id}/orders/${orderId}`, {
        customerId: data.get("customerId"), customerPhone: data.get("phone"),
        amount: String(data.get("amount")).replace(",", "."), currency: data.get("currency"),
        digitalAssetId: data.get("asset")
      }, "PUT");
      setOrderId(crypto.randomUUID());
      toast.success("Pedido criado");
    }}>
      <label>UUID da conta do comprador<Input name="customerId" required /></label>
      <label>Telefone do comprador<Input type="tel" name="phone" required /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>Montante<Input name="amount" inputMode="decimal" placeholder="250.00" required /></label>
        <label>Moeda<Input name="currency" defaultValue="MZN" maxLength={3} required /></label>
      </div>
      <label>UUID do ficheiro<Input key={asset} name="asset" defaultValue={asset} required /></label>
    </ActionForm>
  </Section>;
}

export default function DigitalOrders({ accountId }: { accountId: string }) {
  const [params] = useSearchParams();
  const reviewOnly = params.get("view") === "review";
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("A carregar…");
  const [revision, setRevision] = useState(0);
  const availableOrganizations = reviewOnly ? organizations.filter((item) => ["owner", "finance_admin"].includes(item.role)) : organizations;
  const organization = availableOrganizations.find((item) => item.organization_id === selected) ?? availableOrganizations[0];
  const organizationId = organization?.organization_id ?? "";

  useEffect(() => {
    let active = true;
    Promise.all([apiFetch(api + "/organizations"), reviewOnly ? Promise.resolve({ data: [] }) : apiFetch(api + "/my-orders")])
      .then(([memberships, purchases]) => {
        if (!active) return;
        setOrganizations(memberships.data);
        setOrders(purchases.data);
        setSelected((value) => memberships.data.some((item: Organization) => item.organization_id === value)
          ? value : memberships.data[0]?.organization_id ?? "");
        setMessage("");
      }).catch(() => {
        if (active) setMessage("Não foi possível carregar os pedidos e as empresas.");
      });
    return () => { active = false; };
  }, [revision, reviewOnly]);
  const refresh = () => setRevision((value) => value + 1);

  if (reviewOnly) return <div className="mx-auto grid max-w-4xl gap-4 p-4 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">Confirmar pagamentos digitais</h1>
      <Link to="/orders?tab=verifications" className="text-sm font-semibold text-emerald-800 underline">Comprovativos de vendas</Link>
    </header>
    {message && <p role="status">{message}</p>}
    {!message && !organization && <Section title="Sem acesso a uma fila de pagamentos">
      <p className="text-sm">Pede ao titular da empresa para te atribuir acesso financeiro. Se és o titular, podes gerir a empresa em Entrega de ficheiros.</p>
      <Link to="/digital-orders" className="text-sm font-semibold text-emerald-800 underline">Abrir Entrega de ficheiros</Link>
    </Section>}
    {!message && organization && <>
      <label className="max-w-sm text-sm font-medium">Empresa<select className={field} value={organizationId} onChange={(event) => setSelected(event.target.value)}>
        {availableOrganizations.map((item) => <option key={item.organization_id} value={item.organization_id}>{item.organizations.name}</option>)}
      </select></label>
      <ReviewQueue key={organizationId} id={organizationId} />
    </>}
  </div>;

  return <div className="mx-auto grid max-w-5xl gap-5 p-4 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold">Entrega de ficheiros</h1>
        <p className="max-w-prose text-sm text-slate-600 dark:text-slate-300">
          Usa esta área quando o cliente precisa de descarregar um ficheiro privado no AgentX depois da confirmação do pagamento.
        </p>
      </div>
      <Button variant="outline" onClick={refresh}>Atualizar</Button>
    </header>
    {message && <p role="status">{message}</p>}
    <Section title="As minhas compras">
      <details>
        <summary className="cursor-pointer font-medium">Identificador de comprador</summary>
        <p className="mt-2">Partilhe este identificador com o vendedor para associar um pedido à sua conta.</p>
        <code className="block break-all text-sm">{accountId}</code>
      </details>
      {!message && !orders.length && <p>Ainda não tens pedidos com ficheiros associados à tua conta.</p>}
      {orders.map((order) => <article key={order.id} className="grid gap-3 rounded-lg border p-4">
        <div className="grid gap-1">
          <strong>{order.organizations.name} · {price(order.amount, order.currency)}</strong>
          <span>{statuses[order.status]}</span>
          <span className="break-all text-sm">Encomenda {order.id}</span>
        </div>
        {["awaiting_payment", "rejected"].includes(order.status) &&
          <ActionForm label="Enviar comprovativo" submit={async (data) => {
            await write(`/${order.organization_id}/orders/${order.id}/payment-proofs`, { text: data.get("proof") });
            toast.success("Comprovativo registado");
            refresh();
          }}>
            <label>Texto do comprovativo<textarea className={field} name="proof" minLength={10} maxLength={4000} required /></label>
          </ActionForm>}
        {["awaiting_payment", "rejected"].includes(order.status) &&
          <ActionForm label="Enviar anexo" submit={async (data) => {
            await apiFetch(`${api}/${order.organization_id}/orders/${order.id}/proof-attachments`, {
              method: "POST", body: data
            });
            toast.success("Anexo registado");
            refresh();
          }}>
            <label>Comprovativo JPEG, PNG ou PDF (até 5 MiB)
              <Input type="file" name="file" accept="image/jpeg,image/png,application/pdf" required />
            </label>
          </ActionForm>}
        {order.approved_at && order.settlement_reference && <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => receipt(order)}>Guardar confirmação</Button>
          {(Array.isArray(order.agentx_digital_deliveries) ? order.agentx_digital_deliveries.length > 0 : Boolean(order.agentx_digital_deliveries)) ? <Button onClick={async () => {
            try {
              const { data } = await apiFetch(`${api}/${order.organization_id}/orders/${order.id}/download`);
              window.location.assign(data.url);
            } catch {
              toast.error("O download está indisponível. Atualize o pedido e tente novamente.");
            }
          }}>Descarregar ficheiro</Button> : <span role="status">A preparar o ficheiro.</span>}
        </div>}
      </article>)}
    </Section>
    {organization && <label className="max-w-sm text-sm font-medium">Empresa ativa
      <select className={field} value={organizationId} onChange={(event) => setSelected(event.target.value)}>
        {organizations.map((item) => <option key={item.organization_id} value={item.organization_id}>{item.organizations.name}</option>)}
      </select>
    </label>}
    {organization && ["owner", "admin", "operator"].includes(organization.role) && <SalesForms key={organizationId} id={organizationId} />}
    {organization && ["owner", "finance_admin"].includes(organization.role) && <ReviewQueue key={organizationId} id={organizationId} />}
    <Card>
      <details>
        <summary className="cursor-pointer rounded-xl p-5 text-base font-semibold focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600">
          Configuração
        </summary>
        <CardContent className="grid gap-5 border-t border-slate-200 pt-5 dark:border-slate-800">
          <div className="grid max-w-lg gap-3">
            <h2 className="text-sm font-semibold">Criar empresa</h2>
            <CreateOrganizationForm onCreated={(id) => { setSelected(id); refresh(); }} />
          </div>
          {organization?.role === "owner" && <details key={organizationId}>
            <summary className="cursor-pointer text-sm font-semibold">Alterar ou remover acesso</summary>
            <div className="mt-3 max-w-lg"><ActionForm label="Guardar acesso" submit={async (data) => {
              const member = encodeURIComponent(String(data.get("member")).trim());
              const role = data.get("role");
              await write(`/${organizationId}/members/${member}`, { role: role === "remove" ? null : role }, "PUT");
              toast.success("Acesso atualizado");
            }}>
              <label>UUID da conta do membro<Input name="member" required /></label>
              <label>Papel<select className={field} name="role">
                {roles.map((role) => <option key={role}>{role}</option>)}
                <option value="remove">Remover acesso</option>
              </select></label>
            </ActionForm></div>
          </details>}
        </CardContent>
      </details>
    </Card>
  </div>;
}
