import React, { useState, useEffect, useRef } from "react";
import { 
  Bot, 
  X, 
  Send, 
  Sparkles, 
  Trash2, 
  Maximize2, 
  Minimize2, 
  Zap, 
  TrendingUp, 
  MessageSquare, 
  CheckCircle2, 
  AlertCircle,
  Clock,
  UserCheck
} from "lucide-react";
import { Button } from "./ui/Button";
import { cn } from "../lib/utils";
import { apiFetch } from "../lib/api";
import { toast } from "sonner";

interface CopilotMessage {
  id: string;
  sender: "user" | "agent";
  text: string;
  timestamp: string;
  tool?: string | null;
  args?: any;
  toolResult?: any;
}

const QUICK_PROMPTS = [
  { label: "Conversas pendentes", query: "Agentex, quantas conversas estão pendentes de resposta?" },
  { label: "Métricas do Funil", query: "Qual é o resumo das oportunidades no funil de vendas?" },
  { label: "Buscar contacto", query: "Busca informações do contacto João" },
  { label: "Criar automação de preço", query: "Cria uma automação: quando o cliente mandar 'preço', responde com a tabela de serviços" },
];

export function AgentexCopilot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<CopilotMessage[]>(() => {
    try {
      const saved = sessionStorage.getItem("agentex_copilot_history");
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [
      {
        id: "welcome",
        sender: "agent",
        text: "Olá, Administrador! 👋 Sou o **Agentex Operador**, o copiloto autônomo da sua empresa.\n\nPosso consultar métricas, listar pendências no WhatsApp, mover etapas de leads, enviar mensagens ou criar automações por comando de voz ou texto. Como posso ajudar agora?",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ];
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync with session storage
  useEffect(() => {
    try {
      sessionStorage.setItem("agentex_copilot_history", JSON.stringify(messages));
    } catch (e) {}
  }, [messages]);

  // Scroll to bottom on new message
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen]);

  const handleSendMessage = async (textToSend?: string) => {
    const query = (textToSend || input).trim();
    if (!query || loading) return;

    const userMsgId = `user-${Date.now()}`;
    const userMsg: CopilotMessage = {
      id: userMsgId,
      sender: "user",
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    if (!textToSend) setInput("");
    setLoading(true);

    try {
      // Build context for LLM (last 6 messages)
      const context = messages.slice(-6).map(m => 
        `${m.sender === "user" ? "Usuário" : "Agentex"}: ${m.text}`
      );

      const response = await apiFetch("/api/agent/chat", {
        method: "POST",
        body: JSON.stringify({
          message: query,
          context
        })
      });

      if (!response.success) {
        throw new Error(response.error || "Erro ao consultar o Agentex");
      }

      const agentData = response.data;
      const agentMsgId = `agent-${Date.now()}`;
      const agentMsg: CopilotMessage = {
        id: agentMsgId,
        sender: "agent",
        text: agentData.reply || "Ação executada com sucesso!",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        tool: agentData.tool,
        args: agentData.args,
        toolResult: agentData.toolResult
      };

      setMessages(prev => [...prev, agentMsg]);
    } catch (err: any) {
      console.error("[Copilot Web Error]:", err);
      const isMissingKey = err.message?.includes("API Key missing") || err.message?.includes("GEMINI_API_KEY");
      if (isMissingKey) {
        toast.error("Chave de API de IA não configurada.");
      } else {
        toast.error("Falha ao comunicar com o Agentex.");
      }
      const errorMsg: CopilotMessage = {
        id: `err-${Date.now()}`,
        sender: "agent",
        text: isMissingKey
          ? "⚠️ **Chave de API não configurada:**\n\nPara que eu possa analisar o sistema e executar comandos, configure a sua chave de API do Gemini (ou OpenAI/DeepSeek) no menu **Agente IA** (`/agent`) ou adicione `GEMINI_API_KEY=sua_chave` no arquivo `.env`."
          : "Desculpe, ocorreu uma instabilidade momentânea ao executar essa instrução. Verifique a conexão ou tente novamente.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const clearHistory = () => {
    const initial: CopilotMessage[] = [
      {
        id: "welcome",
        sender: "agent",
        text: "Histórico limpo. Como posso ajudar com a sua operação hoje?",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ];
    setMessages(initial);
    sessionStorage.removeItem("agentex_copilot_history");
    toast.info("Histórico do Copiloto limpo.");
  };

  return (
    <>
      {/* Floating Trigger Button (Bottom-Right) */}
      <button
        onClick={() => setIsOpen(true)}
        className={cn(
          "fixed bottom-5 right-5 z-40 flex items-center gap-2.5 px-4 py-3 rounded-2xl",
          "bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 text-white font-bold text-xs uppercase tracking-wider",
          "shadow-xl shadow-emerald-600/30 hover:shadow-2xl hover:shadow-emerald-600/40 hover:scale-105 active:scale-95",
          "transition-all duration-300 cursor-pointer border border-emerald-400/40 backdrop-blur-sm group",
          isOpen && "hidden"
        )}
        title="Abrir Copiloto Agentex Operador"
      >
        <div className="relative">
          <div className="h-7 w-7 rounded-xl bg-white/20 flex items-center justify-center text-white group-hover:rotate-12 transition-transform">
            <Bot size={16} />
          </div>
          <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-200"></span>
          </span>
        </div>
        <div className="flex flex-col text-left">
          <span className="text-[10px] text-emerald-100 font-extrabold leading-none">Copiloto IA</span>
          <span className="text-xs font-black tracking-tight text-white mt-0.5">Agentex</span>
        </div>
      </button>

      {/* Slide-over Drawer Backdrop (Mobile) */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-slate-900/30 backdrop-blur-xs z-50 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Slide-over Drawer Window */}
      <div
        className={cn(
          "fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[420px] lg:w-[440px] bg-white shadow-2xl border-l border-slate-200 flex flex-col transition-all duration-300 ease-out transform",
          isOpen ? "translate-x-0" : "translate-x-full pointer-events-none"
        )}
      >
        {/* Drawer Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 bg-gradient-to-r from-slate-900 to-slate-800 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-inner">
              <Bot size={22} />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="font-bold text-sm text-white tracking-tight">Agentex Operador</h3>
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-medium">Controle executivo da sua plataforma</p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg"
              onClick={clearHistory}
              title="Limpar histórico do chat"
            >
              <Trash2 size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg"
              onClick={() => setIsOpen(false)}
              title="Fechar janela"
            >
              <X size={18} />
            </Button>
          </div>
        </div>

        {/* Quick Suggestion Prompts */}
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 overflow-x-auto no-scrollbar flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1 shrink-0">
            <Sparkles size={11} className="text-amber-500" /> Sugestões:
          </span>
          {QUICK_PROMPTS.map((qp, idx) => (
            <button
              key={idx}
              type="button"
              disabled={loading}
              onClick={() => handleSendMessage(qp.query)}
              className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-white border border-slate-200/80 text-slate-700 hover:border-emerald-300 hover:text-emerald-700 hover:bg-emerald-50/50 transition-all shrink-0 cursor-pointer shadow-2xs"
            >
              {qp.label}
            </button>
          ))}
        </div>

        {/* Chat Messages Stream */}
        <div className="flex-1 p-4 overflow-y-auto space-y-4 custom-scrollbar bg-slate-50/50">
          {messages.map((msg) => {
            const isUser = msg.sender === "user";
            return (
              <div
                key={msg.id}
                className={cn(
                  "flex flex-col max-w-[88%]",
                  isUser ? "ml-auto items-end" : "mr-auto items-start"
                )}
              >
                <div
                  className={cn(
                    "p-3.5 rounded-2xl text-xs sm:text-[13px] leading-relaxed shadow-xs whitespace-pre-line",
                    isUser
                      ? "bg-slate-900 text-white rounded-br-xs font-medium"
                      : "bg-white text-slate-800 border border-slate-200/80 rounded-bl-xs"
                  )}
                >
                  {msg.text}
                </div>

                {/* Tool Execution Card (if triggered) */}
                {!isUser && msg.tool && (
                  <div className="mt-1.5 p-2.5 rounded-xl bg-emerald-50/80 border border-emerald-200/90 text-left w-full space-y-1">
                    <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-emerald-800">
                      <Zap size={11} className="text-emerald-600" />
                      <span>Ação no Sistema: {msg.tool}</span>
                    </div>
                    {msg.toolResult && (
                      <p className="text-[11px] font-medium text-emerald-900 leading-normal">
                        {msg.toolResult.message || "Executado com sucesso."}
                      </p>
                    )}
                  </div>
                )}

                <span className="text-[9px] text-slate-400 mt-1 px-1 font-medium">
                  {msg.timestamp}
                </span>
              </div>
            );
          })}

          {/* Typing Loading Indicator */}
          {loading && (
            <div className="flex flex-col mr-auto items-start max-w-[80%]">
              <div className="p-3.5 rounded-2xl bg-white border border-slate-200/80 rounded-bl-xs shadow-xs flex items-center gap-2">
                <div className="flex gap-1 items-center">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-bounce"></span>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:0.2s]"></span>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:0.4s]"></span>
                </div>
                <span className="text-[11px] font-bold text-slate-500">Agentex está a consultar a base...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <div className="p-3 border-t border-slate-200 bg-white shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex items-center gap-2"
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              placeholder="Pergunte ao Agentex (ex: 'Quem está sem resposta?')..."
              className="flex-1 h-10 px-3.5 text-xs font-medium rounded-xl border border-slate-200 bg-slate-50/50 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
            />

            <Button
              type="submit"
              disabled={loading || !input.trim()}
              className="h-10 w-10 p-0 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shrink-0 flex items-center justify-center shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
              title="Enviar instrução"
            >
              <Send size={15} />
            </Button>
          </form>
          <div className="flex items-center justify-between mt-2 px-1">
            <span className="text-[9px] text-slate-400 font-medium">Pressione Enter para enviar</span>
            <span className="text-[9px] text-emerald-600 font-bold uppercase tracking-wider flex items-center gap-1">
              <Sparkles size={10} /> Operador Multitarefa
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
