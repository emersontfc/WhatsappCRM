import { useEffect, useId, useState, type FormEvent } from "react";
import { CalendarPlus, ShieldAlert, Store } from "lucide-react";
import { Link } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { Button } from "./ui/Button";

const messageRules = ["link", "word", "spam", "flood"] as const;
const contentRules = ["image", "video", "audio", "voice", "document", "sticker", "gif", "poll", "contact", "location", "reaction", "invite", "event"] as const;
type Rule = typeof messageRules[number] | typeof contentRules[number];
type Action = "allow" | "warn" | "delete" | "review";
type Decision = "reviewed" | "dismissed";

export const moderationRuleLabels: Record<string, string> = {
  link: "Links fora das exceções", word: "Palavras bloqueadas", spam: "Mensagens repetidas", flood: "Excesso de mensagens",
  image: "Imagens", video: "Vídeos", audio: "Ficheiros de áudio", voice: "Notas de voz", document: "Documentos",
  sticker: "Stickers", gif: "GIFs", poll: "Sondagens", contact: "Contactos", location: "Localizações",
  reaction: "Reações", invite: "Convites de grupo", event: "Eventos", welcome: "Boas-vindas"
};
export const moderationActionLabels: Record<string, string> = {
  allow: "Permitir", warn: "Avisar", delete: "Apagar", review: "Enviar para revisão"
};
export const moderationOutcomeLabels: Record<string, string> = {
  accepted: "Ação aceite pelo WhatsApp", no_permission: "Conta sem permissão", unverified_sender: "Remetente não identificado",
  failed: "Falha na ação", pending: "Ação por confirmar", queued_review: "Aguarda revisão",
  recorded: "Ocorrência registada", uncertain: "Resultado por confirmar"
};

type ModerationPolicy = {
  moderation_actions: Partial<Record<Rule, Action>>;
  moderation_warning: string | null;
  catalog_sales_enabled: boolean;
};
type Review = {
  id: number;
  rule: string;
  action?: string | null;
  outcome: string;
  participant_jid?: string | null;
  created_at: string;
};
type PanelProps = {
  jid: string;
  groupName: string;
  canManage: boolean;
  canPost: boolean;
  memberLabel: (jid: string) => string | undefined;
};

const sampleWarning = "Olá {membro}! Em {grupo}, evita {motivo}, por favor. Obrigado por ajudares a cuidar da conversa.";
const selectClass = "min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus-visible:outline-emerald-600 disabled:bg-slate-50";

async function requestModeration(url: string, signal?: AbortSignal, body?: ModerationPolicy) {
  const data = await apiFetch(url, {
    signal, timeout: 12000, ...(body ? { method: "PUT", body: JSON.stringify(body) } : {})
  });
  if (data?.success !== true || !data.policy?.moderation_actions || typeof data.policy.moderation_actions !== "object" ||
      Array.isArray(data.policy.moderation_actions) || typeof data.policy.catalog_sales_enabled !== "boolean" ||
      (data.policy.moderation_warning !== null && typeof data.policy.moderation_warning !== "string") || !Array.isArray(data.reviews)) {
    throw new Error("O servidor não confirmou as regras de moderação.");
  }
  return { policy: data.policy as ModerationPolicy, reviews: data.reviews as Review[] };
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : "Não foi possível concluir a operação.";
}

function participantLabel(jid: string) {
  const [member, domain] = jid.split("@");
  if (domain === "s.whatsapp.net" && /^\d+$/.test(member)) return `+${member}`;
  if (domain === "lid" && /^\d+$/.test(member)) return `Membro ${member.slice(-6)}`;
  return "Membro por identificar";
}

function previewWarning(text: string, groupName: string) {
  const labels: Record<string, string> = { membro: "@Ana", motivo: "enviar imagens", grupo: groupName };
  return text.replace(/\{(membro|motivo|grupo)\}/g, (_, key: string) => labels[key]);
}

function RuleActionSelect({ rule, inherit, value, onChange }: {
  rule: Rule;
  inherit?: boolean;
  value?: Action;
  onChange: (action?: Action) => void;
}) {
  return <label className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] items-center gap-2 rounded-xl bg-slate-50 p-2.5 text-sm text-slate-800">
    <span>{moderationRuleLabels[rule]}</span>
    <select aria-label={moderationRuleLabels[rule]} className={selectClass} value={value ?? (inherit ? "" : "allow")}
      onChange={(event) => onChange(event.target.value ? event.target.value as Action : undefined)}>
      {inherit && <option value="">Herdar configuração</option>}
      {Object.entries(moderationActionLabels).map(([action, label]) => <option key={action} value={action}>{label}</option>)}
    </select>
  </label>;
}

export function GroupModerationPanel({ jid, groupName, canManage, canPost, memberLabel }: PanelProps) {
  const headingId = useId();
  const url = `/api/whatsapp/groups/${encodeURIComponent(jid)}/moderation`;
  const [policy, setPolicy] = useState<ModerationPolicy | null>(null);
  const [draft, setDraft] = useState<ModerationPolicy | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [busy, setBusy] = useState(true);
  const [reviewing, setReviewing] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);

  useEffect(() => {
    const request = new AbortController();
    void requestModeration(url, request.signal).then(({ policy: saved, reviews: queued }) => {
      if (request.signal.aborted) return;
      setPolicy(saved);
      setDraft(saved);
      setReviews(queued);
    }).catch((cause) => {
      if (!request.signal.aborted) setFeedback({ error: true, text: errorMessage(cause) });
    }).finally(() => {
      if (!request.signal.aborted) setBusy(false);
    });
    return () => request.abort();
  }, [url]);

  function setRule(rule: Rule, action?: Action) {
    setDraft((current) => {
      if (!current) return current;
      const actions = { ...current.moderation_actions };
      if (action) actions[rule] = action;
      else delete actions[rule];
      return { ...current, moderation_actions: actions };
    });
  }

  const changed = policy && draft && (
    draft.moderation_warning !== policy.moderation_warning || draft.catalog_sales_enabled !== policy.catalog_sales_enabled ||
    [...messageRules, ...contentRules].some((rule) => draft.moderation_actions[rule] !== policy.moderation_actions[rule])
  );

  async function refresh() {
    if (busy || reviewing !== null) return;
    setBusy(true);
    setFeedback(null);
    try {
      const { policy: saved, reviews: queued } = await requestModeration(url);
      setPolicy(saved);
      if (!changed) setDraft(saved);
      setReviews(queued);
    } catch (cause) {
      setFeedback({ error: true, text: errorMessage(cause) });
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!canManage || !draft || !changed || busy || reviewing !== null) return;
    setBusy(true);
    setFeedback(null);
    try {
      const { policy: saved, reviews: queued } = await requestModeration(url, undefined, {
        ...draft, moderation_warning: draft.moderation_warning?.trim() || null
      });
      setPolicy(saved);
      setDraft(saved);
      setReviews(queued);
      setFeedback({ error: false, text: "Regras e definições de vendas guardadas." });
    } catch (cause) {
      setFeedback({ error: true, text: errorMessage(cause) });
    } finally {
      setBusy(false);
    }
  }

  async function resolveReview(id: number, decision: Decision) {
    if (!canManage || busy || reviewing !== null) return;
    setReviewing(id);
    setFeedback(null);
    try {
      const result = await apiFetch(`${url}/reviews/${encodeURIComponent(String(id))}`, {
        method: "PATCH", timeout: 12000, body: JSON.stringify({ decision })
      });
      if (result?.success !== true) throw new Error("A decisão não foi confirmada.");
      setReviews((items) => items.filter((item) => item.id !== id));
      setFeedback({ error: false, text: decision === "reviewed" ? "Ocorrência marcada como revista." : "Ocorrência arquivada." });
    } catch (cause) {
      setFeedback({ error: true, text: errorMessage(cause) });
    } finally {
      setReviewing(null);
    }
  }

  return <section aria-labelledby={headingId} className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 id={headingId} className="flex items-center gap-2 font-semibold text-slate-900">
        <ShieldAlert size={18} className="text-emerald-600" aria-hidden /> Ações de moderação e vendas
      </h3>
      {canPost && <Link to={`/seller?group=${encodeURIComponent(jid)}#campanhas`}
        className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-emerald-200 px-3 text-sm font-semibold text-emerald-900 hover:bg-emerald-50 focus-visible:outline-emerald-600">
        <CalendarPlus size={16} aria-hidden /> Agendar promoção
      </Link>}
    </div>
    {busy && !draft && <p role="status" className="text-sm text-slate-600">A carregar as regras…</p>}
    {feedback && <p role={feedback.error ? "alert" : "status"} className={`rounded-xl px-3 py-2 text-sm ${feedback.error ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-900"}`}>{feedback.text}</p>}
    {!draft && !busy && <Button variant="outline" size="sm" onClick={() => void refresh()}>Tentar novamente</Button>}
    {draft && <>
      <form className="space-y-5" onSubmit={(event) => void save(event)}>
        {!canManage && <p className="text-sm text-slate-600">A conta ligada precisa de ser administradora do grupo para guardar alterações e rever ocorrências.</p>}
        <fieldset disabled={!canManage || busy || reviewing !== null} className="space-y-2">
          <legend className="mb-2 font-semibold text-slate-900">Ações por regra</legend>
          <p className="text-sm text-slate-600">Ativa a deteção de links, repetições e excesso de mensagens nas regras do grupo. As regras herdadas avisam quando há um limite configurado e apagam quando o limite está no padrão.</p>
          <div className="grid gap-2 md:grid-cols-2">
            {messageRules.map((rule) => <RuleActionSelect key={rule} rule={rule} inherit value={draft.moderation_actions[rule]}
              onChange={(action) => setRule(rule, action)} />)}
          </div>
        </fieldset>
        <fieldset disabled={!canManage || busy || reviewing !== null} className="space-y-2 border-t border-slate-100 pt-3">
          <legend className="mb-2 font-semibold text-slate-900">Ações por tipo de conteúdo</legend>
          <p className="text-sm text-slate-600">Escolhe quais os tipos que queres moderar. Enviar para revisão mantém a publicação disponível para a equipa avaliar.</p>
          <div className="grid gap-2 md:grid-cols-2">
            {contentRules.map((rule) => <RuleActionSelect key={rule} rule={rule} value={draft.moderation_actions[rule]}
              onChange={(action) => setRule(rule, action === "allow" ? undefined : action)} />)}
          </div>
        </fieldset>
        <fieldset disabled={!canManage || busy || reviewing !== null} className="space-y-3 border-t border-slate-100 pt-3">
          <legend className="mb-2 font-semibold text-slate-900">Mensagem de aviso</legend>
          <label className="block space-y-1 text-sm text-slate-800">
            <span>Texto enviado ao membro</span>
            <textarea value={draft.moderation_warning ?? ""} placeholder={sampleWarning} maxLength={600} rows={3}
              onChange={(event) => setDraft({ ...draft, moderation_warning: event.target.value || null })}
              className="block w-full rounded-xl border border-slate-200 p-3 focus-visible:outline-emerald-600 disabled:bg-slate-50" />
          </label>
          <p className="text-xs text-slate-600">Usa {"{membro}"} para a menção, {"{motivo}"} para a regra e {"{grupo}"} para o nome do grupo. Em branco, o AgentX usa o aviso padrão.</p>
          <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-950">
            <p className="font-medium">Exemplo de aviso</p>
            <p className="mt-1 whitespace-pre-wrap break-words">{previewWarning(draft.moderation_warning?.trim() || sampleWarning, groupName)}</p>
          </div>
        </fieldset>
        <fieldset disabled={!canManage || busy || reviewing !== null} className="space-y-2 border-t border-slate-100 pt-3">
          <legend className="mb-2 flex items-center gap-2 font-semibold text-slate-900"><Store size={17} aria-hidden /> Vendas neste grupo</legend>
          <label className="flex items-start gap-2 text-sm text-slate-800">
            <input type="checkbox" checked={draft.catalog_sales_enabled} className="mt-1 accent-emerald-600"
              onChange={(event) => setDraft({ ...draft, catalog_sales_enabled: event.target.checked })} />
            Permitir que o AgentX responda a pedidos de catálogo neste grupo
          </label>
          <p className="text-sm text-slate-600">Os membros podem escrever <code>/loja</code> ou <code>/loja nome do produto</code>. O AgentX apresenta o catálogo no grupo e encaminha a compra para uma conversa privada. As promoções são configuradas em Campanhas.</p>
        </fieldset>
        {canManage && <Button type="submit" disabled={!changed || busy || reviewing !== null}>Guardar moderação e vendas</Button>}
      </form>
      {canManage && <section className="space-y-3 border-t border-slate-100 pt-4" aria-label="Fila de revisão">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-semibold text-slate-900">Fila de revisão</h4>
          <Button size="sm" variant="outline" disabled={busy || reviewing !== null} onClick={() => void refresh()}>Atualizar fila</Button>
        </div>
        {reviews.length === 0 ? <p className="text-sm text-slate-600">Ainda sem ocorrências por rever.</p> : <>
          <p className="text-sm text-slate-600">Verifica a ocorrência no WhatsApp e regista a decisão aqui.</p>
          <ul className="divide-y divide-slate-100">
            {reviews.map((review) => <li key={review.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="break-words font-medium text-slate-900">{moderationRuleLabels[review.rule] ?? "Ocorrência do grupo"}
                  {review.participant_jid && ` · ${memberLabel(review.participant_jid) ?? participantLabel(review.participant_jid)}`}</p>
                <p className="text-xs text-slate-600">{review.action === "warn" ? "Limite de avisos atingido" : "Encaminhada pela regra"} · {moderationOutcomeLabels[review.outcome] ?? "Aguarda revisão"}</p>
                <time dateTime={review.created_at} className="text-xs text-slate-600">{new Date(review.created_at).toLocaleString("pt-MZ")}</time>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy || reviewing !== null} onClick={() => void resolveReview(review.id, "reviewed")}>Marcar como revista</Button>
                <Button size="sm" variant="outline" disabled={busy || reviewing !== null} onClick={() => void resolveReview(review.id, "dismissed")}>Arquivar</Button>
              </div>
            </li>)}
          </ul>
        </>}
      </section>}
    </>}
  </section>;
}
