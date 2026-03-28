import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Bot, Zap, Users, MessageSquare, Calendar, ShieldCheck, CheckCircle2, ArrowRight, MessageCircle } from "lucide-react";
import { Button } from "../components/ui/Button";
import { cn } from "../lib/utils";
import { apiFetch } from "../lib/api";

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
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* Navbar */}
      <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-md z-50 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <div className="bg-emerald-600 p-2 rounded-lg">
                <MessageCircle className="w-6 h-6 text-white" />
              </div>
              <span className="font-bold text-xl tracking-tight text-slate-900">WhatsCRM</span>
            </Link>
            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-sm font-medium text-slate-600 hover:text-emerald-600 transition-colors">Recursos</a>
              <a href="#ai-agent" className="text-sm font-medium text-slate-600 hover:text-emerald-600 transition-colors">Agente IA</a>
              <a href="#pricing" className="text-sm font-medium text-slate-600 hover:text-emerald-600 transition-colors">Planos</a>
            </div>
            <div className="flex items-center gap-4">
              <Link to="/login">
                <Button variant="outline" className="hidden sm:flex">Entrar</Button>
              </Link>
              <Link to="/login">
                <Button className="bg-emerald-600 hover:bg-emerald-700 text-white">Começar Agora</Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-sm font-medium mb-8">
          <Zap className="w-4 h-4" />
          <span>A revolução do atendimento no WhatsApp</span>
        </div>
        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-slate-900 mb-6 leading-tight">
          Venda no automático com <br className="hidden md:block" />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-teal-500">
            Inteligência Artificial
          </span>
        </h1>
        <p className="text-lg md:text-xl text-slate-600 max-w-3xl mx-auto mb-10 leading-relaxed">
          O CRM completo para WhatsApp. Organize contatos, crie comunicação inteligente, agende mensagens e tenha um robô inteligente atendendo seus clientes 24h por dia.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link to="/login">
            <Button size="lg" className="bg-emerald-600 hover:bg-emerald-700 text-white h-14 px-8 text-lg rounded-full shadow-lg shadow-emerald-600/20 w-full sm:w-auto">
              Testar Gratuitamente <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </Link>
          <a href="#features">
            <Button size="lg" variant="outline" className="h-14 px-8 text-lg rounded-full w-full sm:w-auto">
              Ver Recursos
            </Button>
          </a>
        </div>
        
        {/* Hero Image / Dashboard Mockup */}
        <div className="mt-16 relative mx-auto max-w-5xl">
          <div className="absolute inset-0 bg-gradient-to-t from-slate-50 via-transparent to-transparent z-10"></div>
          <div className="rounded-2xl border border-slate-200/60 bg-white shadow-2xl overflow-hidden">
            <div className="h-8 bg-slate-100 border-b border-slate-200 flex items-center px-4 gap-2">
              <div className="w-3 h-3 rounded-full bg-red-400"></div>
              <div className="w-3 h-3 rounded-full bg-amber-400"></div>
              <div className="w-3 h-3 rounded-full bg-emerald-400"></div>
            </div>
            <img 
              src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=2070&auto=format&fit=crop" 
              alt="Dashboard Preview" 
              className="w-full h-auto object-cover opacity-90"
              referrerPolicy="no-referrer"
            />
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">Tudo o que você precisa em um só lugar</h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">Esqueça dezenas de ferramentas. O WhatsCRM unifica seu atendimento, vendas e marketing no aplicativo mais usado do Brasil.</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="p-8 rounded-2xl bg-slate-50 border border-slate-100 hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center mb-6">
                <Users className="w-6 h-6 text-blue-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Mini CRM & Tags</h3>
              <p className="text-slate-600 leading-relaxed">Organize seus clientes com etiquetas personalizadas. Saiba exatamente quem é VIP, quem está devendo e quem é lead quente.</p>
            </div>

            {/* Feature 2 */}
            <div className="p-8 rounded-2xl bg-slate-50 border border-slate-100 hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center mb-6">
                <MessageSquare className="w-6 h-6 text-emerald-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Comunicação Inteligente</h3>
              <p className="text-slate-600 leading-relaxed">Envie promoções, avisos e novidades para centenas de contatos de forma programada, segmentando por tags específicas.</p>
            </div>

            {/* Feature 3 */}
            <div className="p-8 rounded-2xl bg-slate-50 border border-slate-100 hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center mb-6">
                <Calendar className="w-6 h-6 text-amber-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Agendamento</h3>
              <p className="text-slate-600 leading-relaxed">Programe mensagens para datas e horários futuros. Perfeito para lembretes de consultas, cobranças ou aniversários.</p>
            </div>

            {/* Feature 4 */}
            <div className="p-8 rounded-2xl bg-slate-50 border border-slate-100 hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center mb-6">
                <Zap className="w-6 h-6 text-purple-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Automações Rápidas</h3>
              <p className="text-slate-600 leading-relaxed">Crie respostas automáticas baseadas em palavras-chave. Se o cliente digitar "Preço", o robô responde com a tabela na hora.</p>
            </div>

            {/* Feature 5 */}
            <div className="p-8 rounded-2xl bg-slate-50 border border-slate-100 hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center mb-6">
                <Bot className="w-6 h-6 text-indigo-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Agente IA Avançado</h3>
              <p className="text-slate-600 leading-relaxed">Conecte o ChatGPT ou Google Gemini. Treine sua IA para vender, tirar dúvidas e atender como um humano 24/7.</p>
            </div>

            {/* Feature 6 */}
            <div className="p-8 rounded-2xl bg-slate-50 border border-slate-100 hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 rounded-xl bg-rose-100 flex items-center justify-center mb-6">
                <ShieldCheck className="w-6 h-6 text-rose-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Segurança Total</h3>
              <p className="text-slate-600 leading-relaxed">Seus dados e mensagens são criptografados. Conexão via QR Code ou código de pareamento, sem precisar de celular ligado.</p>
            </div>
          </div>
        </div>
      </section>

      {/* AI Agent Highlight */}
      <section id="ai-agent" className="py-24 bg-slate-900 text-white overflow-hidden relative">
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 rounded-full bg-emerald-500/20 blur-3xl"></div>
        <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-96 h-96 rounded-full bg-blue-500/20 blur-3xl"></div>
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-emerald-300 text-sm font-medium mb-6">
                <Bot className="w-4 h-4" />
                <span>O Futuro do Atendimento</span>
              </div>
              <h2 className="text-3xl md:text-5xl font-bold mb-6 leading-tight">
                Seu melhor vendedor não dorme, não tira férias e atende 1000 pessoas ao mesmo tempo.
              </h2>
              <p className="text-lg text-slate-300 mb-8 leading-relaxed">
                Com o Agente IA do WhatsCRM, você treina uma Inteligência Artificial com as regras do seu negócio. Ela entende o contexto, negocia e fecha vendas de forma autônoma.
              </p>
              <ul className="space-y-4 mb-10">
                <li className="flex items-center gap-3 text-slate-200">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400 flex-shrink-0" />
                  <span>Integração nativa com OpenAI (ChatGPT) e Google Gemini</span>
                </li>
                <li className="flex items-center gap-3 text-slate-200">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400 flex-shrink-0" />
                  <span>Personalidade customizável (Tom de voz, regras, objeções)</span>
                </li>
                <li className="flex items-center gap-3 text-slate-200">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400 flex-shrink-0" />
                  <span>Transbordo humano (Pausa a IA quando necessário)</span>
                </li>
              </ul>
            </div>
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-emerald-500 to-teal-400 rounded-2xl transform rotate-3 opacity-20 blur-lg"></div>
              <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 relative shadow-2xl">
                <div className="flex items-center gap-4 border-b border-slate-700 pb-4 mb-4">
                  <div className="w-12 h-12 rounded-full bg-emerald-600 flex items-center justify-center">
                    <Bot className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h4 className="font-bold text-white">Assistente Virtual</h4>
                    <p className="text-xs text-emerald-400">Online agora</p>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="bg-slate-700 rounded-2xl rounded-tl-none p-4 max-w-[80%]">
                    <p className="text-sm text-slate-200">Olá! Vi que você se interessou pelo nosso plano Pro. Como posso te ajudar hoje?</p>
                  </div>
                  <div className="bg-emerald-600 rounded-2xl rounded-tr-none p-4 max-w-[80%] ml-auto">
                    <p className="text-sm text-white">Queria saber se a IA consegue responder dúvidas técnicas dos meus clientes.</p>
                  </div>
                  <div className="bg-slate-700 rounded-2xl rounded-tl-none p-4 max-w-[80%]">
                    <p className="text-sm text-slate-200">Com certeza! Você pode treinar a IA com seus PDFs, manuais e FAQs. Ela vai ler tudo e responder com precisão cirúrgica, como um especialista do seu time. Quer ver um exemplo?</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">Planos simples e transparentes</h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">Escolha o plano ideal para o momento do seu negócio. Sem fidelidade. Cancele quando quiser.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {plans.map((plan, index) => {
              const isPopular = plan.name === "Pro";
              return (
                <div key={plan.id} className={cn(
                  "rounded-3xl p-8 border shadow-sm hover:shadow-xl transition-shadow flex flex-col relative",
                  isPopular ? "bg-emerald-600 border-emerald-500 shadow-2xl transform md:-translate-y-4 text-white" : "bg-white border-slate-200"
                )}>
                  {isPopular && (
                    <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-amber-400 to-orange-500 text-white px-4 py-1 rounded-full text-xs font-bold uppercase tracking-wider whitespace-nowrap">
                      Mais Popular ⭐
                    </div>
                  )}
                  <h3 className={cn("text-xl font-bold mb-2", isPopular ? "text-white" : "text-slate-900")}>{plan.name}</h3>
                  <p className={cn("text-sm mb-6", isPopular ? "text-emerald-100" : "text-slate-500")}>
                    {plan.name === "Starter" ? "Para começar com organização e automação básica" : 
                     plan.name === "Pro" ? "Para atendimento profissional e crescimento" : 
                     "Para empresas e operação completa"}
                  </p>
                  <div className="mb-6">
                    <span className={cn("text-4xl font-extrabold", isPopular ? "text-white" : "text-slate-900")}>{plan.price} MZN</span>
                    <span className={cn(isPopular ? "text-emerald-200" : "text-slate-500")}> / mês</span>
                  </div>
                  <ul className="space-y-4 mb-8 flex-1">
                    <li className="flex items-center gap-3 text-sm">
                      <CheckCircle2 className={cn("w-5 h-5 flex-shrink-0", isPopular ? "text-emerald-300" : "text-emerald-500")} />
                      <span>{plan.max_connections} conexão WhatsApp</span>
                    </li>
                    <li className="flex items-center gap-3 text-sm">
                      <CheckCircle2 className={cn("w-5 h-5 flex-shrink-0", isPopular ? "text-emerald-300" : "text-emerald-500")} />
                      <span>{plan.max_contacts === 999999 ? "Contatos ilimitados" : `Até ${plan.max_contacts} contatos`}</span>
                    </li>
                    <li className="flex items-center gap-3 text-sm">
                      <CheckCircle2 className={cn("w-5 h-5 flex-shrink-0", isPopular ? "text-emerald-300" : "text-emerald-500")} />
                      <span>Até {plan.max_messages_per_day} mensagens por dia</span>
                    </li>
                    <li className="flex items-center gap-3 text-sm">
                      <CheckCircle2 className={cn("w-5 h-5 flex-shrink-0", isPopular ? "text-emerald-300" : "text-emerald-500")} />
                      <span>{plan.ai_enabled ? <span className="font-bold">IA integrada</span> : <span className="text-slate-500">Sem IA inteligente</span>}</span>
                    </li>
                  </ul>
                  <Link to="/login" className="w-full">
                    <Button className={cn("w-full rounded-full h-12", isPopular ? "bg-white text-emerald-700 hover:bg-slate-50" : "bg-slate-900 text-white hover:bg-slate-800")}>Começar Agora</Button>
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 py-12 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="bg-emerald-600 p-1.5 rounded-lg">
              <MessageCircle className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg text-white">WhatsCRM</span>
          </div>
          <p className="text-slate-400 text-sm">
            © {new Date().getFullYear()} WhatsCRM. Todos os direitos reservados.
          </p>
          <div className="flex gap-4">
            <a href="#" className="text-slate-400 hover:text-white transition-colors text-sm">Termos de Uso</a>
            <a href="#" className="text-slate-400 hover:text-white transition-colors text-sm">Privacidade</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
