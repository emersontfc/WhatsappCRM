import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CalendarClock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "../lib/api";
import { moderationRuleLabels } from "./GroupModerationPanel";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

type GroupRules = {
  allowed_link_hosts: string[];
  blocked_words: string[];
  warning_limit: number;
};

type ScheduleSettings = {
  enabled: boolean;
  timezone: string;
  days: number[];
  opens_at: string;
  closes_at: string;
};

type Schedule = ScheduleSettings & {
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_outcome?: string | null;
};

type Warning = {
  id: string;
  participant_jid: string;
  rule: string;
  warning_number: number;
  warning_limit: number;
  status: "pending" | "sent" | "failed" | "recorded";
  created_at: string;
};

type GroupPolicy = { rules: GroupRules; schedule: Schedule | null; warnings: Warning[]; announce?: boolean | null };
type Draft = { hosts: string; words: string; warningLimit: number; schedule: ScheduleSettings };
type View = { jid: string; policy: GroupPolicy; draft: Draft };

const localTimezone = "Africa/Maputo";
const defaultSchedule = {
  enabled: false, timezone: localTimezone, days: [1, 2, 3, 4, 5], opens_at: "08:00", closes_at: "18:00"
};
const weekdays = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo"];
const warningStates: Record<Warning["status"], string> = {
  pending: "Aviso ainda por confirmar", sent: "Aviso aceite pelo WhatsApp",
  failed: "Falha ao enviar o aviso", recorded: "Ocorrência registada"
};
const scheduleOutcomes: Record<string, string> = {
  confirmed: "Estado confirmado pelo WhatsApp", retry: "Nova tentativa agendada",
  no_permission: "A conta ligada perdeu a permissão de administrador", failed: "O WhatsApp não confirmou a alteração"
};
const textareaClass = "mt-1 block min-h-20 w-full rounded-xl border border-slate-200 p-3 text-sm focus-visible:outline-emerald-500 disabled:bg-slate-50";

function makeDraft(policy: GroupPolicy): Draft {
  const { enabled, timezone, days, opens_at, closes_at } = policy.schedule ?? defaultSchedule;
  return {
    hosts: policy.rules.allowed_link_hosts.join("\n"), words: policy.rules.blocked_words.join("\n"),
    warningLimit: policy.rules.warning_limit,
    schedule: { enabled, timezone, days, opens_at: opens_at.slice(0, 5), closes_at: closes_at.slice(0, 5) }
  };
}

function listValues(value: string) {
  return [...new Set(value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
}

function formatDate(value: string | null | undefined, timeZone: string) {
  if (!value) return null;
  try {
    return new Intl.DateTimeFormat("pt-MZ", { dateStyle: "short", timeStyle: "short", timeZone }).format(new Date(value));
  } catch {
    return null;
  }
}

async function requestPolicy(url: string, signal: AbortSignal, body?: { rules: GroupRules; schedule: ScheduleSettings | null }): Promise<GroupPolicy> {
  const data = await apiFetch(url, {
    signal, timeout: 12000, ...(body ? { method: "PUT", body: JSON.stringify(body) } : {})
  });
  if (data?.success !== true || !Array.isArray(data.rules?.allowed_link_hosts) || !Array.isArray(data.rules?.blocked_words) ||
      !Number.isInteger(data.rules.warning_limit) || !Array.isArray(data.warnings) ||
      (data.schedule !== null && (!Array.isArray(data.schedule?.days) || typeof data.schedule?.opens_at !== "string" ||
        typeof data.schedule?.closes_at !== "string"))) {
    throw new Error("O servidor não confirmou a configuração do grupo.");
  }
  return data;
}

export function GroupPolicyPanel({ jid, canManage }: { jid: string; canManage: boolean }) {
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const timezoneList = useId();
  const url = `/api/whatsapp/groups/${encodeURIComponent(jid)}/policy`;
  const current = view?.jid === jid ? view : null;
  const draft = current?.draft;

  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError("");
    void requestPolicy(url, request.signal).then((policy) => {
      if (!request.signal.aborted) setView({ jid, policy, draft: makeDraft(policy) });
    }).catch((cause) => {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível consultar a configuração do grupo.");
    }).finally(() => {
      if (!request.signal.aborted) setBusy(false);
    });
    return () => request.abort();
  }, [jid, url]);

  function updateDraft(patch: Partial<Draft>) {
    setView((previous) => previous?.jid === jid ? { ...previous, draft: { ...previous.draft, ...patch } } : previous);
  }

  async function updatePolicy(body?: { rules: GroupRules; schedule: ScheduleSettings | null }) {
    const signal = controller.current?.signal;
    if (!signal || signal.aborted || busy) return;
    setError("");
    setBusy(true);
    try {
      const policy = await requestPolicy(url, signal, body);
      if (signal.aborted) return;
      setView((previous) => ({ jid, policy, draft: !body && previous?.jid === jid &&
        JSON.stringify(previous.draft) !== JSON.stringify(makeDraft(previous.policy)) ? previous.draft : makeDraft(policy) }));
      if (body) toast.success("Configuração do grupo guardada.");
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível concluir a operação.");
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || !draft || busy) return;
    const hosts = listValues(draft.hosts);
    const words = listValues(draft.words);
    if (hosts.length > 20 || hosts.some((host) => host.length > 253) || words.length > 20 || words.some((word) => word.length > 64)) {
      setError("Introduz até 20 domínios e 20 palavras ou expressões. Cada domínio pode ter até 253 caracteres e cada expressão até 64.");
      return;
    }
    const schedule = draft.schedule.enabled ? {
      ...draft.schedule, timezone: draft.schedule.timezone.trim(), days: [...draft.schedule.days].sort((a, b) => a - b)
    } : current?.policy.schedule ? { ...makeDraft(current.policy).schedule, enabled: false } : null;
    if (schedule?.enabled && (!schedule.days.length || schedule.opens_at === schedule.closes_at || !schedule.timezone)) {
      setError("Escolhe os dias, o fuso horário e horas diferentes para abrir e fechar o grupo.");
      return;
    }
    void updatePolicy({ rules: { allowed_link_hosts: hosts, blocked_words: words, warning_limit: draft.warningLimit }, schedule });
  }

  const schedule = current?.policy.schedule;
  const lastRun = formatDate(schedule?.last_run_at, schedule?.timezone ?? localTimezone);
  const nextRun = formatDate(schedule?.next_run_at, schedule?.timezone ?? localTimezone);
  const warnings = current?.policy.warnings ?? [];
  const announce = current?.policy.announce;
  const hasChanges = current && JSON.stringify(current.draft) !== JSON.stringify(makeDraft(current.policy));

  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" aria-label="Horários e moderação do grupo">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-semibold text-slate-900">Horários e moderação</h3>
      {(current || error) && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void updatePolicy()}>
        {current ? "Atualizar estado" : "Tentar novamente"}
      </Button>}
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {!current && busy && <p role="status" className="text-sm text-slate-600">A carregar a configuração…</p>}

    {draft && <form className="space-y-5" onSubmit={save}>
      {!canManage && <p className="text-sm text-slate-600">A conta ligada precisa de ser administradora para alterar estas definições.</p>}
      <fieldset className="space-y-3" disabled={busy || !canManage}>
        <legend className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <CalendarClock size={16} className="text-emerald-600" /> Horário de escrita
        </legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-emerald-600" checked={draft.schedule.enabled}
            onChange={(event) => updateDraft({ schedule: { ...draft.schedule, enabled: event.target.checked } })} />
          Abrir e fechar o grupo automaticamente
        </label>
        {draft.schedule.enabled && <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">Abrir às
              <Input type="time" className="mt-1" required value={draft.schedule.opens_at}
                onChange={(event) => updateDraft({ schedule: { ...draft.schedule, opens_at: event.target.value } })} />
            </label>
            <label className="block text-sm">Fechar às
              <Input type="time" className="mt-1" required value={draft.schedule.closes_at}
                onChange={(event) => updateDraft({ schedule: { ...draft.schedule, closes_at: event.target.value } })} />
            </label>
          </div>
          <label className="block text-sm">Fuso horário
            <Input className="mt-1" list={timezoneList} placeholder={localTimezone} required maxLength={64}
              value={draft.schedule.timezone} autoComplete="off"
              onChange={(event) => updateDraft({ schedule: { ...draft.schedule, timezone: event.target.value } })} />
          </label>
          <datalist id={timezoneList}>
            {[localTimezone, "Africa/Luanda", "Europe/Lisbon", "America/Sao_Paulo", "UTC"].map((zone) => <option key={zone} value={zone} />)}
          </datalist>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Dias de abertura">
            {weekdays.map((name, index) => {
              const day = index + 1;
              const selected = draft.schedule.days.includes(day);
              return <label key={name} className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-2 text-sm">
                <input type="checkbox" className="accent-emerald-600" checked={selected} aria-label={name}
                  onChange={() => updateDraft({ schedule: { ...draft.schedule,
                    days: selected ? draft.schedule.days.filter((value) => value !== day) : [...draft.schedule.days, day] } })} />
                {name.slice(0, 3)}
              </label>;
            })}
          </div>
          <p className="text-xs text-slate-600">Os dias são os de abertura. Se a hora de fecho for mais cedo, o grupo fecha no dia seguinte. O servidor verifica o horário no próximo ciclo.</p>
        </>}
      </fieldset>

      {schedule?.enabled && (nextRun || schedule.last_outcome) &&
        <div className="space-y-1 rounded-xl bg-slate-50 p-3 text-sm text-slate-700" role="status">
          {typeof announce === "boolean" && <p>Permissão atual no WhatsApp: {announce ? "só administradores" : "todos os membros"}</p>}
          {schedule.last_outcome && <p>{scheduleOutcomes[schedule.last_outcome] ?? "Estado por confirmar"}
            {lastRun && ` · ${lastRun}`}</p>}
          {nextRun && <p>Próxima verificação: {nextRun} · {schedule.timezone}</p>}
        </div>}

      <fieldset className="space-y-3 border-t border-slate-100 pt-3" disabled={busy || !canManage}>
        <legend className="flex items-center gap-2 pr-2 text-sm font-semibold text-slate-900">
          <ShieldCheck size={16} className="text-emerald-600" /> Regras de moderação
        </legend>
        <label className="block text-sm">Domínios permitidos
          <textarea className={textareaClass} rows={2} maxLength={5080} placeholder="empresa.co.mz" value={draft.hosts}
            onChange={(event) => updateDraft({ hosts: event.target.value })} />
          <span className="mt-1 block text-xs text-slate-600">Um por linha. As exceções valem para o bloqueio de links e incluem subdomínios.</span>
        </label>
        <label className="block text-sm">Palavras e expressões bloqueadas
          <textarea className={textareaClass} rows={2} maxLength={1300} value={draft.words}
            onChange={(event) => updateDraft({ words: event.target.value })} />
          <span className="mt-1 block text-xs text-slate-600">Uma por linha. A regra compara palavras inteiras, independentemente das maiúsculas.</span>
        </label>
        <label className="block text-sm">Avisos até revisão por um administrador
          <select className="mt-1 block min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm disabled:bg-slate-50"
            value={draft.warningLimit} onChange={(event) => updateDraft({ warningLimit: Number(event.target.value) })}>
            <option value={0}>Usar limite padrão</option>
            {Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
          </select>
          <span className="mt-1 block text-xs text-slate-600">O limite conta ocorrências por membro em 24 horas. O padrão é 3 para a ação Avisar. Uma regra antiga que herda a configuração apaga a mensagem quando o limite fica no padrão.</span>
        </label>
      </fieldset>
      {canManage && <Button type="submit" disabled={busy || !hasChanges}>Guardar regras e horário</Button>}
    </form>}

    {current && <section className="space-y-2 border-t border-slate-100 pt-3" aria-label="Histórico de avisos">
      <h4 className="text-sm font-semibold text-slate-900">Histórico de avisos</h4>
      {warnings.length ? <ul className="divide-y divide-slate-100">
        {warnings.map((warning) => <li className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm" key={warning.id}>
          <div>
            <p className="font-medium text-slate-900">{moderationRuleLabels[warning.rule] ?? "Regra do grupo"} · {warning.participant_jid.includes("@lid")
              ? `Membro ${warning.participant_jid.split("@")[0].slice(-6)}` : `+${warning.participant_jid.split("@")[0]}`}</p>
            <p className="text-xs text-slate-600">{warningStates[warning.status] ?? "Estado por confirmar"} · {warning.warning_number}/{warning.warning_limit}
              {warning.warning_number >= warning.warning_limit && <span className="ml-2 font-semibold text-amber-800">Limite de avisos atingido</span>}</p>
          </div>
          <time className="text-xs text-slate-600" dateTime={warning.created_at}>{formatDate(warning.created_at, schedule?.timezone ?? localTimezone)}</time>
        </li>)}
      </ul> : <p className="text-sm text-slate-600">Ainda sem avisos registados.</p>}
    </section>}
  </section>;
}
