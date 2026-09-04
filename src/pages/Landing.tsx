import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  Bot, Zap, Users, MessageSquare, Calendar, ShieldCheck, CheckCircle2,
  ArrowRight, Sparkles, Rocket, Menu, X, TrendingUp, Star,
  MessageCircle, PhoneCall, BarChart3, Layers, Play,
  Globe, Lock, Bolt
} from "lucide-react";
import { Button } from "../components/ui/Button";
import { cn } from "../lib/utils";
import { apiFetch } from "../lib/api";
import { motion } from "motion/react";

/* ─── custom useInView ──────────────────────────────────────────────── */
function useInView(ref: React.RefObject<Element | null>, options?: { once?: boolean }) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (options?.once) observer.disconnect();
        } else if (!options?.once) {
          setInView(false);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref, options?.once]);
  return inView;
}

/* ─── animated counter ──────────────────────────────────────────────── */
function Counter({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!inView) return;
    let start = 0;
    const step = Math.ceil(to / 60);
    const id = setInterval(() => {
      start = Math.min(start + step, to);
      setVal(start);
      if (start >= to) clearInterval(id);
    }, 20);
    return () => clearInterval(id);
  }, [inView, to]);
  return <span ref={ref}>{val.toLocaleString("pt-MZ")}{suffix}</span>;
}

/* ─── feature card ──────────────────────────────────────────────────── */
function FeatureCard({ icon: Icon, title, desc, color, delay = 0 }: {
  icon: any; title: string; desc: string; color: string; delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.55, delay }}
      className="group relative bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl sm:rounded-3xl p-6 sm:p-8 hover:bg-white/10 hover:border-white/20 transition-all duration-500 overflow-hidden"
    >
      <div className={cn("absolute -top-8 -right-8 w-32 h-32 rounded-full blur-3xl opacity-0 group-hover:opacity-20 transition-opacity duration-500", color)} />
      <div className={cn("w-12 h-12 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl flex items-center justify-center mb-5 shadow-lg shrink-0", color)}>
        <Icon className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
      </div>
      <h3 className="text-lg sm:text-xl font-black text-white uppercase italic tracking-tight mb-2">{title}</h3>
      <p className="text-slate-400 leading-relaxed text-sm font-medium">{desc}</p>
    </motion.div>
  );
}

/* ─── testimonial card ──────────────────────────────────────────────── */
function Testimonial({ name, role, text, delay = 0 }: {
  name: string; role: string; text: string; delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay }}
      className="bg-white/5 border border-white/10 rounded-2xl sm:rounded-3xl p-6 sm:p-8 hover:border-emerald-500/30 transition-all duration-300 flex flex-col"
    >
      <div className="flex mb-4 gap-1">
        {[1,2,3,4,5].map(i => <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />)}
      </div>
      <p className="text-slate-300 leading-relaxed text-sm mb-6 italic flex-1">"{text}"</p>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-teal-600 rounded-full flex items-center justify-center font-black text-white text-sm shrink-0">
          {name[0]}
        </div>
        <div>
          <p className="text-white font-black text-sm">{name}</p>
          <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">{role}</p>
        </div>
      </div>
    </motion.div>
  );
}

/* ─── main ──────────────────────────────────────────────────────────── */
export default function Landing() {
  const [plans, setPlans] = useState<any[]>([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    apiFetch("/api/auth/plans").then(d => { if (d.success) setPlans(d.data); }).catch(() => {});
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-[100dvh] bg-[#030712] text-white font-sans overflow-x-hidden selection:bg-emerald-500 selection:text-white">

      {/* ── NAVBAR ─────────────────────────────────────────────── */}
      <nav className={cn(
        "fixed top-0 w-full z-50 transition-all duration-500",
        scrolled ? "bg-[#030712]/95 backdrop-blur-xl border-b border-white/10 shadow-2xl shadow-black/50" : "bg-transparent"
      )}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16 sm:h-20">
            <Link to="/" className="flex items-center gap-2.5 sm:gap-3 group">
              <div className="bg-gradient-to-br from-emerald-400 to-teal-600 p-2 sm:p-2.5 rounded-lg sm:rounded-xl group-hover:scale-110 transition-transform shadow-lg shadow-emerald-600/30">
                <Rocket className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
              </div>
              <span className="font-black text-xl sm:text-2xl tracking-tighter uppercase italic">Agentex</span>
            </Link>

            {/* Desktop nav */}
            <div className="hidden md:flex items-center gap-8 lg:gap-10">
              {[["#features","Recursos"],["#ai-agent","Agente IA"],["#pricing","Planos"]].map(([href,label]) => (
                <a key={href} href={href} className="text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-emerald-400 transition-colors">{label}</a>
              ))}
            </div>

            <div className="hidden md:flex items-center gap-3">
              <Link to="/login">
                <Button variant="ghost" className="text-slate-300 hover:text-white font-bold uppercase tracking-widest text-xs border border-white/10 hover:border-white/30 rounded-xl px-5 h-9">
                  Entrar
                </Button>
              </Link>
              <Link to="/login">
                <Button className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-black px-6 h-9 rounded-xl shadow-lg shadow-emerald-600/30 hover:shadow-emerald-600/50 hover:scale-105 active:scale-95 transition-all text-xs uppercase tracking-widest whitespace-nowrap">
                  Começar Grátis →
                </Button>
              </Link>
            </div>

            <button className="md:hidden p-2 text-slate-300" onClick={() => setIsMenuOpen(!isMenuOpen)}>
              {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {isMenuOpen && (
          <div className="md:hidden bg-[#0a0f1a] border-t border-white/10 p-5 space-y-4">
            {[["#features","Recursos"],["#ai-agent","Agente IA"],["#pricing","Planos"]].map(([href,label]) => (
              <a key={href} href={href} className="block text-sm font-black uppercase tracking-widest text-slate-300 hover:text-emerald-400 py-1" onClick={() => setIsMenuOpen(false)}>{label}</a>
            ))}
            <Link to="/login" className="block text-sm font-black uppercase tracking-widest text-slate-300 hover:text-emerald-400 py-1" onClick={() => setIsMenuOpen(false)}>Entrar</Link>
            <Link to="/login" className="block pt-2" onClick={() => setIsMenuOpen(false)}>
              <Button className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-black py-3 rounded-xl shadow-lg shadow-emerald-600/30">
                Começar Grátis →
              </Button>
            </Link>
          </div>
        )}
      </nav>

      {/* ── HERO ───────────────────────────────────────────────── */}
      <section className="relative pt-24 sm:pt-32 pb-0 overflow-hidden">
        {/* BG blobs */}
        <div className="absolute inset-0 -z-10 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-64 sm:w-[500px] h-64 sm:h-[500px] bg-emerald-500/15 rounded-full blur-[80px] sm:blur-[120px] animate-pulse" style={{ animationDuration: "4s" }} />
          <div className="absolute bottom-0 right-1/4 w-48 sm:w-[400px] h-48 sm:h-[400px] bg-teal-500/10 rounded-full blur-[60px] sm:blur-[100px] animate-pulse" style={{ animationDuration: "6s", animationDelay: "1s" }} />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] sm:bg-[size:60px_60px] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_50%,black,transparent)]" />
        </div>

        {/* Text content */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] sm:text-xs font-black uppercase tracking-widest mb-6 sm:mb-8"
          >
            <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse shrink-0" />
            <Sparkles className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
            <span>CRM #1 em Moçambique — Powered by AI</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="text-[2.8rem] leading-[0.9] sm:text-6xl md:text-7xl lg:text-8xl xl:text-9xl font-black tracking-tighter uppercase italic mb-5 sm:mb-8"
          >
            <span className="text-white">Venda no </span>
            <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-500 bg-clip-text text-transparent">Automático</span>
            <br />
            <span className="text-white">com IA.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.25 }}
            className="text-base sm:text-lg lg:text-xl text-slate-400 max-w-xl sm:max-w-2xl mx-auto leading-relaxed font-medium mb-8 sm:mb-12 px-2"
          >
            Transforme o seu WhatsApp numa máquina de vendas. CRM profissional, automações e agente de IA que atende os seus clientes{" "}
            <strong className="text-white">24h por dia, 7 dias por semana</strong>.
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-10 sm:mb-14 px-4"
          >
            <Link to="/login" className="w-full sm:w-auto">
              <Button size="lg" className="w-full sm:w-auto bg-gradient-to-r from-emerald-500 to-teal-600 text-white h-14 sm:h-16 px-8 sm:px-14 text-sm sm:text-base font-black uppercase tracking-widest rounded-2xl shadow-2xl shadow-emerald-600/40 hover:shadow-emerald-600/60 hover:scale-105 active:scale-95 transition-all">
                Testar Grátis — Sem Cartão
              </Button>
            </Link>
            <a href="#ai-agent" className="flex items-center gap-3 text-slate-300 hover:text-white font-bold uppercase tracking-widest text-xs transition-colors group">
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white/10 border border-white/20 rounded-full flex items-center justify-center group-hover:bg-white/20 transition-all shrink-0">
                <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4 ml-0.5" />
              </div>
              Ver como funciona
            </a>
          </motion.div>

          {/* Social proof chips */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.6 }}
            className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-slate-500 text-[10px] sm:text-xs font-bold uppercase tracking-widest mb-12 sm:mb-16 px-4"
          >
            {["Configuração em 5 minutos","Sem contrato","Suporte em português","Aceita M-Pesa e e-Mola"].map(t => (
              <div key={t} className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-500 shrink-0" />
                {t}
              </div>
            ))}
          </motion.div>
        </div>

        {/* Dashboard mockup — in normal flow, not absolute */}
        <motion.div
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.2, delay: 0.5 }}
          className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8"
        >
          <div className="relative bg-gradient-to-b from-[#0d1526] to-[#060d1a] border border-white/10 rounded-t-2xl sm:rounded-t-[2.5rem] overflow-hidden shadow-[0_-20px_60px_rgba(16,185,129,0.08)] sm:shadow-[0_-40px_100px_rgba(16,185,129,0.12)]">
            {/* Chrome bar */}
            <div className="flex items-center gap-1.5 sm:gap-2 px-4 sm:px-6 py-3 sm:py-4 border-b border-white/5">
              <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-red-500/60" />
              <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-amber-500/60" />
              <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-emerald-500/60" />
              <div className="ml-3 flex-1 bg-white/5 rounded px-3 py-1 text-[9px] sm:text-[10px] text-slate-500 font-mono truncate">
                app.agentex.co.mz/mensagens
              </div>
            </div>
            {/* Chat UI */}
            <div className="flex h-48 sm:h-64 md:h-80">
              {/* Sidebar — only sm+ */}
              <div className="hidden sm:flex flex-col w-48 md:w-64 border-r border-white/5 p-2 sm:p-3 gap-1 shrink-0">
                {[
                  { name: "João Machava", msg: "Boa tarde! Quero saber...", time: "14:32", unread: 2 },
                  { name: "Maria Tembe",  msg: "Aceita M-Pesa?",           time: "14:15", unread: 0 },
                  { name: "Carlos Sitoe", msg: "Obrigado pela ajuda!",      time: "13:50", unread: 0 },
                  { name: "Ana Langa",    msg: "Qual é o preço do...",      time: "12:20", unread: 1 },
                ].map((c, i) => (
                  <div key={i} className={cn("flex items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-xl cursor-pointer", i === 0 ? "bg-emerald-500/15 border border-emerald-500/20" : "hover:bg-white/5")}>
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl bg-gradient-to-br from-emerald-400/30 to-teal-600/30 border border-emerald-500/20 flex items-center justify-center text-emerald-400 font-black text-xs sm:text-sm shrink-0">
                      {c.name[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center">
                        <span className="text-white text-[11px] sm:text-xs font-black truncate">{c.name}</span>
                        <span className="text-slate-600 text-[9px] sm:text-[10px] shrink-0 ml-1">{c.time}</span>
                      </div>
                      <p className="text-slate-500 text-[10px] sm:text-[11px] truncate">{c.msg}</p>
                    </div>
                    {c.unread > 0 && <span className="w-4 h-4 sm:w-5 sm:h-5 bg-emerald-500 rounded-full text-[9px] sm:text-[10px] font-black text-white flex items-center justify-center shrink-0">{c.unread}</span>}
                  </div>
                ))}
              </div>
              {/* Chat area */}
              <div className="flex-1 flex flex-col p-3 sm:p-5 gap-2.5 sm:gap-3 justify-end">
                <div className="bg-white/5 border border-white/10 self-start max-w-[85%] rounded-xl rounded-tl-sm px-3 sm:px-4 py-2 text-[11px] sm:text-[13px] text-slate-300">
                  Boa tarde! Quero saber mais sobre os vossos planos de internet.
                </div>
                <div className="bg-gradient-to-br from-emerald-500 to-teal-600 self-end max-w-[85%] rounded-xl rounded-tr-sm px-3 sm:px-4 py-2 text-[11px] sm:text-[13px] text-white font-medium">
                  <span>Olá João! Temos planos a partir de 999 MT/mês. Posso enviar o catálogo agora?</span>
                  <div className="flex items-center justify-end gap-1 mt-0.5">
                    <span className="text-[9px] text-emerald-200">14:33</span>
                    <CheckCircle2 className="w-2.5 h-2.5 text-emerald-200" />
                    <span className="text-[8px] text-emerald-200 font-black uppercase">IA</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          {/* Fade to bg */}
          <div className="h-16 sm:h-24 bg-gradient-to-b from-[#060d1a] to-[#030712]" />
        </motion.div>
      </section>

      {/* ── STATS BELT ─────────────────────────────────────────── */}
      <section className="py-12 sm:py-20 border-y border-white/5 bg-white/[0.02]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 sm:gap-10">
            {[
              { to: 1200, suffix: "+", label: "Empresas ativas",          color: "text-emerald-400" },
              { to: 95,   suffix: "%", label: "Taxa de resposta da IA",   color: "text-teal-400" },
              { to: 24,   suffix: "/7",label: "Disponibilidade",          color: "text-emerald-400" },
              { to: 5,    suffix: " min",label:"Para configurar",         color: "text-teal-400" },
            ].map((s, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }} className="text-center">
                <p className={cn("text-3xl sm:text-4xl lg:text-5xl font-black tracking-tighter", s.color)}>
                  <Counter to={s.to} suffix={s.suffix} />
                </p>
                <p className="text-slate-500 text-[10px] sm:text-xs font-black uppercase tracking-widest mt-1.5">{s.label}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ───────────────────────────────────────────── */}
      <section id="features" className="py-20 sm:py-32 relative">
        <div className="absolute inset-0 -z-10 pointer-events-none">
          <div className="absolute top-1/2 left-0 w-72 sm:w-[500px] h-72 sm:h-[500px] bg-blue-500/5 rounded-full blur-[80px] sm:blur-[120px]" />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-12 sm:mb-20">
            <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-slate-400 text-[10px] sm:text-xs font-black uppercase tracking-widest mb-5">
              <Layers className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> Funcionalidades
            </motion.div>
            <motion.h2 initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }}
              className="text-3xl sm:text-5xl lg:text-6xl font-black uppercase italic tracking-tighter text-white mb-4 leading-[0.9]">
              Tudo o que precisa para <span className="text-emerald-400">escalar</span>.
            </motion.h2>
            <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.2 }}
              className="text-slate-400 text-base sm:text-lg font-medium">
              Ferramentas profissionais desenhadas para o mercado moçambicano.
            </motion.p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            <FeatureCard icon={Bot}          title="Agente IA 24/7"      desc="IA treinada com o seu negócio. Atende, qualifica e fecha vendas enquanto descansa."                             color="bg-gradient-to-br from-emerald-500 to-teal-600"   delay={0}   />
            <FeatureCard icon={MessageSquare} title="Chat Centralizado"  desc="Todas as conversas do WhatsApp num único ecrã. Nunca mais perca um cliente."                                   color="bg-gradient-to-br from-blue-500 to-indigo-600"    delay={0.1} />
            <FeatureCard icon={Users}         title="CRM de Leads"       desc="Funil de vendas visual com etapas personalizadas. Saiba onde está cada cliente."                              color="bg-gradient-to-br from-violet-500 to-purple-600"  delay={0.2} />
            <FeatureCard icon={Zap}           title="Automações"         desc="Resposta por palavra-chave, menus interactivos e fluxos de follow-up sem esforço."                           color="bg-gradient-to-br from-amber-500 to-orange-600"   delay={0.3} />
            <FeatureCard icon={Calendar}      title="Agendamento"        desc="Agende mensagens e Status do WhatsApp para o horário certo, automaticamente."                                color="bg-gradient-to-br from-pink-500 to-rose-600"      delay={0.4} />
            <FeatureCard icon={BarChart3}     title="Relatórios"         desc="Métricas de conversas, taxa de resposta e desempenho das automações em tempo real."                         color="bg-gradient-to-br from-teal-500 to-cyan-600"      delay={0.5} />
          </div>
        </div>
      </section>

      {/* ── AI AGENT DEMO ───────────────────────────────────────── */}
      <section id="ai-agent" className="py-20 sm:py-32 bg-[#060d1a] relative overflow-hidden">
        <div className="absolute inset-0 -z-10 pointer-events-none">
          <div className="absolute top-0 right-0 w-64 sm:w-[600px] h-64 sm:h-[600px] bg-emerald-500/10 rounded-full blur-[100px] sm:blur-[150px]" />
          <div className="absolute bottom-0 left-0 w-48 sm:w-[400px] h-48 sm:h-[400px] bg-teal-500/8 rounded-full blur-[80px] sm:blur-[100px]" />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            {/* Text */}
            <div className="space-y-6 sm:space-y-8">
              <motion.div initial={{ opacity: 0, x: -24 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] sm:text-xs font-black uppercase tracking-widest">
                <Bot className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Inteligência Artificial Nativa
              </motion.div>

              <motion.h2 initial={{ opacity: 0, x: -24 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }}
                className="text-4xl sm:text-5xl lg:text-7xl font-black uppercase italic tracking-tighter leading-[0.85] text-white">
                O seu melhor <br />
                <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">vendedor</span> <br />
                não dorme.
              </motion.h2>

              <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.2 }}
                className="text-slate-400 text-base sm:text-lg leading-relaxed font-medium">
                Configure uma vez. O agente aprende o seu catálogo, preços e políticas e fala com os clientes em português moçambicano.
              </motion.p>

              <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.3 }}
                className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { icon: MessageCircle, label: "Responde em segundos" },
                  { icon: Lock,          label: "Nunca expõe dados" },
                  { icon: PhoneCall,     label: "Transfere para humano" },
                  { icon: Globe,         label: "Entende gíria local" },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                      <item.icon className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400" />
                    </div>
                    <span className="text-slate-300 font-medium text-sm">{item.label}</span>
                  </div>
                ))}
              </motion.div>
            </div>

            {/* Chat demo */}
            <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }}
              className="relative mt-4 lg:mt-0">
              {/* Floating badge — top right, hidden on xs */}
              <div className="hidden sm:block absolute -top-5 -right-4 lg:-top-6 lg:-right-6 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-4 lg:p-5 shadow-2xl shadow-emerald-600/40 z-10">
                <p className="text-[9px] lg:text-[10px] font-black uppercase tracking-widest text-emerald-100">Vendas Hoje</p>
                <p className="text-2xl lg:text-3xl font-black text-white mt-1">42.500<span className="text-lg lg:text-xl text-emerald-200"> MT</span></p>
              </div>

              <div className="bg-gradient-to-b from-[#0d1a2e] to-[#060d1a] border border-white/10 rounded-2xl sm:rounded-[3rem] p-5 sm:p-8 shadow-[0_30px_80px_rgba(16,185,129,0.1)] sm:shadow-[0_40px_100px_rgba(16,185,129,0.15)]">
                <div className="flex items-center gap-3 sm:gap-4 mb-6 sm:mb-8 pb-5 sm:pb-6 border-b border-white/5">
                  <div className="h-11 w-11 sm:h-14 sm:w-14 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl sm:rounded-2xl flex items-center justify-center shadow-xl shadow-emerald-600/30 shrink-0">
                    <Bot className="w-5 h-5 sm:w-7 sm:h-7 text-white" />
                  </div>
                  <div>
                    <p className="font-black text-base sm:text-xl italic uppercase tracking-tight text-white">Agente Agentex</p>
                    <p className="text-[10px] sm:text-xs text-emerald-400 font-black uppercase tracking-widest flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-emerald-400 rounded-full animate-pulse" />
                      Online agora
                    </p>
                  </div>
                </div>

                <div className="space-y-3 sm:space-y-5">
                  <div className="bg-white/5 border border-white/10 rounded-2xl sm:rounded-3xl rounded-tl-none p-3.5 sm:p-5 max-w-[90%]">
                    <p className="text-xs sm:text-sm leading-relaxed text-slate-300">Olá! Vi o seu interesse no plano Pro. Posso ajudá-lo a configurar agora mesmo?</p>
                  </div>
                  <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl sm:rounded-3xl rounded-tr-none p-3.5 sm:p-5 font-bold ml-auto max-w-[90%] shadow-lg shadow-emerald-600/20">
                    <p className="text-xs sm:text-sm text-white">Sim! Aceitam pagamento via M-Pesa?</p>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-2xl sm:rounded-3xl rounded-tl-none p-3.5 sm:p-5 max-w-[90%]">
                    <p className="text-xs sm:text-sm leading-relaxed text-slate-300">Com certeza! M-Pesa, e-Mola e transferência. Prefere plano mensal ou anual com 20% de desconto?</p>
                  </div>
                  <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl sm:rounded-3xl rounded-tr-none p-3.5 sm:p-5 font-bold ml-auto max-w-[90%] shadow-lg shadow-emerald-600/20">
                    <p className="text-xs sm:text-sm text-white">Anual! Como faço o pagamento?</p>
                  </div>
                </div>

                <div className="mt-4 sm:mt-6 flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl sm:rounded-2xl px-4 py-3">
                  <span className="text-slate-600 text-xs sm:text-sm flex-1">Escreva uma mensagem...</span>
                  <div className="w-8 h-8 sm:w-9 sm:h-9 bg-emerald-500 rounded-lg sm:rounded-xl flex items-center justify-center shrink-0">
                    <ArrowRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
                  </div>
                </div>
              </div>

              {/* Badge mobile — below card */}
              <div className="sm:hidden mt-4 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-4 shadow-xl shadow-emerald-600/30 flex items-center gap-4">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-emerald-100">Vendas Hoje</p>
                  <p className="text-2xl font-black text-white mt-0.5">42.500 <span className="text-lg text-emerald-200">MT</span></p>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ───────────────────────────────────────── */}
      <section className="py-20 sm:py-32 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 sm:mb-20">
            <motion.h2 initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              className="text-3xl sm:text-5xl lg:text-6xl font-black uppercase italic tracking-tighter text-white mb-3">
              Em 3 passos simples.
            </motion.h2>
            <p className="text-slate-400 text-base sm:text-lg font-medium">Sem complicações técnicas. Sem necessidade de programar.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 relative">
            <div className="hidden sm:block absolute top-14 left-[20%] right-[20%] h-px bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent" />
            {[
              { step: "01", icon: Bolt,       title: "Conecte o WhatsApp",   desc: "Escaneie o QR Code ou use código de pareamento. Menos de 2 minutos." },
              { step: "02", icon: Bot,        title: "Configure o Agente IA", desc: "Adicione catálogo, preços e regras. A IA aprende o seu negócio." },
              { step: "03", icon: TrendingUp, title: "Veja as vendas crescerem", desc: "O agente atende, qualifica e converte enquanto você foca no essencial." },
            ].map((item, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.15 }}
                className="text-center relative flex flex-col items-center">
                <div className="w-24 h-24 sm:w-28 sm:h-28 mb-5 bg-gradient-to-br from-[#0d1a2e] to-[#060d1a] border border-white/10 rounded-2xl sm:rounded-3xl flex items-center justify-center shadow-xl relative">
                  <item.icon className="w-8 h-8 sm:w-10 sm:h-10 text-emerald-400" />
                  <span className="absolute -top-3 -right-3 w-7 h-7 sm:w-8 sm:h-8 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-full text-[10px] sm:text-xs font-black text-white flex items-center justify-center shadow-lg">
                    {item.step}
                  </span>
                </div>
                <h3 className="text-lg sm:text-xl font-black text-white uppercase italic tracking-tight mb-2">{item.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed font-medium max-w-[260px]">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ───────────────────────────────────────── */}
      <section className="py-20 sm:py-32 bg-[#060d1a] relative overflow-hidden">
        <div className="absolute inset-0 -z-10 pointer-events-none">
          <div className="absolute bottom-0 right-0 w-64 sm:w-[500px] h-64 sm:h-[500px] bg-violet-500/8 rounded-full blur-[80px] sm:blur-[120px]" />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10 sm:mb-16">
            <motion.h2 initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              className="text-3xl sm:text-5xl lg:text-6xl font-black uppercase italic tracking-tighter text-white mb-2">
              O que dizem os <span className="text-emerald-400">nossos clientes</span>.
            </motion.h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
            <Testimonial name="Ana Machava"      role="Proprietária — Loja, Maputo"         text="Desde que instalei o Agentex as minhas vendas subiram 40%. O agente responde sozinho enquanto atendo presencialmente." delay={0} />
            <Testimonial name="Carlos Nhantumbo" role="Diretor — Logística, Beira"          text="A facilidade de agendar mensagens e ver tudo no CRM mudou completamente a nossa operação. Recomendo a todos."        delay={0.15} />
            <Testimonial name="Fátima Cossa"     role="Gestora — Clínica Privada, Nampula"  text="Os pacientes adoram a rapidez nas respostas. A IA sabe quando responder e quando transferir para a equipa."          delay={0.3} />
          </div>
        </div>
      </section>

      {/* ── PRICING ────────────────────────────────────────────── */}
      <section id="pricing" className="py-20 sm:py-32 relative">
        <div className="absolute inset-0 -z-10 pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 sm:w-[700px] h-48 sm:h-[400px] bg-emerald-500/8 rounded-full blur-[80px] sm:blur-[100px]" />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 sm:mb-20">
            <motion.h2 initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              className="text-5xl sm:text-7xl lg:text-8xl font-black uppercase italic tracking-tighter text-white mb-3">
              Preços.
            </motion.h2>
            <p className="text-slate-400 text-sm sm:text-lg font-bold uppercase tracking-widest">Simples e transparentes. Sem surpresas.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 items-start lg:items-center">
            {plans.length > 0 ? plans.map((plan, idx) => {
              const isPopular = plan.name === "Pro";
              return (
                <motion.div key={plan.id} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: idx * 0.1 }}
                  className={cn(
                    "relative flex flex-col rounded-2xl sm:rounded-[2.5rem] p-7 sm:p-10 border-2 transition-all duration-500",
                    isPopular
                      ? "bg-gradient-to-b from-emerald-500/15 to-teal-500/5 border-emerald-500/50 shadow-[0_30px_60px_rgba(16,185,129,0.15)] lg:scale-105 z-10"
                      : "bg-white/5 border-white/10 hover:border-white/20"
                  )}>
                  {isPopular && (
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-emerald-500 to-teal-600 text-white px-6 py-1.5 font-black uppercase text-[10px] sm:text-xs tracking-widest rounded-full shadow-xl shadow-emerald-600/40 whitespace-nowrap">
                      ⭐ Mais Popular
                    </div>
                  )}
                  <h3 className="text-xl sm:text-2xl font-black uppercase italic tracking-tighter text-white mb-2">{plan.name}</h3>
                  <div className="mb-6 sm:mb-8">
                    <span className="text-4xl sm:text-5xl font-black tracking-tighter text-white">{plan.price}</span>
                    <span className="text-base sm:text-lg font-black uppercase text-slate-500 ml-2">MT/mês</span>
                  </div>
                  <ul className="space-y-3 sm:space-y-4 mb-8 sm:mb-10 flex-1">
                    {[
                      `${plan.max_connections} Conexão WhatsApp`,
                      plan.max_contacts === 999999 ? "Contactos Ilimitados" : `${plan.max_contacts} Contactos`,
                      plan.ai_enabled ? "✓ Agente IA Activado" : "✗ Sem IA",
                      "Automações ilimitadas",
                      "Agendamento de mensagens",
                      "Suporte prioritário",
                    ].map((feature, fi) => (
                      <li key={fi} className={cn("flex items-center gap-3 text-sm font-bold", feature.startsWith("✗") ? "text-slate-600" : "text-slate-300")}>
                        {!feature.startsWith("✗") && !feature.startsWith("✓") && <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500 shrink-0" />}
                        {feature.startsWith("✓") && <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500 shrink-0" />}
                        {feature.startsWith("✗") && <X className="w-4 h-4 sm:w-5 sm:h-5 text-slate-700 shrink-0" />}
                        <span>{feature.replace(/^[✓✗]\s/, "")}</span>
                      </li>
                    ))}
                  </ul>
                  <Link to="/login">
                    <Button className={cn(
                      "w-full h-12 sm:h-14 text-xs sm:text-sm font-black uppercase tracking-widest rounded-xl sm:rounded-2xl transition-all hover:scale-105 active:scale-95",
                      isPopular
                        ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-xl shadow-emerald-600/40"
                        : "bg-white/10 border border-white/20 text-white hover:bg-white/20"
                    )}>
                      Começar Agora →
                    </Button>
                  </Link>
                </motion.div>
              );
            }) : [0,1,2].map(i => (
              <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-8 h-[420px] sm:h-[500px] animate-pulse" />
            ))}
          </div>

          <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
            className="text-center text-slate-500 text-xs sm:text-sm font-bold mt-8 sm:mt-10 px-4">
            💳 Aceitamos M-Pesa · e-Mola · Transferência Bancária · Cartão Visa/Mastercard
          </motion.p>
        </div>
      </section>

      {/* ── CTA FINAL ──────────────────────────────────────────── */}
      <section className="py-20 sm:py-32 relative overflow-hidden">
        <div className="absolute inset-0 -z-10 pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-b from-[#030712] via-emerald-950/20 to-[#030712]" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 sm:w-[800px] h-40 sm:h-[400px] bg-emerald-500/10 rounded-full blur-[80px] sm:blur-[120px]" />
        </div>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial={{ opacity: 0, y: 32 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="space-y-6 sm:space-y-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] sm:text-xs font-black uppercase tracking-widest">
              <Rocket className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Comece hoje mesmo
            </div>
            <h2 className="text-4xl sm:text-6xl lg:text-8xl font-black uppercase italic tracking-tighter text-white leading-[0.85]">
              Pronto para <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">decolar</span>?
            </h2>
            <p className="text-base sm:text-xl text-slate-400 font-medium max-w-2xl mx-auto leading-relaxed px-2">
              Junte-se a mais de 1.200 empresas moçambicanas que já vendem no automático com o Agentex.
            </p>
            <Link to="/login" className="block sm:inline-block">
              <Button size="lg" className="w-full sm:w-auto bg-gradient-to-r from-emerald-500 to-teal-600 text-white h-14 sm:h-16 px-8 sm:px-16 text-sm sm:text-base font-black uppercase tracking-widest rounded-2xl shadow-2xl shadow-emerald-600/40 hover:shadow-emerald-600/60 hover:scale-105 active:scale-95 transition-all">
                Criar Conta Grátis Agora →
              </Button>
            </Link>
            <p className="text-slate-600 text-[10px] sm:text-xs font-bold uppercase tracking-widest">
              Sem cartão de crédito · Cancele quando quiser
            </p>
          </motion.div>
        </div>
      </section>

      {/* ── FOOTER ─────────────────────────────────────────────── */}
      <footer className="border-t border-white/5 py-14 sm:py-20 bg-[#030712]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 sm:gap-12 mb-10 sm:mb-16">
            {/* Brand — full row on mobile */}
            <div className="col-span-2 space-y-4 sm:space-y-6">
              <Link to="/" className="flex items-center gap-2.5">
                <div className="bg-gradient-to-br from-emerald-400 to-teal-600 p-2 sm:p-2.5 rounded-lg sm:rounded-xl shadow-lg shadow-emerald-600/30 shrink-0">
                  <Rocket className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                </div>
                <span className="font-black text-xl sm:text-2xl tracking-tighter uppercase italic text-white">Agentex</span>
              </Link>
              <p className="text-slate-500 max-w-xs text-sm leading-relaxed font-medium">
                A plataforma líder em automação e CRM para WhatsApp em Moçambique. Feito por moçambicanos, para moçambicanos.
              </p>
              <p className="text-emerald-500/40 text-[9px] sm:text-[10px] font-black uppercase tracking-[0.4em] sm:tracking-[0.5em]">🇲🇿 MADE IN MOZAMBIQUE</p>
            </div>
            <div className="space-y-3">
              <p className="text-white font-black uppercase tracking-widest text-[10px] sm:text-xs mb-4 sm:mb-6">Produto</p>
              {["Recursos","Preços","Agente IA","Automações"].map(l => (
                <a key={l} href="#" className="block text-slate-500 hover:text-white text-sm font-bold transition-colors">{l}</a>
              ))}
            </div>
            <div className="space-y-3">
              <p className="text-white font-black uppercase tracking-widest text-[10px] sm:text-xs mb-4 sm:mb-6">Legal</p>
              {["Termos de Uso","Privacidade","Suporte","Contacto"].map(l => (
                <a key={l} href="#" className="block text-slate-500 hover:text-white text-sm font-bold transition-colors">{l}</a>
              ))}
            </div>
          </div>

          <div className="border-t border-white/5 pt-6 sm:pt-8 flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">
            <p className="text-slate-600 text-[10px] sm:text-xs font-bold uppercase tracking-widest text-center sm:text-left">
              © {new Date().getFullYear()} Agentex. Todos os direitos reservados.
            </p>
            <div className="flex items-center gap-2 sm:gap-3">
              <ShieldCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-500/50" />
              <p className="text-slate-600 text-[10px] sm:text-xs font-bold">Dados 100% seguros e encriptados</p>
            </div>
          </div>
        </div>
      </footer>

    </div>
  );
}
