import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, CreditCard, MessageCircle, Scissors, Shield, ShoppingBag, Stethoscope } from "lucide-react";
import { toCanonicalNiche, type BusinessNiche } from "../lib/niches";

type Task = { label: string; detail: string; to: string; plan?: boolean };

const workflows = {
  payments: {
    title: "Confirmar pagamentos",
    description: "Conferir comprovativos e concluir vendas.",
    icon: CreditCard,
    tasks: [
      { label: "Ver comprovativos de vendas", detail: "Confere valor e referência no prestador antes de aprovar.", to: "/orders?tab=verifications" },
      { label: "Rever pagamentos digitais", detail: "Abre a fila da empresa se tens acesso financeiro.", to: "/digital-orders?view=review" },
      { label: "Acompanhar pedidos e entregas", detail: "Vê quais pedidos estão pagos e quais ainda aguardam entrega.", to: "/orders?tab=orders" }
    ]
  },
  groups: {
    title: "Gerir grupos",
    description: "Configurar boas-vindas, regras e anúncios.",
    icon: Shield,
    tasks: [
      { label: "Escolher um grupo e definir regras", detail: "Configura boas-vindas e moderação. Para remover mensagens, o número ligado precisa de ser administrador.", to: "/groups", plan: true },
      { label: "Agendar um anúncio de grupo", detail: "Escolhe o grupo, o texto e a frequência da publicação.", to: "/schedule?new=group", plan: true }
    ]
  },
  sales: {
    title: "Vender e publicar",
    description: "Criar catálogo, responder a clientes e publicar Status.",
    icon: ShoppingBag,
    tasks: [
      { label: "Abrir o Vendedor", detail: "Prepara a loja, configura o pagamento e acompanha pedidos e entregas.", to: "/seller" },
      { label: "Criar um Status", detail: "Publica agora ou escolhe quando publicar e repetir.", to: "/schedule?new=status", plan: true },
      { label: "Acompanhar leads e pedidos", detail: "Retoma conversas comerciais e acompanha os pedidos criados.", to: "/leads" }
    ]
  },
  clinic: {
    title: "Atender numa clínica",
    description: "Gerir consultas, horários e lembretes.",
    icon: Stethoscope,
    tasks: [
      { label: "Configurar serviços da clínica", detail: "Define a duração e o preço de cada consulta ou serviço.", to: "/appointments?context=clinic&tab=services" },
      { label: "Definir profissionais e horários", detail: "Indica dias de atendimento, horas e pausas.", to: "/appointments?context=clinic&tab=professionals" },
      { label: "Marcar uma consulta", detail: "Regista o paciente e o WhatsApp para os avisos.", to: "/appointments?context=clinic&tab=agenda&new=appointment" },
      { label: "Ver lembretes", detail: "Consulta o estado dos avisos das próximas marcações.", to: "/appointments?context=clinic&tab=reminders" },
      { label: "Partilhar link de marcação", detail: "Deixa os pacientes escolherem serviço e horário disponíveis.", to: "/appointments?context=clinic&tab=share" },
      { label: "Configurar o agente de receção", detail: "Seleciona Receção e marcações para o agente partilhar o link pelo WhatsApp.", to: "/agent?focus=specialization", plan: true }
    ]
  },
  salon: {
    title: "Organizar um salão",
    description: "Definir serviços, equipa e marcações de clientes.",
    icon: Scissors,
    tasks: [
      { label: "Configurar serviços do salão", detail: "Adiciona corte, coloração ou outros serviços com duração e preço.", to: "/appointments?context=salon&tab=services" },
      { label: "Definir horários da equipa", detail: "Organiza os dias, turnos e pausas de cada profissional.", to: "/appointments?context=salon&tab=professionals" },
      { label: "Marcar um atendimento", detail: "Escolhe o serviço, o horário e o contacto do cliente.", to: "/appointments?context=salon&tab=agenda&new=appointment" },
      { label: "Ver lembretes", detail: "Consulta os avisos automáticos e envia um lembrete quando precisares.", to: "/appointments?context=salon&tab=reminders" },
      { label: "Partilhar link de marcação", detail: "Envia o link a clientes ou coloca-o na bio do salão.", to: "/appointments?context=salon&tab=share" },
      { label: "Configurar o agente de receção", detail: "Seleciona Receção e marcações para o agente partilhar o link pelo WhatsApp.", to: "/agent?focus=specialization", plan: true }
    ]
  }
} satisfies Record<string, { title: string; description: string; icon: typeof CreditCard; tasks: Task[] }>;

type Workflow = keyof typeof workflows;
const storageKey = (accountId: string) => `agentx.workflow.${accountId}`;

export function Workflows({ accountId, niche, whatsappStatus, free }: {
  accountId?: string | null;
  niche: BusinessNiche;
  whatsappStatus: string | null;
  free: boolean;
}) {
  const [choice, setChoice] = useState<Workflow | null>(null);
  const tasks = useRef<HTMLDivElement>(null);
  let saved: string | null = null;
  if (accountId) {
    try { saved = localStorage.getItem(storageKey(accountId)); } catch { /* Preferences are optional. */ }
  }
  const selected = choice ?? (saved && Object.hasOwn(workflows, saved) ? saved as Workflow : null);
  const canonical = toCanonicalNiche(niche);
  const suggested = canonical === "clinic" ? "clinic" : canonical === "services" ? "salon" : canonical === "retail" ? "sales" : null;
  const workflow = selected ?? suggested;
  const current = workflow && workflows[workflow];

  function select(value: Workflow) {
    setChoice(value);
    if (window.matchMedia("(max-width: 639px)").matches) {
      window.requestAnimationFrame(() => {
        tasks.current?.focus({ preventScroll: true });
        tasks.current?.scrollIntoView({ block: "nearest" });
      });
    }
    if (!accountId) return;
    try { localStorage.setItem(storageKey(accountId), value); } catch { /* The choice stays active in this view. */ }
  }

  return <section id="trabalho" aria-labelledby="workflow-title" className="scroll-mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
    <div className="border-b border-slate-100 px-4 py-4 sm:px-6 sm:py-5">
      <h2 id="workflow-title" className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">O que queres fazer?</h2>
      <p className="mt-1 text-sm text-slate-600">Escolhe uma tarefa para abrir as ações de que precisas.</p>
      <div className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-5">
        {(Object.keys(workflows) as Workflow[]).map((item) => {
          const { title, description, icon: Icon } = workflows[item];
          const active = item === workflow;
          return <button key={item} type="button" onClick={() => select(item)} aria-pressed={active}
            className={`flex min-w-0 items-start gap-2 rounded-2xl border p-2.5 sm:gap-3 sm:p-3 text-left transition focus-visible:outline-2 focus-visible:outline-emerald-600 xl:flex-col ${active
              ? "border-emerald-600 bg-emerald-50" : "border-slate-200 hover:border-emerald-300 hover:bg-slate-50"}`}>
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${active ? "bg-emerald-700 text-white" : "bg-slate-100 text-emerald-800"}`}>
              <Icon aria-hidden="true" size={17} />
            </span>
            <span><strong className="block text-sm text-slate-900">{title}</strong><span className="mt-0.5 hidden text-sm leading-snug text-slate-600 sm:block">{description}</span></span>
          </button>;
        })}
      </div>
    </div>
    <div ref={tasks} tabIndex={-1} className="bg-slate-50 px-4 py-4 focus:outline-none sm:px-6">
      {current && <div className="grid gap-2 sm:grid-cols-2" aria-label={current.title}>
        <h3 className="font-semibold text-slate-900 sm:hidden">{current.title}</h3>
        {(current.tasks as Task[]).map(({ label, detail, to, plan }, index) => (
          <Link key={to} to={free && plan ? "/activate" : to} className={`rounded-xl border p-3 focus-visible:outline-2 focus-visible:outline-emerald-600 ${index === 0 ? "border-emerald-200 bg-white hover:border-emerald-500" : "border-transparent hover:bg-white hover:border-slate-200"}`}>
            <span className="block text-sm font-semibold text-emerald-900">{label}</span>
            <span className="mt-1 block text-sm text-slate-600">{free && plan ? "Disponível num plano com este recurso." : detail}</span>
          </Link>
        ))}
      </div>}
      <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 text-sm ${current ? "mt-3 border-t border-slate-200 pt-3" : ""}`}>
        {whatsappStatus !== "connected" && <a href="#ligar-whatsapp" className="font-semibold text-emerald-800 underline underline-offset-4">
          <MessageCircle aria-hidden="true" size={16} className="mr-1 inline" /> {whatsappStatus ? "Ver ligação ao WhatsApp" : "Ligar ou verificar WhatsApp"}
        </a>}
        <Link to="/messages" className="font-semibold text-slate-700 hover:underline">Abrir conversas</Link>
        <Link to="/appointments?tab=agenda" className="font-semibold text-slate-700 hover:underline">
          <CalendarDays aria-hidden="true" size={16} className="mr-1 inline" /> Ver agenda
        </Link>
      </div>
    </div>
  </section>;
}
