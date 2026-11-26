import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, Bell, CalendarClock, FileText, MessageCircle, Package, RefreshCw } from "lucide-react";
import { sellerTeamRoles, type SellerTask, type SellerTeamCompany, type SellerTeamMember } from "../../shared/sellerTeam";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { apiFetch } from "../lib/api";

const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-emerald-700";
const panel = "rounded-2xl border border-slate-200 bg-white p-4 sm:p-5";
const linkStyle = "inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50";
const taskIcons = { payment: FileText, delivery: Package, notice: Bell, private_proof: FileText, handoff: MessageCircle };
const taskTime = new Intl.DateTimeFormat("pt-MZ", { timeZone: "Africa/Maputo", dateStyle: "short", timeStyle: "short" });
const base = "/api/seller-team";

export default function SellerTeam({ accountId }: { accountId: string }) {
  const [params, setParams] = useSearchParams();
  const [companies, setCompanies] = useState<SellerTeamCompany[] | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const linked = (companies ?? []).filter((company) => company.linked);
  const owned = (companies ?? []).filter((company) => company.role === "owner");
  const selected = params.get("empresa") ?? linked[0]?.organizationId ?? "propria";
  const company = linked.find((item) => item.organizationId === selected);
  const validSelection = selected === "propria" || company !== undefined;

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    apiFetch(`${base}/companies`, { accountId, signal: controller.signal }).then(({ data }) => setCompanies(data))
      .catch((failure) => { if (!controller.signal.aborted) setError(String(failure.message)); });
    return () => controller.abort();
  }, [accountId, revision]);

  function select(scope: string) {
    setParams({ empresa: scope });
  }

  return <div className="mx-auto max-w-6xl space-y-5 pb-8">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="grid min-w-48 gap-1 text-sm font-semibold text-slate-700">
        <label htmlFor="team-store">Loja</label>
        <select id="team-store" className={field} value={validSelection ? selected : ""} disabled={!companies}
          onChange={(event) => select(event.target.value)}>
          {!validSelection && <option value="">Escolhe uma loja</option>}
          <option value="propria">A minha loja</option>
          {linked.map((item) => <option key={item.organizationId} value={item.organizationId}>{item.name} · {sellerTeamRoles[item.role]}</option>)}
        </select>
      </div>
      <Button variant="outline" onClick={() => setRevision((value) => value + 1)} className="gap-2"><RefreshCw size={16} aria-hidden /> Atualizar</Button>
    </div>

    {error && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{error}</p>}
    {!companies && !error && <p role="status" className="text-sm text-slate-600">A consultar as lojas…</p>}
    {companies && !validSelection && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">Esta loja deixou de estar disponível. Escolhe outra na lista.</p>}
    {companies && validSelection && <>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <TeamQueue key={selected} accountId={accountId} company={company} revision={revision} />
        <div className="space-y-5">
          {company?.role === "owner" && <TeamMembers key={selected} accountId={accountId} company={company} revision={revision} />}
          {!company && !owned.some((item) => item.linked) && <LinkTeam accountId={accountId} owned={owned} onLinked={(id) => {
            setRevision((value) => value + 1);
            select(id);
          }} />}
          <section className={panel} aria-labelledby="queue-shortcuts">
            <h2 id="queue-shortcuts" className="font-semibold">Abrir a loja</h2>
            <div className="mt-2 flex flex-wrap gap-1">
              <Link className={linkStyle} to={orderLink(company, "orders")}>Pedidos <ArrowRight size={14} aria-hidden /></Link>
              {company?.role !== "finance_admin" && <Link className={linkStyle} to={orderLink(company, "products")}>Catálogo <ArrowRight size={14} aria-hidden /></Link>}
              {company?.role !== "operator" && <Link className={linkStyle} to={orderLink(company, "verifications")}>Comprovativos <ArrowRight size={14} aria-hidden /></Link>}
              {company?.role === "owner" && <Link className={linkStyle} to="/seller">Definições do Vendedor <ArrowRight size={14} aria-hidden /></Link>}
            </div>
          </section>
        </div>
      </div>
    </>}
  </div>;
}

function orderLink(company: SellerTeamCompany | undefined, tab: string, orderNumber?: string, status?: string) {
  const query = new URLSearchParams({ tab });
  if (company) query.set("empresa", company.organizationId);
  if (orderNumber) query.set("q", orderNumber);
  if (status) query.set("status", status);
  return `/orders?${query}`;
}

function LinkTeam({ accountId, owned, onLinked }: { accountId: string; owned: SellerTeamCompany[]; onLinked: (id: string) => void }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function link(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) return;
    const values = new FormData(event.currentTarget);
    const payload = owned.length ? { organizationId: values.get("organization") } : { name: values.get("name") };
    setWorking(true);
    setError("");
    try {
      const { data } = await apiFetch(`${base}/companies`, { accountId, method: "POST", body: JSON.stringify(payload) });
      onLinked(data.organizationId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível ativar a equipa.");
    } finally {
      setWorking(false);
    }
  }

  return <section className={panel} aria-labelledby="team-link">
    <h2 id="team-link" className="font-semibold">Ativar equipa</h2>
    <p className="mt-1 text-sm text-slate-600">Associa esta loja à tua empresa para partilhar os pedidos do WhatsApp. Os vendedores tratam do catálogo e das entregas. Os responsáveis financeiros reveem comprovativos.</p>
    <form onSubmit={link} className="mt-4 grid gap-3">
      {owned.length ? <label className="grid gap-1 text-sm font-medium">Empresa a associar
        <select className={field} name="organization" required defaultValue="">
          <option value="" disabled>Escolhe a empresa</option>
          {owned.map((company) => <option key={company.organizationId} value={company.organizationId}>{company.name}</option>)}
        </select>
      </label> : <label className="grid gap-1 text-sm font-medium">Nome da empresa <Input name="name" minLength={2} maxLength={120} required /></label>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <Button type="submit" disabled={working}>{working ? "A associar…" : "Associar loja"}</Button>
    </form>
  </section>;
}

function TeamMembers({ accountId, company, revision }: { accountId: string; company: SellerTeamCompany; revision: number }) {
  const [members, setMembers] = useState<SellerTeamMember[] | null>(null);
  const [version, setVersion] = useState(0);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const endpoint = `${base}/companies/${company.organizationId}/members`;

  useEffect(() => {
    const controller = new AbortController();
    apiFetch(endpoint, { accountId, signal: controller.signal }).then(({ data }) => setMembers(data))
      .catch((failure) => { if (!controller.signal.aborted) setError(String(failure.message)); });
    return () => controller.abort();
  }, [accountId, endpoint, revision, version]);

  async function save(payload: { email: string; role: string } | { memberId: string; role: null }) {
    if (working) return false;
    setWorking(true);
    setError("");
    setMessage("");
    try {
      await apiFetch(endpoint, { accountId, method: "PUT", body: JSON.stringify(payload) });
      setVersion((value) => value + 1);
      setMessage(payload.role === null ? "Acesso removido." : "Acesso guardado.");
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível alterar o acesso.");
      return false;
    } finally {
      setWorking(false);
    }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (await save({ email: String(values.get("email")), role: String(values.get("role")) })) form.reset();
  }

  return <section className={panel} aria-labelledby="team-members">
    <h2 id="team-members" className="font-semibold">Membros</h2>
    <p className="mt-1 text-sm text-slate-600">Usa o email confirmado da conta AgentX da pessoa. Para mudar a função, guarda novamente o mesmo email com a função correta.</p>
    <form onSubmit={add} className="mt-4 grid gap-2">
      <label className="grid gap-1 text-sm font-medium">Email <Input name="email" type="email" maxLength={254} required /></label>
      <div className="grid gap-1 text-sm font-medium">
        <label htmlFor="team-member-role">Função</label>
        <select id="team-member-role" className={field} name="role"><option value="operator">Vendedor</option><option value="finance_admin">Responsável financeiro</option></select>
      </div>
      <Button type="submit" disabled={working}>{working ? "A guardar…" : "Guardar acesso"}</Button>
    </form>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mt-3 text-sm text-emerald-800">{message}</p>}
    {!members && !error && <p role="status" className="mt-3 text-sm text-slate-600">A consultar os membros…</p>}
    {members && members.length > 0 && <ul className="mt-4 divide-y divide-slate-100">
      {members.map((member) => <li key={member.userId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
        <span className="min-w-0 break-all">{member.email}<span className="block text-xs text-slate-600">{sellerTeamRoles[member.role]}</span></span>
        {member.role !== "owner" && <Button size="sm" variant="outline" disabled={working} aria-label={`Remover acesso de ${member.email}`} onClick={() => {
          if (window.confirm(`Remover o acesso de ${member.email} a ${company.name}?`)) void save({ memberId: member.userId, role: null });
        }}>Remover</Button>}
      </li>)}
    </ul>}
  </section>;
}

function TeamQueue({ accountId, company, revision }: { accountId: string; company?: SellerTeamCompany; revision: number }) {
  const [tasks, setTasks] = useState<SellerTask[] | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const scope = company ? `${base}/companies/${company.organizationId}` : `${base}/personal`;

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    apiFetch(`${scope}/tasks`, { accountId, signal: controller.signal }).then(({ data }) => setTasks(data)).catch((failure) => {
      if (!controller.signal.aborted) {
        setTasks(null);
        setError(String(failure.message));
      }
    });
    return () => controller.abort();
  }, [accountId, scope, revision, version]);

  async function update(task: SellerTask) {
    if (busy) return;
    setBusy(task.id);
    setError("");
    try {
      const operation = task.action === "retry_notice" ? `notices/${task.id}/retry` : `proof-events/${task.id}/resolve`;
      await apiFetch(`${scope}/${operation}`, { accountId, method: "POST" });
      setVersion((value) => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível atualizar a tarefa.");
    } finally {
      setBusy(null);
    }
  }

  return <section className={panel} aria-labelledby="team-queue">
    <h2 id="team-queue" className="text-lg font-semibold">Fila de tarefas</h2>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {!tasks && !error && <p role="status" className="mt-3 text-sm text-slate-600">A consultar as tarefas…</p>}
    {tasks?.length === 0 && <p className="mt-3 text-sm text-slate-600">Não há tarefas pendentes para a tua função.</p>}
    {!!tasks?.length && <ul className="mt-2 divide-y divide-slate-100">
      {tasks.map((task) => {
        const Icon = taskIcons[task.kind];
        const time = new Date(task.updatedAt);
        return <li key={`${task.kind}:${task.id}`} className="flex gap-3 py-3.5">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-700"><Icon size={17} aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <strong className="text-sm text-slate-950">{task.title}{task.orderNumber ? ` · ${task.orderNumber}` : ""}</strong>
              {Number.isFinite(time.getTime()) && <time className="flex items-center gap-1 text-xs text-slate-500" dateTime={task.updatedAt}>
                <CalendarClock size={12} aria-hidden />{taskTime.format(time)}
              </time>}
            </div>
            <p className="mt-1 text-sm leading-5 text-slate-600">{task.detail}</p>
            {task.contactLabel && <p className="mt-1 break-words text-xs text-slate-600">Contacto · {task.contactLabel}</p>}
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {task.contactId && <Link className={linkStyle} to={`/messages?contactId=${encodeURIComponent(task.contactId)}`}>Abrir conversa <ArrowRight size={14} aria-hidden /></Link>}
              {(["orders", "review", "delivery"] as const).some((action) => task.action === action) && task.orderNumber &&
                <Link className={linkStyle} to={orderLink(company, task.action === "review" ? "verifications" : "orders", task.orderNumber, task.action === "delivery" ? "paid" : undefined)}>
                  {task.action === "review" ? "Rever comprovativo" : "Abrir pedido"} <ArrowRight size={14} aria-hidden />
                </Link>}
              {(task.action === "retry_notice" || task.action === "close_intake") && <Button type="button" size="sm" variant="outline" disabled={busy !== null}
                onClick={() => void update(task)}>{busy === task.id ? "A atualizar…" : task.action === "retry_notice" ? "Voltar a tentar" : "Marcar como tratado"}</Button>}
            </div>
          </div>
        </li>;
      })}
    </ul>}
  </section>;
}
