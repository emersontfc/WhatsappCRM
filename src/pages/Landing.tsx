import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, BookOpen, CalendarCheck, CheckCircle2, Clock3, ContactRound, FileCheck2, FileText,
  Menu, MessageCircle, PackageCheck, ShieldCheck, ShoppingBag, Terminal, UsersRound, X
} from "lucide-react";
import AgentXLogo from "../components/AgentXLogo";
import { apiFetch } from "../lib/api";

const navItems = [
  { href: "#ai-agent", label: "Vendas" },
  { href: "#features", label: "Operação" },
  { href: "#first-test", label: "Primeiro teste" },
  { href: "#pricing", label: "Planos" }
];

const saleSteps = [
  {
    icon: ShoppingBag,
    title: "Do catálogo à proposta",
    detail: "O agente consulta o preço e o stock atuais, esclarece dúvidas e apresenta uma proposta no WhatsApp."
  },
  {
    icon: PackageCheck,
    title: "Reserva antes de pagar",
    detail: "Quando o cliente aceita a proposta, o AgentX cria o pedido e reserva o stock. Só então envia o valor, o prazo, a referência e os dados de pagamento configurados."
  },
  {
    icon: FileCheck2,
    title: "Comprovativo para revisão",
    detail: "O cliente envia uma foto ou um PDF pelo WhatsApp. O ficheiro fica privado e segue para a equipa confirmar o recebimento no prestador e aprovar no painel."
  },
  {
    icon: CheckCircle2,
    title: "Entrega após aprovação",
    detail: "Para produtos digitais com ficheiro configurado, o AgentX pode enviar a entrega pelo WhatsApp depois da aprovação. A equipa acompanha o estado no pedido."
  }
];

const firstTests = [
  {
    icon: ShoppingBag,
    name: "Loja",
    detail: "Adiciona um produto, liga o agente ao catálogo e faz um pedido de teste pelo WhatsApp. No painel, confere a reserva e cancela o teste para libertar o stock.",
    link: "/docs#seller-catalog",
    label: "Guia da loja"
  },
  {
    icon: CalendarCheck,
    name: "Clínica ou salão",
    detail: "Configura serviços, profissionais e horários. Faz uma marcação de teste pelo link público, verifica-a na agenda e usa o link do cliente para remarcar ou cancelar. Acompanha os lembretes pelo WhatsApp.",
    link: "/docs#appointments-system",
    label: "Guia de marcações"
  },
  {
    icon: ShieldCheck,
    name: "Gestão de grupos",
    detail: "Ativa regras por tipo de conteúdo e testa a fila de revisão. Nos grupos autorizados, agenda promoções e deixa os membros pedir o catálogo com /loja.",
    link: "/docs#groups-schedule",
    label: "Guia de grupos"
  }
];

const operations = [
  { icon: ContactRound, title: "Contactos e leads", detail: "Organiza os contactos e acompanha cada oportunidade no funil de vendas.", to: "/docs#leads-funnel" },
  { icon: Clock3, title: "Mensagens e Status", detail: "Agenda envios para mais tarde. O servidor guarda-os mesmo depois de fechares o painel.", to: "/docs#schedule-messages" },
  { icon: Terminal, title: "Comandos pelo WhatsApp", detail: "Do número autorizado, consulta mensagens por ler, leads recentes e próximos envios.", to: "/docs#whatsapp-commands" }
];

const container = "mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8";
const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-400";
const guideLink = "inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-emerald-300 hover:text-white " + focus;
const primaryLink = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-400 px-5 py-3 text-center text-sm font-bold text-slate-950 shadow-lg shadow-emerald-950/30 hover:bg-emerald-300 " + focus;
const secondaryLink = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-center text-sm font-semibold text-slate-100 hover:border-emerald-400/50 hover:bg-white/10 " + focus;

function SalePreview() {
  return (
    <figure className="min-w-0 overflow-hidden rounded-3xl border border-emerald-300/20 bg-[#081522] shadow-2xl shadow-emerald-950/40">
      <figcaption className="flex items-center gap-3 border-b border-white/10 px-4 py-4 sm:px-6">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-400/15 text-emerald-300">
          <MessageCircle size={19} aria-hidden="true" />
        </span>
        <div>
          <p className="font-semibold text-white">Venda pelo WhatsApp</p>
          <p className="text-xs text-slate-400">Exemplo de conversa</p>
        </div>
      </figcaption>
      <div className="space-y-3 px-4 py-5 sm:px-6 sm:py-6">
        <p className="w-fit max-w-[88%] rounded-xl rounded-tl-sm bg-slate-800 px-3 py-2 text-sm leading-relaxed text-slate-100">
          Têm a mochila preta?
        </p>
        <p className="ml-auto w-fit max-w-[90%] rounded-xl rounded-tr-sm border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-sm leading-relaxed text-emerald-50">
          Sim. Custa 950 MT e está disponível. Queres reservar uma?
        </p>
        <p className="w-fit max-w-[88%] rounded-xl rounded-tl-sm bg-slate-800 px-3 py-2 text-sm leading-relaxed text-slate-100">
          Peço 1.
        </p>
        <div className="ml-auto w-fit max-w-[90%] rounded-xl rounded-tr-sm border border-emerald-400/20 bg-emerald-400/10 px-3 py-2">
          <p className="text-sm font-semibold text-emerald-200">Pedido reservado · 950 MT</p>
          <p className="mt-1 text-sm leading-relaxed text-emerald-50">Segue a referência e os dados de pagamento do teu pedido.</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/10 pt-4 sm:mt-5">
          <span className="inline-flex items-center gap-2 text-sm text-slate-100">
            <FileText size={16} aria-hidden="true" className="shrink-0 text-emerald-300" /> Comprovativo.pdf
          </span>
          <span className="text-xs font-semibold text-amber-200">Aguarda revisão</span>
        </div>
      </div>
    </figure>
  );
}

type Plan = {
  id: string;
  name: string;
  price: number;
  max_contacts: number;
  max_messages_per_day: number;
  ai_enabled: boolean;
};
type Plans =
  | { state: "loading" | "error" }
  | { state: "loaded"; items: Plan[] };

function Pricing() {
  const [plans, setPlans] = useState<Plans>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch("/api/auth/plans", { authenticate: false, timeout: 8_000, signal: controller.signal })
      .then((result) => {
        if (!result?.success || !Array.isArray(result.data)) throw new Error("Planos indisponíveis");
        if (!controller.signal.aborted) setPlans({ state: "loaded", items: result.data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setPlans({ state: "error" });
      });
    return () => controller.abort();
  }, [attempt]);

  return (
    <section id="pricing" aria-labelledby="landing-plans" className="scroll-mt-24 border-y border-white/10 bg-[#08111e] py-14 sm:py-20">
      <div className={container}>
        <div className="mb-7 max-w-xl sm:mb-9">
          <h2 id="landing-plans" className="text-3xl font-bold tracking-tight sm:text-4xl">Planos</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-300 sm:text-base">Compara os limites e os recursos disponíveis para a tua operação.</p>
        </div>
        {plans.state === "loaded" && plans.items.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {plans.items.map((plan) => (
              <article key={plan.id} className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
                <h3 className="text-lg font-semibold">{plan.name}</h3>
                <p className="mt-3 text-3xl font-bold tracking-tight">
                  {new Intl.NumberFormat("pt-MZ").format(plan.price)} <span className="text-sm font-medium tracking-normal text-slate-300">MT/mês</span>
                </p>
                <ul className="my-5 flex-1 space-y-2 text-sm leading-relaxed text-slate-300">
                  <li>Ligação ao WhatsApp</li>
                  <li>{plan.max_contacts === 999999 ? "Contactos ilimitados" : `${plan.max_contacts} contactos`}</li>
                  <li>{plan.max_messages_per_day} mensagens por dia</li>
                  {plan.ai_enabled && <li>Agente de IA disponível</li>}
                </ul>
                <Link to="/login" className={secondaryLink}>Aceder ao AgentX <ArrowRight size={16} aria-hidden="true" /></Link>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-sm text-slate-300">
            {plans.state === "loading" && <p role="status">A consultar os planos…</p>}
            {plans.state === "loaded" && <p role="status">Ainda não há planos disponíveis para consulta.</p>}
            {plans.state === "error" && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p role="status">De momento, a consulta de planos está indisponível.</p>
                <button type="button" className={secondaryLink} onClick={() => {
                  setPlans({ state: "loading" });
                  setAttempt((previous) => previous + 1);
                }}>Tentar novamente</button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-[100dvh] bg-[#030712] font-sans text-white selection:bg-emerald-400 selection:text-slate-950">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#030712]/95 backdrop-blur-xl">
        <nav aria-label="Navegação principal" className={container}>
          <div className="flex min-h-16 items-center justify-between gap-4 py-2">
            <Link to="/" aria-label="AgentX, página inicial" className={"rounded-lg " + focus}>
              <AgentXLogo size="md" inverted />
            </Link>
            <div className="hidden items-center gap-5 lg:flex xl:gap-7">
              {navItems.map(({ href, label }) => (
                <a key={href} href={href} className={"rounded-md text-sm font-medium text-slate-300 hover:text-white " + focus}>{label}</a>
              ))}
              <Link to="/docs" className={"rounded-md text-sm font-semibold text-emerald-300 hover:text-white " + focus}>Documentação</Link>
            </div>
            <div className="hidden items-center gap-4 lg:flex">
              <Link to="/login" className={"rounded-md text-sm font-semibold text-slate-200 hover:text-white " + focus}>Entrar</Link>
              <Link to="/login" className={primaryLink}>Começar grátis</Link>
            </div>
            <button
              type="button"
              aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
              aria-expanded={menuOpen}
              aria-controls="landing-menu"
              onClick={() => setMenuOpen((open) => !open)}
              className={"grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-white/10 text-slate-200 hover:bg-white/10 lg:hidden " + focus}
            >
              {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
            </button>
          </div>
          <div id="landing-menu" hidden={!menuOpen} className="border-t border-white/10 py-2 lg:hidden">
            {navItems.map(({ href, label }) => (
              <a key={href} href={href} onClick={() => setMenuOpen(false)} className={"block rounded-lg px-2 py-3 text-sm font-medium text-slate-200 " + focus}>{label}</a>
            ))}
            <Link to="/docs" onClick={() => setMenuOpen(false)} className={"block rounded-lg px-2 py-3 text-sm font-semibold text-emerald-300 " + focus}>Documentação</Link>
            <Link to="/login" onClick={() => setMenuOpen(false)} className={"block rounded-lg px-2 py-3 text-sm font-semibold text-slate-200 " + focus}>Entrar</Link>
          </div>
        </nav>
      </header>

      <main>
        <section aria-labelledby="landing-title" className="relative isolate border-b border-white/10 py-12 sm:py-16 lg:py-24">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_right,rgba(16,185,129,0.16),transparent_65%)]" />
          <div className={container + " grid items-center gap-9 lg:grid-cols-[1.03fr_0.97fr] lg:gap-14 xl:gap-20"}>
            <div className="min-w-0">
              <h1 id="landing-title" className="max-w-3xl text-[2.25rem] font-black leading-[1.07] tracking-tight sm:text-5xl lg:text-6xl">
                Vende pelo WhatsApp <span className="text-emerald-300">com o pagamento sob controlo.</span>
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">
                O agente propõe produtos do teu catálogo e reserva o stock antes de passar os dados de pagamento. A tua equipa revê os comprovativos e confirma cada pagamento no painel.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Link to="/login" className={primaryLink}>Começar grátis <ArrowRight size={17} aria-hidden="true" /></Link>
                <a href="#ai-agent" className={secondaryLink}>Ver como funciona uma venda</a>
              </div>
              <p className="mt-4 text-sm text-slate-400">Configura M-Pesa, e-Mola e transferência bancária na mesma loja.</p>
            </div>
            <SalePreview />
          </div>
        </section>

        <section id="ai-agent" aria-labelledby="landing-sale" className="scroll-mt-24 py-14 sm:py-20">
          <div className={container}>
            <div className="mb-7 max-w-2xl sm:mb-9">
              <h2 id="landing-sale" className="text-3xl font-bold tracking-tight sm:text-4xl">Da primeira mensagem à entrega.</h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-300 sm:text-base">Acompanha a venda do catálogo ao comprovativo no mesmo pedido.</p>
            </div>
            <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {saleSteps.map(({ icon: Icon, title, detail }) => (
                <li key={title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
                  <Icon size={23} className="text-emerald-300" aria-hidden="true" />
                  <h3 className="mt-3 font-semibold text-white">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-300">{detail}</p>
                </li>
              ))}
            </ol>
            <div className="mt-4 flex flex-wrap gap-x-6">
              <Link to="/docs#seller-catalog" className={guideLink}>Ver catálogo e pedidos <ArrowRight size={15} aria-hidden="true" /></Link>
              <Link to="/docs#seller-payments" className={guideLink}>Como rever comprovativos <ArrowRight size={15} aria-hidden="true" /></Link>
            </div>
          </div>
        </section>

        <section id="features" aria-labelledby="landing-operations" className="scroll-mt-24 border-y border-white/10 bg-[#08111e] py-14 sm:py-20">
          <div className={container + " grid gap-7 lg:grid-cols-[0.9fr_1.1fr] lg:gap-x-14"}>
            <div>
              <h2 id="landing-operations" className="text-3xl font-bold tracking-tight sm:text-4xl">Vendas e financeiro na mesma equipa.</h2>
              <p className="mt-3 max-w-lg text-sm leading-relaxed text-slate-300 sm:text-base">
                Cada pessoa trabalha com a própria conta. A fila de tarefas mostra o que precisa de atenção, dos comprovativos pendentes às entregas por concluir.
              </p>
              <Link to="/docs#seller-team" className={guideLink + " mt-3"}>Conhecer funções e tarefas <ArrowRight size={15} aria-hidden="true" /></Link>
            </div>
            <div className="grid min-w-0 gap-3">
              <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-5">
                <UsersRound size={22} className="mt-0.5 shrink-0 text-emerald-300" aria-hidden="true" />
                <div>
                  <h3 className="font-semibold text-white">Vendedor e responsável financeiro</h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-300">O vendedor gere catálogo, pedidos e entregas. O responsável financeiro abre os comprovativos privados e regista a aprovação ou a rejeição.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-5">
                <MessageCircle size={22} className="mt-0.5 shrink-0 text-emerald-300" aria-hidden="true" />
                <div>
                  <h3 className="font-semibold text-white">Avisos pelo WhatsApp</h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-300">Configura o número que recebe avisos sobre pagamentos. Quando um envio precisa de atenção, consulta o estado na fila.</p>
                  <Link to="/docs#seller-notices" className={guideLink}>Consultar o guia de avisos <ArrowRight size={15} aria-hidden="true" /></Link>
                </div>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3 lg:col-span-2">
              {operations.map(({ icon: Icon, title, detail, to }) => (
                <Link key={to} to={to} className={"rounded-xl border border-white/10 p-4 hover:border-emerald-400/50 hover:bg-white/5 " + focus}>
                  <span className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Icon size={17} className="shrink-0 text-emerald-300" aria-hidden="true" />
                    <span className="flex-1">{title}</span>
                    <ArrowRight size={15} className="shrink-0 text-emerald-300" aria-hidden="true" />
                  </span>
                  <span className="mt-2 block text-sm leading-relaxed text-slate-300">{detail}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section id="first-test" aria-labelledby="landing-first-test" className="scroll-mt-24 py-14 sm:py-20">
          <div className={container}>
            <div className="mb-7 max-w-2xl sm:mb-9">
              <h2 id="landing-first-test" className="text-3xl font-bold tracking-tight sm:text-4xl">Escolhe o teu primeiro teste.</h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-300 sm:text-base">No painel, a área Primeiro teste guia a configuração e indica onde confirmar que o fluxo ficou a funcionar.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {firstTests.map(({ icon: Icon, name, detail, link, label }) => (
                <article key={name} className="flex min-w-0 flex-col rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.04] p-5 sm:p-6">
                  <Icon size={24} aria-hidden="true" className="text-emerald-300" />
                  <h3 className="mt-3 text-lg font-semibold">{name}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-300">{detail}</p>
                  <Link to={link} className={guideLink + " mt-3 self-start"}>{label} <ArrowRight size={15} aria-hidden="true" /></Link>
                </article>
              ))}
            </div>
            <Link to="/docs#first-test" className={guideLink + " mt-4"}><BookOpen size={16} aria-hidden="true" /> Ler os passos do primeiro teste</Link>
          </div>
        </section>

        <Pricing />

        <section aria-labelledby="landing-start" className="bg-[radial-gradient(ellipse_at_center,rgba(16,185,129,0.12),transparent_75%)] py-14 sm:py-20">
          <div className={container + " text-center"}>
            <h2 id="landing-start" className="mx-auto max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl">Experimenta com o teu próprio WhatsApp.</h2>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-slate-300 sm:text-base">Cria a tua conta, liga o número do negócio e abre Primeiro teste no painel.</p>
            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <Link to="/login" className={primaryLink}>Criar conta grátis <ArrowRight size={17} aria-hidden="true" /></Link>
              <Link to="/docs" className={secondaryLink}>Explorar a documentação</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 py-8">
        <div className={container + " flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"}>
          <Link to="/" aria-label="AgentX, página inicial" className={"w-fit rounded-lg " + focus}><AgentXLogo size="md" inverted /></Link>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <Link to="/docs#messages-inbox" className={"rounded-md text-sm text-slate-300 hover:text-white " + focus}>Conversas e atendimento</Link>
            <Link to="/docs#schedule-messages" className={"rounded-md text-sm text-slate-300 hover:text-white " + focus}>Mensagens e publicações</Link>
          </div>
          <p className="text-sm text-slate-400">© {new Date().getFullYear()} AgentX</p>
        </div>
      </footer>
    </div>
  );
}
