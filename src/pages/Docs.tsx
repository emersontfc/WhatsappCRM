import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, CalendarCheck, Check, ChevronDown,
  ChevronRight, Copy, Info, ListChecks, MessageCircle, Search, ShieldCheck, ShoppingBag, UsersRound, X
} from "lucide-react";
import AgentXLogo from "../components/AgentXLogo";
import { guideGroups, guides, searchGuides } from "../lib/agentxGuides";

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2";

const startingPoints = [
  { id: "first-test", label: "Preparar o primeiro teste", icon: ListChecks },
  { id: "seller-catalog", label: "Vender produtos", icon: ShoppingBag },
  { id: "seller-team", label: "Organizar a equipa", icon: UsersRound },
  { id: "appointments-system", label: "Organizar marcações", icon: CalendarCheck },
  { id: "groups-schedule", label: "Moderar grupos", icon: ShieldCheck },
  { id: "messages-inbox", label: "Atender clientes", icon: MessageCircle }
];

export default function Docs() {
  const { hash, pathname, key } = useLocation();
  const [query, setQuery] = useState("");
  const [copiedCommand, setCopiedCommand] = useState("");
  const [clipboardStatus, setClipboardStatus] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const mobileIndex = useRef<HTMLDetailsElement>(null);
  const main = useRef<HTMLElement>(null);
  const article = useRef<HTMLElement>(null);

  const selected = guides.find((guide) => `#${guide.id}` === hash) ?? guides[0];
  const selectedIndex = guides.indexOf(selected);
  const SectionIcon = selected.icon;
  const searching = Boolean(query.trim());
  const results = searching ? searchGuides(query) : [];
  const sectionUrl = (id: string) => `${pathname}#${id}`;

  useEffect(() => {
    const previous = document.title;
    document.title = "Documentação | AgentX";
    return () => { document.title = previous; };
  }, []);

  useEffect(() => {
    if (!guides.some((guide) => `#${guide.id}` === hash)) return;
    const frame = requestAnimationFrame(() => {
      article.current?.scrollIntoView({ block: "start" });
      article.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [hash, key]);

  const openGuide = () => {
    setQuery("");
    setCopiedCommand("");
    setClipboardStatus("");
    if (mobileIndex.current) mobileIndex.current.open = false;
  };

  const clearSearch = () => {
    setQuery("");
    searchInput.current?.focus();
  };

  const copyCommand = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedCommand(command);
      setClipboardStatus("Comando copiado.");
    } catch {
      setCopiedCommand("");
      setClipboardStatus("Seleciona o texto do comando para copiar manualmente.");
    }
  };

  function renderIndex() {
    return (
      <nav aria-label="Índice dos guias" className="space-y-6">
        {guideGroups.map((group) => (
          <div key={group}>
            <p className="mb-2 px-3 text-xs font-semibold text-slate-500">{group}</p>
            <ul className="space-y-0.5">
              {guides.filter((guide) => guide.group === group).map((guide) => {
                const Icon = guide.icon;
                const active = !searching && selected.id === guide.id;
                return (
                  <li key={guide.id}>
                    <Link to={sectionUrl(guide.id)} onClick={openGuide} aria-current={active ? "location" : undefined}
                      className={`flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${focusRing} ${active
                        ? "bg-emerald-50 font-semibold text-emerald-800"
                        : "text-slate-700 hover:bg-slate-100 hover:text-slate-950"}`}>
                      <Icon size={16} aria-hidden="true" className={active ? "shrink-0 text-emerald-700" : "shrink-0 text-slate-500"} />
                      <span>{guide.title}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f8f7] text-slate-900">
      <a href="#conteudo-docs" onClick={(event) => { event.preventDefault(); main.current?.focus(); }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-emerald-900">
        Saltar para o conteúdo
      </a>
      <header className="sticky top-0 z-20 border-b border-slate-200/90 bg-white/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <Link to="/" aria-label="AgentX, página inicial" className={`shrink-0 rounded-lg ${focusRing}`}>
              <AgentXLogo size="sm" />
            </Link>
            <span className="hidden border-l border-slate-200 pl-4 text-sm font-medium text-slate-600 sm:block">Documentação</span>
          </div>
          <Link to="/dashboard" className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800 sm:gap-2 sm:px-4 ${focusRing}`}>
            Abrir painel <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </header>

      <main id="conteudo-docs" ref={main} tabIndex={-1} className="mx-auto max-w-7xl scroll-mt-20 px-4 pb-12 pt-5 focus:outline-none sm:px-8 sm:pt-8">
        <section aria-labelledby="docs-title"
          className="grid gap-7 rounded-3xl border border-emerald-950 bg-[#102c27] bg-[radial-gradient(ellipse_at_top_right,#255949_0%,transparent_70%)] p-6 text-white sm:p-9 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,25rem)] lg:items-end lg:gap-10">
          <div>
            <h1 id="docs-title" className="text-[2rem] font-bold leading-tight tracking-tight sm:text-4xl lg:text-[2.75rem]">Como usar o AgentX</h1>
            <p className="mt-3 max-w-lg text-sm leading-6 text-emerald-50/90 sm:text-base">
              Liga o WhatsApp, segue o primeiro teste e aprende a gerir vendas, tarefas da equipa, grupos e marcações.
            </p>
          </div>
          <div role="search" className="min-w-0">
            <label htmlFor="doc-search" className="mb-2 block text-sm font-medium text-emerald-50">Pesquisar nos guias</label>
            <div className="flex items-center gap-2 rounded-xl border border-white/25 bg-white px-3 text-slate-900 shadow-sm focus-within:ring-2 focus-within:ring-emerald-300">
              <Search size={19} aria-hidden="true" className="shrink-0 text-emerald-700" />
              <input id="doc-search" ref={searchInput} type="search" autoComplete="off" value={query}
                onChange={(event) => setQuery(event.target.value)} placeholder="Ex. comprovativos, áudio, agenda"
                className="min-h-12 min-w-0 flex-1 bg-transparent text-base placeholder:text-slate-500 focus:outline-none sm:text-sm [&::-webkit-search-cancel-button]:appearance-none" />
              {query && <button type="button" onClick={clearSearch} aria-label="Limpar pesquisa"
                className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 ${focusRing}`}>
                <X size={17} aria-hidden="true" />
              </button>}
            </div>
          </div>
        </section>

        <div className="mt-5 grid gap-5 sm:mt-7 lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:gap-7">
          <aside className="hidden lg:block">
            <div className="sticky top-21 max-h-[calc(100dvh-6.5rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3">
              <p className="mb-5 flex items-center gap-2 px-3 pt-2 text-sm font-semibold text-slate-900"><BookOpen size={17} aria-hidden="true" className="text-emerald-700" /> Guias</p>
              {renderIndex()}
            </div>
          </aside>

          <details ref={mobileIndex} className="group min-w-0 rounded-2xl border border-slate-200 bg-white lg:hidden">
            <summary className={`flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden ${focusRing}`}>
              <span className="flex items-center gap-2"><BookOpen size={17} aria-hidden="true" className="text-emerald-700" /> Guias</span>
              <ChevronDown size={18} aria-hidden="true" className="shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-slate-100 px-3 pb-4 pt-4">{renderIndex()}</div>
          </details>

          <div className="min-w-0">
            {searching ? (
              <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-7" aria-labelledby="docs-results">
                <div className="mb-5">
                  <h2 id="docs-results" className="text-xl font-bold tracking-tight">Resultados da pesquisa</h2>
                  <p role="status" className="mt-1 text-sm text-slate-600">
                    {results.length === 1 ? "1 guia encontrado" : `${results.length} guias encontrados`}
                  </p>
                </div>
                {results.length ? (
                  <ul className="space-y-2">
                    {results.map((guide) => {
                      const Icon = guide.icon;
                      return (
                        <li key={guide.id}>
                          <Link to={sectionUrl(guide.id)} onClick={openGuide}
                            className={`flex items-start gap-3 rounded-xl border border-slate-200 p-3.5 hover:border-emerald-300 hover:bg-emerald-50/60 sm:p-4 ${focusRing}`}>
                            <Icon size={19} aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-700" />
                            <span className="min-w-0 flex-1">
                              <span className="block font-semibold">{guide.title}</span>
                              <span className="mt-1 block text-sm leading-6 text-slate-600">{guide.summary}</span>
                            </span>
                            <ChevronRight size={17} aria-hidden="true" className="mt-1 shrink-0 text-slate-500" />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="rounded-xl bg-slate-50 px-4 py-6 text-sm text-slate-700">
                    <p>Tenta pesquisar por um assunto, como pagamento, grupo ou ligação.</p>
                    <button type="button" onClick={clearSearch} className={`mt-3 rounded font-semibold text-emerald-800 underline underline-offset-4 ${focusRing}`}>
                      Limpar pesquisa e voltar ao guia
                    </button>
                  </div>
                )}
              </section>
            ) : (
              <article id={selected.id} ref={article} tabIndex={-1} aria-labelledby="guide-title"
                className="scroll-mt-21 rounded-2xl border border-slate-200 bg-white p-4 focus:outline-none sm:p-7 lg:p-8">
                <header className="flex items-start gap-3 sm:gap-4">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-800 sm:size-13">
                    <SectionIcon size={23} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-emerald-800 sm:text-sm">{selected.group}</p>
                    <h2 id="guide-title" className="mt-1 text-2xl font-bold leading-tight tracking-tight sm:text-3xl">{selected.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600 sm:text-base">{selected.summary}</p>
                  </div>
                </header>

                {selectedIndex === 0 && (
                  <nav aria-label="Atalhos para começar" className="mt-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {startingPoints.map(({ id, label, icon: Icon }) => (
                      <Link key={id} to={sectionUrl(id)} onClick={openGuide}
                        className={`flex min-h-12 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 hover:border-emerald-300 hover:bg-emerald-50 ${focusRing}`}>
                        <Icon size={17} aria-hidden="true" className="shrink-0 text-emerald-700" />
                        <span className="flex-1">{label}</span>
                        <ArrowRight size={15} aria-hidden="true" className="shrink-0 text-emerald-800" />
                      </Link>
                    ))}
                  </nav>
                )}

                <ol className="mt-7 space-y-4">
                  {selected.steps.map(({ title, detail, link }, index) => (
                    <li key={title} className="flex gap-3 border-t border-slate-100 pt-4 sm:gap-4">
                      <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xs font-bold text-emerald-800">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-slate-900">{title}</h3>
                        <p className="mt-1 text-sm leading-6 text-slate-700 sm:text-[0.95rem]">{detail}</p>
                        {link && <Link to={link.to.startsWith("#") ? sectionUrl(link.to.slice(1)) : link.to}
                          onClick={link.to.startsWith("#") ? openGuide : undefined}
                          className={`mt-1.5 inline-flex items-center gap-1.5 rounded text-sm font-semibold text-emerald-800 underline-offset-4 hover:underline ${focusRing}`}>
                          {link.label}<ArrowRight size={14} aria-hidden="true" className="shrink-0" />
                        </Link>}
                      </div>
                    </li>
                  ))}
                </ol>

                {selected.commands && (
                  <div className="mt-6 space-y-2">
                    <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-slate-50">
                      {selected.commands.map(({ text, detail }) => (
                        <li key={text} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-3 sm:flex-nowrap sm:p-4">
                          <div className="min-w-0">
                            <code className="break-words text-sm font-semibold text-emerald-900">{text}</code>
                            <p className="mt-1 text-sm leading-5 text-slate-600">{detail}</p>
                          </div>
                          <button type="button" aria-label={`Copiar comando ${text}`} onClick={() => void copyCommand(text)}
                            className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold hover:bg-slate-100 ${focusRing}`}>
                            {copiedCommand === text ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                            {copiedCommand === text ? "Copiado" : "Copiar"}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <p role="status" className="text-sm text-slate-600">{clipboardStatus}</p>
                  </div>
                )}

                {selected.note && (
                  <div className="mt-6 flex gap-3 rounded-xl border border-emerald-100 bg-emerald-50/70 p-3.5 sm:p-4">
                    <Info size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-800" />
                    <div>
                      <h3 className="text-sm font-semibold text-emerald-950">{selected.note.title}</h3>
                      <p className="mt-1 text-sm leading-6 text-emerald-950/85">{selected.note.detail}</p>
                    </div>
                  </div>
                )}

                <Link to={selected.action.to} className={`mt-6 inline-flex min-h-11 max-w-full items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 ${focusRing}`}>
                  <span>{selected.action.label}</span><ArrowUpRight size={16} aria-hidden="true" className="shrink-0" />
                </Link>

                <nav aria-label="Guias anterior e seguinte" className="mt-7 grid grid-cols-1 gap-2 border-t border-slate-200 pt-4 sm:grid-cols-2">
                  {selectedIndex > 0 && (
                    <Link to={sectionUrl(guides[selectedIndex - 1].id)} onClick={openGuide}
                      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 ${focusRing}`}>
                      <ArrowLeft size={16} aria-hidden="true" className="shrink-0 text-emerald-700" />
                      <span><span className="block text-xs text-slate-500">Anterior</span><span className="font-semibold">{guides[selectedIndex - 1].title}</span></span>
                    </Link>
                  )}
                  {selectedIndex < guides.length - 1 && (
                    <Link to={sectionUrl(guides[selectedIndex + 1].id)} onClick={openGuide}
                      className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 sm:col-start-2 ${focusRing}`}>
                      <span><span className="block text-xs text-slate-500">Seguinte</span><span className="font-semibold">{guides[selectedIndex + 1].title}</span></span>
                      <ArrowRight size={16} aria-hidden="true" className="shrink-0 text-emerald-700" />
                    </Link>
                  )}
                </nav>
              </article>
            )}

            <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 px-1 py-2 text-sm text-slate-600">
              <span>Precisas de ajuda?</span>
              <a href="https://wa.me/258848858288" target="_blank" rel="noreferrer"
                className={`inline-flex min-h-9 items-center gap-1.5 rounded font-semibold text-emerald-800 hover:underline ${focusRing}`}>
                Falar com o suporte <ArrowUpRight size={15} aria-hidden="true" />
              </a>
            </footer>
          </div>
        </div>
      </main>
    </div>
  );
}
