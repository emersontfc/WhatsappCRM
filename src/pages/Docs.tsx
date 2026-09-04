import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen,
  Search,
  MessageCircle,
  Mic,
  CalendarCheck,
  Zap,
  Bot,
  UserPlus,
  Users2,
  Clock,
  Settings,
  ShieldCheck,
  ChevronRight,
  ExternalLink,
  Copy,
  Check,
  Sparkles,
  ArrowRight,
  HelpCircle,
  Menu,
  X,
  Play
} from "lucide-react";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { toast } from "sonner";

interface DocSection {
  id: string;
  title: string;
  category: string;
  icon: any;
  summary: string;
  content: React.ReactNode;
}

export default function Docs() {
  const [activeSection, setActiveSection] = useState<string>("quick-start");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    toast.success("Copiado para a área de transferência!");
    setTimeout(() => setCopiedText(null), 2500);
  };

  const sections: DocSection[] = [
    {
      id: "quick-start",
      title: "Primeiros Passos & Conexão",
      category: "Introdução",
      icon: Zap,
      summary: "Como criar sua conta e conectar seu número de WhatsApp via QR Code com reconexão automática.",
      content: (
        <div className="space-y-6">
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
            O <strong>WhatsCRM</strong> transforma seu WhatsApp comum ou WhatsApp Business em uma central de vendas, agendamento de consultas e atendimento com inteligência artificial.
          </p>

          <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-2xl p-5 space-y-3">
            <h4 className="text-sm font-bold text-emerald-900 flex items-center gap-2">
              <Sparkles size={16} className="text-emerald-600" /> Passo a Passo para Conectar seu WhatsApp:
            </h4>
            <ol className="list-decimal list-inside space-y-2 text-xs sm:text-sm text-emerald-950">
              <li>Acesse o menu <strong>Configurações</strong> (<Link to="/settings" className="underline font-bold">/settings</Link>) no painel lateral.</li>
              <li>Na seção <strong>Conexão WhatsApp</strong>, clique em <strong>"Gerar QR Code"</strong>.</li>
              <li>Abra o WhatsApp no seu celular ➔ toque nos <strong>3 pontinhos ou Ajustes</strong> ➔ <strong>Aparelhos conectados</strong> ➔ <strong>Conectar um aparelho</strong>.</li>
              <li>Aponte a câmera para o QR Code na tela. Em instantes a tela atualizará para <Badge variant="success">Conectado ✅</Badge>.</li>
            </ol>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-bold text-slate-900">Reconexão Automática em Background</h4>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              O sistema utiliza a tecnologia <strong>Baileys Multi-Device</strong> com persistência de sessão. Se o servidor for reiniciado ou o celular passar por oscilações de sinal, o WhatsCRM restabelece a conexão sozinho sem necessidade de ler o QR Code novamente.
            </p>
          </div>
        </div>
      )
    },
    {
      id: "messages-inbox",
      title: "Inbox Comercial & Chat 1-a-1",
      category: "Atendimento",
      icon: MessageCircle,
      summary: "Atendimento em tempo real, painel CRM lateral, controle de modo humano e respostas rápidas.",
      content: (
        <div className="space-y-6">
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
            A tela de <strong>Mensagens</strong> (<Link to="/messages" className="underline font-bold text-emerald-600">/messages</Link>) centraliza todas as suas conversas individuais em uma interface fluida com CRM integrado.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
              <h4 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                🛑 Assumir Atendimento Humano
              </h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                No topo da conversa, clique no botão para alternar entre <strong>IA Ativa</strong> e <strong>Atendimento Humano</strong>. Ao assumir o controle humano, o robô não responderá automaticamente nessa conversa.
              </p>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
              <h4 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                🏷️ Painel CRM Lateral
              </h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                Clique no ícone de gráfico no topo direito do chat para abrir o painel lateral: edite o nome do contato, adicione etiquetas (tags), altere o estágio comercial e salve anotações confidenciais.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-bold text-slate-900">Respostas Rápidas (/atalho)</h4>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Clique no ícone de lista na barra de envio para escolher respostas prontas ou acesse <Link to="/quick-replies" className="underline font-bold text-emerald-600">Respostas Rápidas</Link> para cadastrar mensagens frequentes com atalhos como <code>/pix</code>, <code>/horarios</code> ou <code>/endereco</code>.
            </p>
          </div>
        </div>
      )
    },
    {
      id: "voice-audio",
      title: "Gravação & Envio de Áudios de Voz",
      category: "Atendimento",
      icon: Mic,
      summary: "Como gravar áudios com pré-escuta (Play/Pause) e envio nativo em formato de nota de voz WhatsApp PTT.",
      content: (
        <div className="space-y-6">
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
            O WhatsCRM conta com um conversor de áudio integrado com <strong>FFmpeg</strong>, transformando gravações de qualquer navegador para o formato nativo do WhatsApp: <strong>OGG Opus 16kHz mono (PTT)</strong>.
          </p>

          <div className="bg-slate-900 text-white p-5 rounded-2xl space-y-3">
            <h4 className="text-sm font-bold flex items-center gap-2 text-emerald-400">
              <Play size={16} /> Fluxo de Gravação com Pré-Escuta:
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="bg-white/10 p-3 rounded-xl">
                <span className="font-bold text-emerald-300 block mb-1">1. Gravar</span>
                Clique no ícone de Microfone e fale enquanto o tempo é exibido.
              </div>
              <div className="bg-white/10 p-3 rounded-xl">
                <span className="font-bold text-emerald-300 block mb-1">2. Ouvir</span>
                Clique no botão Play (▶️) para escutar sua gravação antes de disparar.
              </div>
              <div className="bg-white/10 p-3 rounded-xl">
                <span className="font-bold text-emerald-300 block mb-1">3. Enviar</span>
                Envie diretamente com 1 clique ou descarte e regrave se desejar.
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: "appointments-system",
      title: "Agenda, Consultas & Auto-Agendamento",
      category: "Saúde & Serviços",
      icon: CalendarCheck,
      summary: "Gestão completa de consultas, catálogo de serviços, equipe médica, página pública e lembretes automáticos anti-falta.",
      content: (
        <div className="space-y-6">
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
            Desenvolvido especialmente para <strong>clínicas, consultórios médicos, dentistas, salões de beleza, escritórios e consultorias</strong>.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-2xl space-y-2">
              <h4 className="font-bold text-sm text-emerald-950 flex items-center gap-1.5">
                📅 1. Painel da Agenda (/appointments)
              </h4>
              <p className="text-xs text-slate-600">
                Visualize consultas por dia/mês, filtre por médico ou status, e chame o paciente no WhatsApp com 1 clique direto na linha do agendamento.
              </p>
            </div>

            <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-2xl space-y-2">
              <h4 className="font-bold text-sm text-emerald-950 flex items-center gap-1.5">
                🌐 2. Auto-Agendamento Público (/book/:id)
              </h4>
              <p className="text-xs text-slate-600">
                Compartilhe seu link exclusivo ou QR Code. O paciente escolhe o serviço, o médico e o horário vago em tempo real, recebendo confirmação na hora.
              </p>
            </div>
          </div>

          <div className="p-5 bg-amber-50/70 border border-amber-200 rounded-2xl space-y-2">
            <h4 className="font-bold text-sm text-amber-950 flex items-center gap-2">
              ⏰ Lembretes Automáticos Anti-Falta (WhatsApp)
            </h4>
            <ul className="list-disc list-inside text-xs sm:text-sm text-amber-900 space-y-1">
              <li><strong>24 horas antes:</strong> O WhatsCRM envia uma mensagem lembrando da consulta com opção de responder <code>1 para Confirmar</code> ou <code>2 para Reagendar</code>.</li>
              <li><strong>2 horas antes:</strong> Disparo automático de aviso no dia da consulta para reduzir o índice de faltas (no-show).</li>
            </ul>
          </div>
        </div>
      )
    },
    {
      id: "leads-funnel",
      title: "Funil de Vendas & Leads (Kanban)",
      category: "Comercial",
      icon: UserPlus,
      summary: "Acompanhamento visual de oportunidades em formato Kanban com valores e estágios de negociação.",
      content: (
        <div className="space-y-6">
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
            No menu <strong>Leads</strong> (<Link to="/leads" className="underline font-bold text-emerald-600">/leads</Link>), você organiza todos os seus negócios em um painel visual do tipo Kanban.
          </p>

          <div className="space-y-3">
            <h4 className="text-sm font-bold text-slate-900">Estágios Padrão do Funil:</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs font-semibold">
              <div className="p-3 bg-slate-100 rounded-xl border border-slate-200">1. Novo Lead</div>
              <div className="p-3 bg-blue-50 text-blue-700 rounded-xl border border-blue-200">2. Em Qualificação</div>
              <div className="p-3 bg-amber-50 text-amber-700 rounded-xl border border-amber-200">3. Proposta Enviada</div>
              <div className="p-3 bg-purple-50 text-purple-700 rounded-xl border border-purple-200">4. Em Negociação</div>
              <div className="p-3 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-200">5. Venda Fechada 🏆</div>
              <div className="p-3 bg-red-50 text-red-700 rounded-xl border border-red-200">6. Perdido</div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: "automations-menus",
      title: "Automações & Menus Inteligentes",
      category: "Automação",
      icon: Zap,
      summary: "Respostas automáticas por palavras-chave com simulação de digitação e menus numéricos (1, 2, 3...).",
      content: (
        <div className="space-y-6">
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
            Deixe seu atendimento funcionando 24/7 configurando gatilhos instantâneos e menus interativos para direcionar os clientes.
          </p>

          <div className="space-y-3">
            <h4 className="text-sm font-bold text-slate-900">1. Automações por Palavras-Chave (/automations)</h4>
            <p className="text-xs sm:text-sm text-slate-600">
              Cadastre termos como <code>preco, catalogo, horario, pix</code>. Quando um cliente enviar uma mensagem contendo essas palavras, o WhatsCRM responde no mesmo instante com texto, áudio gravado ou arquivo PDF.
            </p>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-bold text-slate-900">2. Construtor de Menus Inteligentes (/menu-builder)</h4>
            <p className="text-xs sm:text-sm text-slate-600">
              Crie menus numéricos (ex: <i>"Digite 1 para Suporte, 2 para Compras, 3 para Agendar Consulta"</i>). O sistema reconhece a opção digitada e entrega a resposta correspondente.
            </p>
          </div>
        </div>
      )
    },
    {
      id: "ai-agent",
      title: "Agente de IA Autônomo (Google Gemini)",
      category: "Inteligência Artificial",
      icon: Bot,
      summary: "Configuração do assistente virtual com inteligência artificial para atendimento automático.",
      content: (
        <div className="space-y-6">
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
            O <strong>Agente IA</strong> (<Link to="/agent" className="underline font-bold text-emerald-600">/agent</Link>) utiliza o modelo <strong>Google Gemini</strong> para conversar com seus clientes com linguagem natural, cordial e contextualizada.
          </p>

          <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl space-y-2">
            <h4 className="font-bold text-sm text-slate-900">Como Treinar seu Agente:</h4>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              No campo <strong>Instruções do Sistema</strong>, escreva quem é sua empresa, os preços dos seus produtos/serviços, regras de entrega e o tom de voz desejado. A IA responderá com precisão baseada estritamente nas suas instruções.
            </p>
          </div>
        </div>
      )
    },
    {
      id: "groups-schedule",
      title: "Grupos & Disparos Programados",
      category: "Avançado",
      icon: Clock,
      summary: "Moderação anti-spam para grupos de WhatsApp e agendamento de mensagens e Status futuros.",
      content: (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
              <h4 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                👥 Moderação de Grupos (/groups)
              </h4>
              <p className="text-xs text-slate-600">
                Ative proteção <strong>Anti-Link</strong>, <strong>Anti-Spam</strong> e configure mensagens de <strong>Boas-Vindas Automáticas</strong> para novos membros que entrarem nos seus grupos.
              </p>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
              <h4 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                ⏰ Disparos Programados (/schedule)
              </h4>
              <p className="text-xs text-slate-600">
                Programe mensagens para clientes em datas futuras ou automatize postagens de imagens e vídeos nos seus <strong>Status (Stories)</strong> do WhatsApp.
              </p>
            </div>
          </div>
        </div>
      )
    }
  ];

  const filteredSections = sections.filter(s => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return s.title.toLowerCase().includes(q) || s.summary.toLowerCase().includes(q) || s.category.toLowerCase().includes(q);
  });

  const currentSection = sections.find(s => s.id === activeSection) || sections[0];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-emerald-500 selection:text-white">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center font-bold shadow-sm">
              W
            </div>
            <span className="font-black text-lg text-slate-900 tracking-tight">
              Whats<span className="text-emerald-600">CRM</span> <span className="text-xs font-mono font-bold text-slate-400">Docs</span>
            </span>
          </Link>
        </div>

        <div className="flex items-center gap-2.5">
          <Link to="/dashboard">
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold gap-1.5 shadow-sm">
              Acessar Painel <ArrowRight size={14} />
            </Button>
          </Link>

          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 text-slate-600 md:hidden hover:bg-slate-100 rounded-xl"
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 max-w-7xl w-full mx-auto flex flex-col md:flex-row gap-6 p-4 sm:p-6 lg:p-8">
        
        {/* Left Navigation Sidebar */}
        <aside className={`md:w-72 shrink-0 space-y-4 ${mobileMenuOpen ? 'block' : 'hidden md:block'}`}>
          {/* Search Input */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar na documentação..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 shadow-sm"
            />
          </div>

          {/* Navigation Items */}
          <div className="bg-white p-2.5 rounded-2xl border border-slate-200/80 shadow-sm space-y-1">
            {filteredSections.map((sec) => {
              const Icon = sec.icon;
              const isActive = activeSection === sec.id;
              return (
                <button
                  key={sec.id}
                  onClick={() => {
                    setActiveSection(sec.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition-all ${
                    isActive
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <Icon size={16} className={isActive ? "text-white" : "text-emerald-600"} />
                  <span className="truncate">{sec.title}</span>
                </button>
              );
            })}
          </div>

          <div className="p-4 bg-emerald-50/70 border border-emerald-200/80 rounded-2xl space-y-2 text-xs">
            <h5 className="font-bold text-emerald-950 flex items-center gap-1.5">
              <HelpCircle size={14} className="text-emerald-600" /> Precisa de Ajuda?
            </h5>
            <p className="text-slate-600 text-[11px] leading-relaxed">
              Nossa equipe está disponível para tirar dúvidas e ajudar na configuração do seu WhatsApp.
            </p>
            <a
              href="https://wa.me/258848858288"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-bold text-emerald-700 hover:underline pt-1"
            >
              Falar com Suporte WhatsApp <ExternalLink size={12} />
            </a>
          </div>
        </aside>

        {/* Right Content Area */}
        <main className="flex-1 bg-white rounded-3xl border border-slate-200/80 shadow-sm p-6 sm:p-10 space-y-8 animate-in fade-in duration-300">
          
          {/* Header of Section */}
          <div className="border-b border-slate-100 pb-6 space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-emerald-700 border-emerald-200 bg-emerald-50">
                {currentSection.category}
              </Badge>
            </div>
            
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
              <currentSection.icon className="h-8 w-8 text-emerald-600" />
              {currentSection.title}
            </h1>
            
            <p className="text-sm sm:text-base text-slate-500 leading-relaxed max-w-3xl">
              {currentSection.summary}
            </p>
          </div>

          {/* Section Body */}
          <div className="prose prose-slate max-w-none text-slate-700">
            {currentSection.content}
          </div>

          {/* Next / Previous Navigation */}
          <div className="pt-8 border-t border-slate-100 flex items-center justify-between gap-4">
            {(() => {
              const idx = sections.findIndex(s => s.id === currentSection.id);
              const prev = idx > 0 ? sections[idx - 1] : null;
              const next = idx < sections.length - 1 ? sections[idx + 1] : null;

              return (
                <>
                  {prev ? (
                    <button
                      onClick={() => setActiveSection(prev.id)}
                      className="text-left px-4 py-2.5 bg-slate-50 hover:bg-slate-100 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 transition-colors"
                    >
                      <span className="block text-[10px] text-slate-400 font-normal">Anterior</span>
                      ← {prev.title}
                    </button>
                  ) : <div />}

                  {next ? (
                    <button
                      onClick={() => setActiveSection(next.id)}
                      className="text-right px-4 py-2.5 bg-emerald-50 hover:bg-emerald-100 rounded-xl border border-emerald-200 text-xs font-bold text-emerald-800 transition-colors"
                    >
                      <span className="block text-[10px] text-emerald-600 font-normal">Próximo</span>
                      {next.title} →
                    </button>
                  ) : <div />}
                </>
              );
            })()}
          </div>
        </main>
      </div>
    </div>
  );
}
