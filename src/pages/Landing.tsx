import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Bot, Zap, Users, MessageSquare, Calendar, ShieldCheck, CheckCircle2, ArrowRight, MessageCircle, Globe, Sparkles, Rocket, Menu, X } from "lucide-react";
import { Button } from "../components/ui/Button";
import { cn } from "../lib/utils";
import { apiFetch } from "../lib/api";
import { motion } from "motion/react";

export default function Landing() {
  const [plans, setPlans] = useState<any[]>([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    const fetchPlans = async () => {
      try {
        const data = await apiFetch("/api/auth/plans");
        if (data.success) {
          setPlans(data.data);
        }
      } catch (err) {
        console.error("Error fetching plans:", err);
      }
    };
    fetchPlans();
  }, []);

  return (
    <div className="min-h-screen bg-white font-sans text-slate-900 selection:bg-emerald-500 selection:text-white">
      {/* Navbar */}
      <nav className="fixed top-0 w-full bg-white/90 backdrop-blur-xl z-50 border-b border-slate-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            <Link to="/" className="flex items-center gap-3 group">
              <div className="bg-emerald-600 p-2 rounded-xl group-hover:rotate-12 transition-transform duration-300 shadow-lg shadow-emerald-600/20">
                <Rocket className="w-6 h-6 text-white" />
              </div>
              <span className="font-black text-2xl tracking-tighter uppercase italic text-slate-900">Agentex</span>
            </Link>
            <div className="hidden md:flex items-center gap-10">
              <a href="#features" className="text-xs font-bold uppercase tracking-widest text-slate-600 hover:text-emerald-600 transition-colors">Recursos</a>
              <a href="#ai-agent" className="text-xs font-bold uppercase tracking-widest text-slate-600 hover:text-emerald-600 transition-colors">Agente IA</a>
              <a href="#pricing" className="text-xs font-bold uppercase tracking-widest text-slate-600 hover:text-emerald-600 transition-colors">Planos</a>
            </div>
            <div className="hidden md:flex items-center gap-4">
              <Link to="/login">
                <Button variant="ghost" className="text-slate-600 hover:text-slate-900 font-bold uppercase tracking-widest text-xs">Entrar</Button>
              </Link>
              <Link to="/login">
                <Button className="bg-emerald-600 text-white hover:bg-emerald-700 font-black px-8 py-6 rounded-2xl shadow-xl shadow-emerald-600/20 transition-all hover:scale-105 active:scale-95">
                  COMEÇAR AGORA
                </Button>
              </Link>
            </div>
            {/* Mobile Menu Button */}
            <button className="md:hidden p-2 text-slate-900" onClick={() => setIsMenuOpen(!isMenuOpen)}>
              {isMenuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>
        {/* Mobile Menu */}
        {isMenuOpen && (
          <div className="md:hidden bg-white border-t border-slate-100 p-6 space-y-6 shadow-2xl animate-in slide-in-from-top duration-300">
            <a href="#features" className="block text-sm font-black uppercase tracking-widest text-slate-900 hover:text-emerald-600" onClick={() => setIsMenuOpen(false)}>Recursos</a>
            <a href="#ai-agent" className="block text-sm font-black uppercase tracking-widest text-slate-900 hover:text-emerald-600" onClick={() => setIsMenuOpen(false)}>Agente IA</a>
            <a href="#pricing" className="block text-sm font-black uppercase tracking-widest text-slate-900 hover:text-emerald-600" onClick={() => setIsMenuOpen(false)}>Planos</a>
            <Link to="/login" className="block text-sm font-black uppercase tracking-widest text-slate-900 hover:text-emerald-600" onClick={() => setIsMenuOpen(false)}>Entrar</Link>
            <Link to="/login" className="block mt-4" onClick={() => setIsMenuOpen(false)}>
              <Button className="w-full bg-emerald-600 text-white hover:bg-emerald-700 font-black py-6 rounded-2xl shadow-xl shadow-emerald-600/20">
                COMEÇAR AGORA
              </Button>
            </Link>
          </div>
        )}
      </nav>

      {/* Hero Section - Split Layout */}
      <main className="relative pt-32 pb-20 overflow-hidden bg-slate-50">
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-emerald-500/5 blur-[120px] rounded-full"></div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-2 gap-16 items-center">
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="space-y-8"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-black uppercase tracking-widest">
              <Sparkles className="w-4 h-4" />
              <span>O CRM #1 de Moçambique</span>
            </div>
            
            <h1 className="text-6xl sm:text-7xl lg:text-8xl font-black tracking-tighter leading-[0.9] uppercase italic text-slate-900">
              Venda no <br />
              <span className="text-emerald-600">Automático</span> <br />
              com IA.
            </h1>
            
            <p className="text-xl text-slate-600 max-w-xl leading-relaxed font-medium">
              Transforme seu WhatsApp em uma máquina de vendas. Automação completa, CRM profissional e Inteligência Artificial que atende seus clientes 24h por dia.
            </p>

            <div className="flex flex-col sm:flex-row items-center gap-6 pt-4">
              <Link to="/login" className="w-full sm:w-auto">
                <Button size="lg" className="bg-emerald-600 hover:bg-emerald-700 text-white h-20 px-12 text-xl font-black uppercase tracking-widest rounded-2xl w-full shadow-2xl shadow-emerald-600/30 transition-all hover:scale-105 active:scale-95">
                  TESTAR GRÁTIS AGORA
                </Button>
              </Link>
              <div className="flex items-center gap-4">
                <div className="flex -space-x-3">
                  {[1,2,3,4].map(i => (
                    <img key={i} src={`https://picsum.photos/seed/user${i}/100/100`} className="w-12 h-12 rounded-full border-4 border-white shadow-lg" alt="User" referrerPolicy="no-referrer" />
                  ))}
                </div>
                <div className="text-sm">
                  <p className="font-black text-slate-900">+1.200 Empresas</p>
                  <p className="text-slate-500 font-bold uppercase tracking-widest text-[10px]">Conectadas em Moçambique</p>
                </div>
              </div>
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 1, delay: 0.2 }}
            className="relative"
          >
            <div className="relative bg-white border border-slate-200 rounded-[2.5rem] p-4 shadow-[0_40px_100px_-20px_rgba(0,0,0,0.1)] overflow-hidden">
              <div className="flex items-center gap-2 mb-4 px-4 py-2 border-b border-slate-50">
                <div className="w-3 h-3 rounded-full bg-red-400"></div>
                <div className="w-3 h-3 rounded-full bg-amber-400"></div>
                <div className="w-3 h-3 rounded-full bg-emerald-400"></div>
                <div className="ml-auto text-[10px] uppercase tracking-widest text-slate-400 font-black">Agentex CRM v2.0</div>
              </div>
              <img 
                src="https://images.unsplash.com/photo-1460925895917-afdab827c52f?q=80&w=2426&auto=format&fit=crop" 
                alt="Dashboard Preview" 
                className="w-full h-auto rounded-2xl shadow-inner"
                referrerPolicy="no-referrer"
              />
              
              {/* Overlay elements */}
              <div className="absolute bottom-10 right-10 bg-white p-6 rounded-3xl shadow-2xl border border-slate-100 animate-float">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 bg-emerald-100 rounded-2xl flex items-center justify-center text-emerald-600">
                    <Zap size={24} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Vendas Hoje</p>
                    <p className="text-2xl font-black text-slate-900">42.500 MT</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </main>

      {/* Features - Clean Grid */}
      <section id="features" className="py-32 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-20 space-y-4">
            <h2 className="text-4xl sm:text-5xl font-black uppercase italic tracking-tighter text-slate-900">Tudo o que você precisa para <span className="text-emerald-600">escalar</span>.</h2>
            <p className="text-lg text-slate-600 font-medium">Ferramentas profissionais desenhadas para o mercado moçambicano.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-slate-50 p-10 rounded-[2.5rem] border border-slate-100 hover:border-emerald-200 transition-all group">
              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform mb-8">
                <Users className="w-8 h-8 text-emerald-600" />
              </div>
              <h3 className="text-2xl font-black uppercase italic tracking-tighter text-slate-900 mb-4">CRM de Vendas</h3>
              <p className="text-slate-600 leading-relaxed font-medium">Gestão completa de leads, funis de venda e histórico de conversas em um só lugar.</p>
            </div>
            
            <div className="bg-slate-50 p-10 rounded-[2.5rem] border border-slate-100 hover:border-blue-200 transition-all group">
              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform mb-8">
                <MessageSquare className="w-8 h-8 text-blue-600" />
              </div>
              <h3 className="text-2xl font-black uppercase italic tracking-tighter text-slate-900 mb-4">Disparos em Massa</h3>
              <p className="text-slate-600 leading-relaxed font-medium">Envie mensagens para milhares de contatos com segurança e relatórios em tempo real.</p>
            </div>

            <div className="bg-slate-50 p-10 rounded-[2.5rem] border border-slate-100 hover:border-purple-200 transition-all group">
              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform mb-8">
                <Bot className="w-8 h-8 text-purple-600" />
              </div>
              <h3 className="text-2xl font-black uppercase italic tracking-tighter text-slate-900 mb-4">Agente IA 24/7</h3>
              <p className="text-slate-600 leading-relaxed font-medium">Inteligência artificial que entende o contexto do seu negócio e atende como um humano.</p>
            </div>
          </div>
        </div>
      </section>

      {/* AI Agent - High Contrast Light */}
      <section id="ai-agent" className="py-32 bg-slate-50 overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-full opacity-5">
          <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-emerald-500 blur-[150px] rounded-full"></div>
        </div>
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-2 gap-24 items-center relative z-10">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-black uppercase tracking-widest">
              <Bot className="w-4 h-4" />
              <span>Inteligência Artificial Nativa</span>
            </div>
            <h2 className="text-5xl sm:text-7xl font-black uppercase italic tracking-tighter leading-[0.9] text-slate-900">
              Seu melhor <br />
              <span className="text-emerald-600">Vendedor</span> <br />
              não dorme.
            </h2>
            <p className="text-xl text-slate-600 leading-relaxed font-medium">
              Treine sua IA com o catálogo de produtos e regras de negócio. Ela entende o contexto moçambicano, fala português local e fecha vendas enquanto você descansa.
            </p>
            <div className="grid grid-cols-2 gap-8 pt-4">
              <div className="space-y-2">
                <p className="text-4xl font-black text-emerald-600">100%</p>
                <p className="text-xs uppercase font-black tracking-widest text-slate-400">Autônomo</p>
              </div>
              <div className="space-y-2">
                <p className="text-4xl font-black text-emerald-600">24/7</p>
                <p className="text-xs uppercase font-black tracking-widest text-slate-400">Disponível</p>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="bg-white border border-slate-200 rounded-[3rem] p-8 shadow-2xl">
              <div className="flex items-center gap-4 mb-8 border-b border-slate-100 pb-6">
                <div className="h-14 w-14 bg-emerald-600 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-600/20">
                  <Bot size={32} className="text-white" />
                </div>
                <div>
                  <p className="font-black text-xl italic uppercase tracking-tighter text-slate-900">Agente Agentex</p>
                  <p className="text-[10px] text-emerald-600 font-black uppercase tracking-widest flex items-center gap-2">
                    <span className="w-2 h-2 bg-emerald-600 rounded-full animate-pulse"></span>
                    Online agora
                  </p>
                </div>
              </div>
              <div className="space-y-6">
                <div className="bg-slate-50 rounded-3xl rounded-tl-none p-6 border border-slate-100">
                  <p className="text-sm leading-relaxed text-slate-600">Olá! Vi que você tem interesse no nosso plano Pro. Posso te ajudar a configurar sua conta agora?</p>
                </div>
                <div className="bg-emerald-600 text-white rounded-3xl rounded-tr-none p-6 font-black ml-auto max-w-[85%] shadow-xl">
                  <p className="text-sm">Sim, aceitam pagamento via M-Pesa?</p>
                </div>
                <div className="bg-slate-50 rounded-3xl rounded-tl-none p-6 border border-slate-100">
                  <p className="text-sm leading-relaxed text-slate-600">Com certeza! Aceitamos M-Pesa, e-Mola e transferência bancária. Vou te enviar os dados agora mesmo.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing - Professional Cards */}
      <section id="pricing" className="py-32 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-24 space-y-4">
            <h2 className="text-6xl sm:text-8xl font-black uppercase italic tracking-tighter text-slate-900">Preços.</h2>
            <p className="text-xl font-bold text-slate-500 uppercase tracking-widest">Escolha o plano ideal para o seu crescimento.</p>
          </div>

          <div className="grid lg:grid-cols-3 gap-8 items-center">
            {plans.map((plan) => {
              const isPopular = plan.name === "Pro";
              return (
                <div key={plan.id} className={cn(
                  "p-12 bg-white border-2 flex flex-col relative transition-all duration-500 rounded-[3rem]",
                  isPopular ? "border-emerald-500 shadow-[0_40px_80px_-20px_rgba(16,185,129,0.2)] lg:scale-110 z-10" : "border-slate-100 shadow-xl"
                )}>
                  {isPopular && (
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-emerald-500 text-white px-8 py-2 font-black uppercase text-xs tracking-widest rounded-full shadow-lg">
                      RECOMENDADO
                    </div>
                  )}
                  <h3 className="text-3xl font-black uppercase italic mb-6 tracking-tighter text-slate-900">{plan.name}</h3>
                  <div className="mb-10">
                    <span className="text-6xl font-black tracking-tighter text-slate-900">{plan.price}</span>
                    <span className="text-xl font-black uppercase text-slate-400"> MT/mês</span>
                  </div>
                  <ul className="space-y-6 mb-12 flex-1">
                    <li className="flex items-center gap-4 font-bold text-slate-600">
                      <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                      <span>{plan.max_connections} Conexão WhatsApp</span>
                    </li>
                    <li className="flex items-center gap-4 font-bold text-slate-600">
                      <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                      <span>{plan.max_contacts === 999999 ? "Contatos Ilimitados" : `${plan.max_contacts} Contatos`}</span>
                    </li>
                    <li className="flex items-center gap-4 font-bold text-slate-600">
                      <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                      <span>{plan.ai_enabled ? "Agente IA Ativo" : "Sem IA"}</span>
                    </li>
                  </ul>
                  <Link to="/login">
                    <Button className={cn(
                      "w-full h-20 text-xl font-black uppercase tracking-widest rounded-[1.5rem] transition-all",
                      isPopular ? "bg-emerald-600 text-white hover:bg-emerald-700 shadow-2xl shadow-emerald-600/30" : "bg-slate-900 text-white hover:bg-slate-800"
                    )}>
                      ASSINAR AGORA
                    </Button>
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Footer - Clean */}
      <footer className="bg-white py-24 border-t border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid md:grid-cols-2 gap-16 items-center">
          <div className="space-y-8">
            <Link to="/" className="flex items-center gap-4">
              <div className="bg-emerald-600 p-3 rounded-2xl shadow-xl shadow-emerald-600/20">
                <Rocket className="w-8 h-8 text-white" />
              </div>
              <span className="font-black text-4xl tracking-tighter uppercase italic text-slate-900">Agentex</span>
            </Link>
            <p className="text-slate-500 max-w-sm text-lg font-medium leading-relaxed">
              A plataforma líder em automação e CRM para WhatsApp em Moçambique.
            </p>
          </div>
          <div className="flex flex-col md:items-end gap-8">
            <div className="flex gap-12">
              <a href="#" className="text-xs font-black uppercase tracking-widest text-slate-400 hover:text-slate-900 transition-colors">Termos</a>
              <a href="#" className="text-xs font-black uppercase tracking-widest text-slate-400 hover:text-slate-900 transition-colors">Privacidade</a>
              <a href="#" className="text-xs font-black uppercase tracking-widest text-slate-400 hover:text-slate-900 transition-colors">Suporte</a>
            </div>
            <div className="text-right">
              <p className="text-slate-300 text-[10px] font-black uppercase tracking-[0.5em] mb-2">
                MADE IN MOZAMBIQUE
              </p>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">
                © {new Date().getFullYear()} Agentex. Todos os direitos reservados.
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
