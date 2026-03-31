import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Bot, Zap, Users, MessageSquare, Calendar, ShieldCheck, CheckCircle2, ArrowRight, MessageCircle, Globe, Sparkles, Rocket } from "lucide-react";
import { Button } from "../components/ui/Button";
import { cn } from "../lib/utils";
import { apiFetch } from "../lib/api";
import { motion } from "motion/react";

export default function Landing() {
  const [plans, setPlans] = useState<any[]>([]);

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
    <div className="min-h-screen bg-black font-sans text-white selection:bg-emerald-500 selection:text-black">
      {/* Navbar */}
      <nav className="fixed top-0 w-full bg-black/50 backdrop-blur-xl z-50 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            <Link to="/" className="flex items-center gap-3 group">
              <div className="bg-emerald-500 p-2 rounded-xl group-hover:rotate-12 transition-transform duration-300">
                <Rocket className="w-6 h-6 text-black" />
              </div>
              <span className="font-black text-2xl tracking-tighter uppercase italic">Agentex</span>
            </Link>
            <div className="hidden md:flex items-center gap-10">
              <a href="#features" className="text-xs font-bold uppercase tracking-widest text-white/60 hover:text-emerald-400 transition-colors">Recursos</a>
              <a href="#ai-agent" className="text-xs font-bold uppercase tracking-widest text-white/60 hover:text-emerald-400 transition-colors">Agente IA</a>
              <a href="#pricing" className="text-xs font-bold uppercase tracking-widest text-white/60 hover:text-emerald-400 transition-colors">Planos</a>
            </div>
            <div className="flex items-center gap-4">
              <Link to="/login">
                <Button variant="ghost" className="hidden sm:flex text-white/80 hover:text-white">Entrar</Button>
              </Link>
              <Link to="/login">
                <Button className="bg-white text-black hover:bg-emerald-400 font-bold px-6 rounded-none skew-x-[-12deg]">
                  <span className="skew-x-[12deg]">COMEÇAR AGORA</span>
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section - Split Layout */}
      <main className="relative pt-20 overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10">
          <div className="absolute top-1/4 -left-20 w-96 h-96 bg-emerald-500/20 blur-[120px] rounded-full"></div>
          <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-blue-500/20 blur-[120px] rounded-full"></div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 min-h-[90vh] grid lg:grid-cols-2 gap-12 items-center">
          <motion.div 
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="space-y-8"
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold uppercase tracking-[0.2em]">
              <Sparkles className="w-4 h-4" />
              <span>A Revolução em Moçambique</span>
            </div>
            
            <h1 className="text-6xl md:text-8xl font-black tracking-tighter leading-[0.85] uppercase italic">
              Venda no <br />
              <span className="text-emerald-500">Automático</span> <br />
              com IA.
            </h1>
            
            <p className="text-xl text-white/60 max-w-xl leading-relaxed font-medium">
              O CRM mais potente de Moçambique. Domine o WhatsApp com automações inteligentes, gestão de leads e um Agente de IA que atende como um humano.
            </p>

            <div className="flex flex-col sm:flex-row items-center gap-6 pt-4">
              <Link to="/login" className="w-full sm:w-auto">
                <Button size="lg" className="bg-emerald-500 hover:bg-emerald-400 text-black h-16 px-10 text-lg font-black uppercase tracking-wider rounded-none skew-x-[-12deg] w-full">
                  <span className="skew-x-[12deg] flex items-center gap-2">
                    TESTAR GRÁTIS <ArrowRight className="w-5 h-5" />
                  </span>
                </Button>
              </Link>
              <div className="flex items-center gap-4">
                <div className="flex -space-x-3">
                  {[1,2,3,4].map(i => (
                    <img key={i} src={`https://picsum.photos/seed/user${i}/100/100`} className="w-10 h-10 rounded-full border-2 border-black" alt="User" referrerPolicy="no-referrer" />
                  ))}
                </div>
                <div className="text-sm">
                  <p className="font-bold">+500 Empresas</p>
                  <p className="text-white/40 text-xs">Conectadas em Maputo e Beira</p>
                </div>
              </div>
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, scale: 0.8, rotate: 5 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ duration: 1, delay: 0.2, ease: "easeOut" }}
            className="relative"
          >
            <div className="absolute inset-0 bg-emerald-500/20 blur-3xl rounded-full"></div>
            <div className="relative bg-white/5 backdrop-blur-sm border border-white/10 rounded-3xl p-4 shadow-2xl overflow-hidden">
              <div className="flex items-center gap-2 mb-4 px-2">
                <div className="w-3 h-3 rounded-full bg-red-500/50"></div>
                <div className="w-3 h-3 rounded-full bg-amber-500/50"></div>
                <div className="w-3 h-3 rounded-full bg-emerald-500/50"></div>
                <div className="ml-auto text-[10px] uppercase tracking-widest text-white/40 font-bold">Agentex Dashboard</div>
              </div>
              <img 
                src="https://images.unsplash.com/photo-1460925895917-afdab827c52f?q=80&w=2426&auto=format&fit=crop" 
                alt="Dashboard Preview" 
                className="w-full h-auto rounded-xl grayscale hover:grayscale-0 transition-all duration-700"
                referrerPolicy="no-referrer"
              />
            </div>
            
            {/* Floating elements */}
            <motion.div 
              animate={{ y: [0, -20, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="absolute -top-10 -right-10 bg-emerald-500 text-black p-6 rounded-2xl font-black italic text-2xl shadow-2xl hidden md:block"
            >
              +300% <br /> <span className="text-xs uppercase tracking-widest not-italic font-bold">Vendas</span>
            </motion.div>
          </motion.div>
        </div>
      </main>

      {/* Features - Visible Grid */}
      <section id="features" className="py-32 border-y border-white/10 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-3 gap-px bg-white/10 border border-white/10 rounded-3xl overflow-hidden">
            <div className="bg-black p-12 space-y-6 hover:bg-white/5 transition-colors">
              <div className="w-14 h-14 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-center">
                <Users className="w-7 h-7 text-emerald-400" />
              </div>
              <h3 className="text-2xl font-black uppercase italic tracking-tighter">CRM Inteligente</h3>
              <p className="text-white/60 leading-relaxed">Organize seus clientes de Maputo a Pemba com etiquetas e funis de venda automáticos.</p>
            </div>
            <div className="bg-black p-12 space-y-6 hover:bg-white/5 transition-colors">
              <div className="w-14 h-14 bg-blue-500/10 border border-blue-500/20 rounded-2xl flex items-center justify-center">
                <MessageSquare className="w-7 h-7 text-blue-400" />
              </div>
              <h3 className="text-2xl font-black uppercase italic tracking-tighter">Disparos em Massa</h3>
              <p className="text-white/60 leading-relaxed">Comunique-se com toda sua base de clientes em segundos, sem risco de bloqueio.</p>
            </div>
            <div className="bg-black p-12 space-y-6 hover:bg-white/5 transition-colors">
              <div className="w-14 h-14 bg-purple-500/10 border border-purple-500/20 rounded-2xl flex items-center justify-center">
                <Bot className="w-7 h-7 text-purple-400" />
              </div>
              <h3 className="text-2xl font-black uppercase italic tracking-tighter">Agente IA 24/7</h3>
              <p className="text-white/60 leading-relaxed">Uma inteligência artificial treinada para o seu negócio, atendendo em Português e Gírias locais.</p>
            </div>
          </div>
        </div>
      </section>

      {/* AI Agent - Immersive */}
      <section id="ai-agent" className="py-32 relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-2 gap-24 items-center">
          <div className="order-2 lg:order-1">
            <div className="relative group">
              <div className="absolute inset-0 bg-emerald-500/20 blur-3xl rounded-full group-hover:bg-emerald-500/30 transition-all"></div>
              <div className="relative bg-zinc-900 border border-white/10 rounded-[2rem] p-8 shadow-2xl">
                <div className="flex items-center gap-4 border-b border-white/5 pb-6 mb-6">
                  <div className="w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                    <Bot className="w-8 h-8 text-black" />
                  </div>
                  <div>
                    <h4 className="font-black uppercase italic text-xl">Agente Agentex</h4>
                    <p className="text-xs text-emerald-400 font-bold uppercase tracking-widest flex items-center gap-2">
                      <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                      Ativo em Moçambique
                    </p>
                  </div>
                </div>
                <div className="space-y-6">
                  <div className="bg-white/5 rounded-2xl rounded-tl-none p-5 border border-white/5">
                    <p className="text-sm leading-relaxed">Olá! Sou o assistente da sua empresa. Como posso ajudar com seu pedido hoje?</p>
                  </div>
                  <div className="bg-emerald-500 text-black rounded-2xl rounded-tr-none p-5 font-bold ml-auto max-w-[85%]">
                    <p className="text-sm">Quero saber o preço da entrega para a Matola.</p>
                  </div>
                  <div className="bg-white/5 rounded-2xl rounded-tl-none p-5 border border-white/5">
                    <p className="text-sm leading-relaxed">Para a Matola a entrega é grátis em pedidos acima de 2000 MZN! Posso fechar seu carrinho agora?</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="order-1 lg:order-2 space-y-8">
            <h2 className="text-5xl md:text-7xl font-black uppercase italic tracking-tighter leading-[0.9]">
              Seu melhor <br />
              <span className="text-emerald-500">Vendedor</span> <br />
              não dorme.
            </h2>
            <p className="text-xl text-white/60 leading-relaxed">
              Treine sua IA com o catálogo de produtos e regras de negócio. Ela entende o contexto moçambicano e fecha vendas enquanto você descansa.
            </p>
            <div className="grid grid-cols-2 gap-6">
              <div className="p-6 bg-white/5 rounded-2xl border border-white/10">
                <h5 className="font-black text-emerald-400 text-2xl mb-1">100%</h5>
                <p className="text-xs uppercase font-bold tracking-widest text-white/40">Autônomo</p>
              </div>
              <div className="p-6 bg-white/5 rounded-2xl border border-white/10">
                <h5 className="font-black text-emerald-400 text-2xl mb-1">MZN</h5>
                <p className="text-xs uppercase font-bold tracking-widest text-white/40">Moeda Local</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing - Bold Cards */}
      <section id="pricing" className="py-32 bg-white text-black">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-24 space-y-4">
            <h2 className="text-6xl md:text-8xl font-black uppercase italic tracking-tighter leading-none">Preços.</h2>
            <p className="text-xl font-medium text-black/60">Sem taxas escondidas. Cancele quando quiser.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {plans.map((plan) => {
              const isPopular = plan.name === "Pro";
              return (
                <div key={plan.id} className={cn(
                  "p-10 border-4 flex flex-col relative transition-all duration-300",
                  isPopular ? "bg-black text-white border-black scale-105 z-10" : "bg-white border-black"
                )}>
                  {isPopular && (
                    <div className="absolute top-0 right-0 bg-emerald-500 text-black px-4 py-1 font-black uppercase text-xs skew-x-[-12deg] -translate-y-1/2 translate-x-4">
                      MAIS POPULAR
                    </div>
                  )}
                  <h3 className="text-3xl font-black uppercase italic mb-2 tracking-tighter">{plan.name}</h3>
                  <div className="mb-8">
                    <span className="text-5xl font-black tracking-tighter">{plan.price}</span>
                    <span className="text-xl font-bold uppercase opacity-60"> MZN/mês</span>
                  </div>
                  <ul className="space-y-4 mb-12 flex-1">
                    <li className="flex items-center gap-3 font-bold text-sm uppercase tracking-tight">
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      <span>{plan.max_connections} Conexão WhatsApp</span>
                    </li>
                    <li className="flex items-center gap-3 font-bold text-sm uppercase tracking-tight">
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      <span>{plan.max_contacts === 999999 ? "Contatos Ilimitados" : `${plan.max_contacts} Contatos`}</span>
                    </li>
                    <li className="flex items-center gap-3 font-bold text-sm uppercase tracking-tight">
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      <span>{plan.ai_enabled ? "IA Inteligente Ativa" : "Sem IA"}</span>
                    </li>
                  </ul>
                  <Link to="/login">
                    <Button className={cn(
                      "w-full h-16 text-lg font-black uppercase tracking-widest rounded-none skew-x-[-12deg]",
                      isPopular ? "bg-emerald-500 text-black hover:bg-emerald-400" : "bg-black text-white hover:bg-zinc-800"
                    )}>
                      <span className="skew-x-[12deg]">ASSINAR AGORA</span>
                    </Button>
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-black py-20 border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid md:grid-cols-2 gap-12 items-center">
          <div className="space-y-6">
            <Link to="/" className="flex items-center gap-3">
              <div className="bg-emerald-500 p-2 rounded-xl">
                <Rocket className="w-6 h-6 text-black" />
              </div>
              <span className="font-black text-3xl tracking-tighter uppercase italic">Agentex</span>
            </Link>
            <p className="text-white/40 max-w-sm font-medium">
              A maior plataforma de automação de WhatsApp de Moçambique. Feito para empresas que querem escalar.
            </p>
          </div>
          <div className="flex flex-col md:items-end gap-6">
            <div className="flex gap-8">
              <a href="#" className="text-xs font-bold uppercase tracking-widest text-white/40 hover:text-white transition-colors">Termos</a>
              <a href="#" className="text-xs font-bold uppercase tracking-widest text-white/40 hover:text-white transition-colors">Privacidade</a>
              <a href="#" className="text-xs font-bold uppercase tracking-widest text-white/40 hover:text-white transition-colors">Suporte</a>
            </div>
            <p className="text-white/20 text-xs font-bold uppercase tracking-[0.3em]">
              © {new Date().getFullYear()} Agentex. Maputo, MZ.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
