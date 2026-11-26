import { useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpen, CalendarCheck, Shield, ShoppingBag, type LucideIcon } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useActivation } from "../lib/useActivation";

type Step = {
  id: string;
  title: string;
  detail: string;
  action: string;
  to: string;
  access?: "agent" | "groups";
};

const whatsapp: Step = {
  id: "ligacao", title: "Liga o WhatsApp",
  detail: "Emparelha o número da empresa em Início e espera que a ligação apareça como ativa.",
  action: "Abrir ligação ao WhatsApp", to: "/dashboard#ligar-whatsapp"
};

const trails = {
  loja: {
    name: "Loja",
    summary: "Prepara o catálogo e confirma o primeiro pedido pelo WhatsApp.",
    icon: ShoppingBag,
    guide: "/docs#seller-catalog",
    steps: [
      whatsapp,
      { id: "produto", title: "Prepara um produto",
        detail: "Cria um produto de teste com preço e stock. Se a entrega for digital, anexa o ficheiro ou acrescenta o conteúdo de entrega.",
        action: "Abrir Catálogo e pedidos", to: "/orders?tab=products" },
      { id: "pagamento", title: "Define como receber",
        detail: "Em Vendedor → Pagamento e avisos, guarda o destinatário e o titular de pelo menos um meio de pagamento.",
        action: "Abrir Vendedor", to: "/seller" },
      { id: "agente", title: "Ativa o agente de vendas",
        detail: "Configura e testa o provedor de IA. Seleciona Agente de Vendas ou Multifuncional em Especialização, guarda e ativa o agente.",
        action: "Configurar agente de vendas", to: "/agent?focus=specialization", access: "agent" },
      { id: "teste", title: "Faz um pedido de teste",
        detail: "De outro número, pede o catálogo, envia o nome do produto e responde «peço 1» à proposta. Confirma que o pedido aguarda pagamento e tem um prazo de reserva. Depois, cancela o pedido de teste para libertar o stock.",
        action: "Consultar pedidos", to: "/orders?tab=orders", access: "agent" }
    ]
  },
  marcacoes: {
    name: "Clínica ou salão",
    summary: "Configura os horários e verifica uma marcação pelo link público.",
    icon: CalendarCheck,
    guide: "/docs#appointments-system",
    steps: [
      whatsapp,
      { id: "servico", title: "Cria um serviço",
        detail: "Adiciona uma consulta, um tratamento ou outro serviço com duração e preço. Confirma que o serviço está ativo.",
        action: "Configurar Serviços & Preços", to: "/appointments?tab=services" },
      { id: "horario", title: "Define quando se pode marcar",
        detail: "Regista quem atende e define os dias, as horas e as pausas da equipa. Deixa pelo menos um horário disponível para o teste.",
        action: "Configurar profissionais e horários", to: "/appointments?tab=professionals" },
      { id: "publico", title: "Abre o link público",
        detail: "Copia o endereço do link de marcação e abre-o numa aba privada do navegador para veres a página do cliente.",
        action: "Abrir Link de Agendamento", to: "/appointments?tab=share" },
      { id: "teste", title: "Cria e cancela uma marcação de teste",
        detail: "No link público, marca o serviço usando um horário livre e um número de teste. Confirma que a marcação aparece na Agenda. Na confirmação pública, usa o link privado Gerir marcação para a cancelar.",
        action: "Consultar Agenda & Horários", to: "/appointments?tab=agenda" }
    ]
  },
  grupos: {
    name: "Gestão de grupos",
    summary: "Configura uma regra e confirma a primeira ocorrência na fila de revisão.",
    icon: Shield,
    guide: "/docs#groups-schedule",
    steps: [
      whatsapp,
      { id: "grupo", title: "Escolhe um grupo de teste",
        detail: "Usa um grupo onde o número ligado seja administrador e outro membro de teste possa escrever.",
        action: "Abrir Grupos", to: "/groups", access: "groups" },
      { id: "regra", title: "Configura uma regra de revisão",
        detail: "Ativa as regras deste grupo. Em Ações de moderação e vendas, define Imagens como Enviar para revisão e guarda.",
        action: "Configurar moderação", to: "/groups", access: "groups" },
      { id: "teste", title: "Confirma a primeira ocorrência",
        detail: "Envia uma imagem de teste como membro sem permissões de administrador. No painel, atualiza a Fila de revisão, confirma a ocorrência e usa Marcar como revista. Depois, deixa a regra com a ação que queres usar no grupo.",
        action: "Consultar fila de revisão", to: "/groups", access: "groups" }
    ]
  }
} satisfies Record<string, { name: string; summary: string; icon: LucideIcon; guide: string; steps: Step[] }>;

type Trail = keyof typeof trails;
type Progress = { trail: Trail | null; checked: Partial<Record<Trail, string[]>> };
const trailKeys = Object.keys(trails) as Trail[];

function isTrail(value: unknown): value is Trail {
  return typeof value === "string" && Object.hasOwn(trails, value);
}

function readProgress(key: string): Progress {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null");
    const checked: Progress["checked"] = {};
    for (const trail of trailKeys) {
      const savedSteps = saved?.checked?.[trail];
      if (Array.isArray(savedSteps)) checked[trail] = trails[trail].steps.filter((step) => savedSteps.includes(step.id)).map((step) => step.id);
    }
    return { trail: isTrail(saved?.trail) ? saved.trail : null, checked };
  } catch {
    return { trail: null, checked: {} };
  }
}

export default function Onboarding({ accountId }: { accountId: string }) {
  const [params, setParams] = useSearchParams();
  const key = "agentx.onboarding." + accountId;
  const [progress, setProgress] = useState(() => readProgress(key));
  const { plan, planDetails, error, loading } = useActivation(accountId);
  const heading = useRef<HTMLHeadingElement>(null);
  const requested = params.get("percurso");
  const selected = isTrail(requested) ? requested : progress.trail;
  const trail = selected ? trails[selected] : null;
  const checked = selected ? progress.checked[selected] ?? [] : [];

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify({ ...progress, trail: selected }));
    } catch { /* The current session can still update its checklist. */ }
  }, [key, progress, selected]);

  function select(next: Trail) {
    setProgress((current) => ({ ...current, trail: next }));
    setParams({ percurso: next }, { replace: true });
    requestAnimationFrame(() => heading.current?.focus());
  }

  function checkStep(stepId: string, completed: boolean) {
    if (!selected) return;
    setProgress((current) => {
      const otherSteps = (current.checked[selected] ?? []).filter((id) => id !== stepId);
      return { ...current, checked: { ...current.checked, [selected]: completed ? [...otherSteps, stepId] : otherSteps } };
    });
  }

  return <div className="mx-auto max-w-5xl space-y-5 pb-8">
    <section aria-labelledby="onboarding-goal" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
      <h2 id="onboarding-goal" className="text-xl font-bold text-slate-900">Escolhe o teu percurso</h2>
      <div className="grid gap-2 sm:grid-cols-3">
        {trailKeys.map((id) => {
          const { name, summary, icon: Icon } = trails[id];
          return <button key={id} type="button" aria-pressed={selected === id} onClick={() => select(id)}
            className={"flex items-start gap-3 rounded-xl border p-3 text-left focus-visible:outline-2 focus-visible:outline-emerald-600 " +
              (selected === id ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:bg-slate-50")}>
            <Icon size={19} aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-700" />
            <span className="min-w-0"><strong className="block text-slate-900">{name}</strong>
              <span className="mt-1 block text-sm text-slate-600">{summary}</span></span>
          </button>;
        })}
      </div>
    </section>

    {trail && <section aria-labelledby="onboarding-steps" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 ref={heading} tabIndex={-1} id="onboarding-steps" className="text-lg font-bold text-slate-900">{trail.name}</h2>
          <p className="mt-1 text-sm text-slate-600">Assinala cada passo depois de o fazeres. O progresso é guardado neste navegador até terminares a sessão.</p>
        </div>
        <p role="status" className="text-sm font-medium text-emerald-800">{checked.length} de {trail.steps.length} passos concluídos</p>
      </div>
      <ol className="mt-4 divide-y divide-slate-100">
        {trail.steps.map((step, index) => {
          const locked = !loading && !error && (
            (step.access === "groups" && plan === "Free") || (step.access === "agent" && planDetails?.ai_enabled === false)
          );
          const done = checked.includes(step.id);
          return <li key={step.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 py-4">
            <input type="checkbox" checked={done} aria-label={"Concluir " + step.title} disabled={locked}
              onChange={(event) => checkStep(step.id, event.target.checked)}
              className="mt-1 h-5 w-5 shrink-0 rounded accent-emerald-700 focus-visible:outline-2 focus-visible:outline-emerald-600" />
            <div>
              <h3 className="font-semibold text-slate-900">{index + 1}. {step.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{step.detail}</p>
              {locked && <p className="mt-1 text-sm text-amber-800">{step.access === "groups"
                ? "A gestão de grupos requer um plano com este recurso." : "Este passo requer um plano com agente de IA."}</p>}
              <Link to={locked ? "/activate" : step.to}
                className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 pl-0 text-sm font-semibold text-emerald-800 hover:underline focus-visible:outline-2 focus-visible:outline-emerald-600">
                {locked ? "Consultar planos" : step.action} <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
          </li>;
        })}
      </ol>
      <Link to={trail.guide} className="inline-flex items-center gap-2 rounded-lg text-sm font-medium text-slate-700 hover:underline focus-visible:outline-2 focus-visible:outline-emerald-600">
        <BookOpen size={16} aria-hidden="true" /> Abrir guia detalhado
      </Link>
    </section>}
  </div>;
}
