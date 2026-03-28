import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, Zap, Key, Globe, Save, Power, AlertCircle, Info } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "../components/ui/Card";
import { cn } from "../lib/utils";
import { useActivation } from "../lib/useActivation";

interface AgentConfig {
  id?: string;
  is_active: boolean;
  provider: "gemini" | "openai" | "deepseek" | "huggingface" | "custom";
  api_key: string;
  api_url: string;
  model: string;
  instructions: string;
}

export default function Agent() {
  const navigate = useNavigate();
  const { isActivated, planDetails, loading: activationLoading } = useActivation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [config, setConfig] = useState<AgentConfig>({
    is_active: false,
    provider: "gemini",
    api_key: "",
    api_url: "",
    model: "gemini-3-flash-preview",
    instructions: "Você é um assistente de vendas prestativo para o WhatsCRM. Responda de forma educada e profissional."
  });

  useEffect(() => {
    if (!activationLoading) {
      Promise.all([fetchConfig(), fetchModels()]).finally(() => setLoading(false));
    }
  }, [activationLoading]);

  const fetchModels = async () => {
    try {
      const data = await apiFetch("/api/agent/providers/models");
      setModels(data);
    } catch (err: any) {
      console.error("Error fetching models:", err);
      toast.error(`Erro ao carregar modelos: ${err.message}`);
    }
  };

  const fetchConfig = async () => {
    try {
      const data = await apiFetch("/api/agent");
      if (data && data.id) {
        setConfig({
          ...data,
          api_key: data.api_key || "",
          api_url: data.api_url || "",
          model: data.model || "",
          instructions: data.instructions || ""
        });
      }
    } catch (err: any) {
      console.error("Error fetching agent config:", err);
      toast.error(`Erro ao carregar configuração: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (config.provider !== "gemini" && !config.api_key) {
      toast.error("Por favor, insira a API Key do provedor selecionado.");
      return;
    }

    if (config.provider === "custom" && !config.api_url) {
      toast.error("Por favor, insira a URL do endpoint para o provedor Custom.");
      return;
    }

    setSaving(true);
    try {
      console.log("Saving agent config...", config.provider);
      const savedData = await apiFetch("/api/agent/create-or-update", {
        method: "POST",
        body: JSON.stringify(config),
      });

      if (savedData && savedData.id) {
        setConfig(prev => ({
          ...prev,
          ...savedData,
          api_key: savedData.api_key || "********"
        }));
      }

      toast.success("Configurações do Agente salvas com sucesso!");
    } catch (err: any) {
      console.error("Error saving agent config:", err);
      toast.error(err.message || "Erro ao salvar configurações.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async () => {
    const newState = !config.is_active;
    try {
      await apiFetch("/api/agent/toggle", {
        method: "POST",
        body: JSON.stringify({ is_active: newState })
      });

      setConfig(prev => ({ ...prev, is_active: newState }));
      toast.success(newState ? "Agente IA ativado!" : "Agente IA desativado.");
    } catch (err: any) {
      console.error("Error toggling agent:", err);
      toast.error(err.message || "Erro ao alterar status do agente.");
    }
  };

  if (activationLoading || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent"></div>
      </div>
    );
  }

  if (!isActivated) {
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="py-12 text-center space-y-4">
            <Bot size={48} className="mx-auto text-amber-400" />
            <h3 className="text-xl font-bold text-amber-900">Conta não Ativada</h3>
            <p className="text-amber-700 max-w-md mx-auto">
              Você precisa ativar sua conta com um código de licença para usar o Agente IA.
            </p>
            <Button onClick={() => navigate("/activate")} className="bg-amber-600 hover:bg-amber-700">
              Ativar Agora
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (planDetails && !planDetails.ai_enabled) {
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="py-12 text-center space-y-4">
            <Bot size={48} className="mx-auto text-amber-400" />
            <h3 className="text-xl font-bold text-amber-900">Recurso Indisponível</h3>
            <p className="text-amber-700 max-w-md mx-auto">
              O Agente de IA não está disponível no seu plano atual. Faça um upgrade para utilizar este recurso.
            </p>
            <Button onClick={() => navigate("/activate")} className="bg-amber-600 hover:bg-amber-700">
              Fazer Upgrade
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Bot className="text-emerald-600" />
            Modo Agente IA
          </h2>
          <p className="text-slate-500">Configure um assistente inteligente para responder seus clientes automaticamente.</p>
        </div>
        <Button 
          variant={config.is_active ? "primary" : "ghost"}
          className={cn(
            "gap-2 h-12 px-6 rounded-xl font-bold transition-all",
            config.is_active ? "bg-emerald-600 shadow-lg shadow-emerald-200" : "bg-slate-200 text-slate-600"
          )}
          onClick={handleToggle}
        >
          <Power size={20} />
          {config.is_active ? "Agente Ativado" : "Ativar Agente"}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Configuração do Provedor</CardTitle>
              <CardDescription>Escolha qual inteligência artificial irá processar suas mensagens.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Provedor de IA</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <button
                    onClick={() => setConfig({ ...config, provider: "gemini", model: "gemini-3-flash-preview" })}
                    className={cn(
                      "p-4 rounded-xl border-2 text-left transition-all hover:border-emerald-200",
                      config.provider === "gemini" ? "border-emerald-500 bg-emerald-50" : "border-slate-100 bg-white"
                    )}
                  >
                    <Zap className={cn("mb-2", config.provider === "gemini" ? "text-emerald-600" : "text-slate-400")} size={24} />
                    <p className="font-bold text-sm">Gemini</p>
                    <p className="text-[10px] text-slate-500">Google AI Studio (Recomendado)</p>
                  </button>
                  <button
                    onClick={() => setConfig({ ...config, provider: "openai", model: "gpt-3.5-turbo" })}
                    className={cn(
                      "p-4 rounded-xl border-2 text-left transition-all hover:border-emerald-200",
                      config.provider === "openai" ? "border-emerald-500 bg-emerald-50" : "border-slate-100 bg-white"
                    )}
                  >
                    <Bot className={cn("mb-2", config.provider === "openai" ? "text-emerald-600" : "text-slate-400")} size={24} />
                    <p className="font-bold text-sm">OpenAI</p>
                    <p className="text-[10px] text-slate-500">ChatGPT (Requer API Key)</p>
                  </button>
                  <button
                    onClick={() => setConfig({ ...config, provider: "deepseek", model: "deepseek-chat" })}
                    className={cn(
                      "p-4 rounded-xl border-2 text-left transition-all hover:border-emerald-200",
                      config.provider === "deepseek" ? "border-emerald-500 bg-emerald-50" : "border-slate-100 bg-white"
                    )}
                  >
                    <Bot className={cn("mb-2", config.provider === "deepseek" ? "text-emerald-600" : "text-slate-400")} size={24} />
                    <p className="font-bold text-sm">DeepSeek</p>
                    <p className="text-[10px] text-slate-500">DeepSeek API</p>
                  </button>
                  <button
                    onClick={() => setConfig({ ...config, provider: "huggingface", model: "mistralai/Mistral-7B-Instruct-v0.2" })}
                    className={cn(
                      "p-4 rounded-xl border-2 text-left transition-all hover:border-emerald-200",
                      config.provider === "huggingface" ? "border-emerald-500 bg-emerald-50" : "border-slate-100 bg-white"
                    )}
                  >
                    <Bot className={cn("mb-2", config.provider === "huggingface" ? "text-emerald-600" : "text-slate-400")} size={24} />
                    <p className="font-bold text-sm">Hugging Face</p>
                    <p className="text-[10px] text-slate-500">Modelos Open Source</p>
                  </button>
                  <button
                    onClick={() => setConfig({ ...config, provider: "custom", model: "" })}
                    className={cn(
                      "p-4 rounded-xl border-2 text-left transition-all hover:border-emerald-200",
                      config.provider === "custom" ? "border-emerald-500 bg-emerald-50" : "border-slate-100 bg-white"
                    )}
                  >
                    <Globe className={cn("mb-2", config.provider === "custom" ? "text-emerald-600" : "text-slate-400")} size={24} />
                    <p className="font-bold text-sm">Custom API</p>
                    <p className="text-[10px] text-slate-500">URL Personalizada</p>
                  </button>
                </div>
              </div>

              {config.provider === "gemini" && (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                  <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex gap-3">
                    <Info className="text-blue-600 shrink-0" size={20} />
                    <p className="text-xs text-blue-800 leading-relaxed">
                      <strong>Dica:</strong> Por padrão, o sistema usa uma chave compartilhada. Se você estiver enfrentando erros de limite, insira sua própria <strong>Gemini API Key</strong> abaixo.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Gemini API Key (Opcional)</label>
                    <div className="relative">
                      <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <Input 
                        type="password"
                        placeholder="Sua chave do Google AI Studio" 
                        className="pl-10"
                        value={config.api_key}
                        onChange={e => setConfig({ ...config, api_key: e.target.value })}
                      />
                    </div>
                    <p className="text-[10px] text-slate-500">Obtenha sua chave em <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-emerald-600 underline">Google AI Studio</a>.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Modelo</label>
                    <select 
                      className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                      value={config.model}
                      onChange={e => setConfig({ ...config, model: e.target.value })}
                    >
                      {(models[config.provider] || []).map(model => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {["openai", "deepseek", "huggingface"].includes(config.provider) && (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">
                      {config.provider === "openai" ? "OpenAI API Key" : 
                       config.provider === "deepseek" ? "DeepSeek API Key" : 
                       "Hugging Face API Token"}
                    </label>
                    <div className="relative">
                      <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <Input 
                        type="password"
                        placeholder={config.provider === "huggingface" ? "hf_..." : "sk-..."}
                        className="pl-10"
                        value={config.api_key}
                        onChange={e => setConfig({ ...config, api_key: e.target.value })}
                      />
                    </div>
                    <p className="text-[10px] text-slate-500">Sua chave é criptografada e nunca será exposta.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Modelo</label>
                    <select 
                      className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                      value={config.model}
                      onChange={e => setConfig({ ...config, model: e.target.value })}
                    >
                      {(models[config.provider] || []).map(model => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {config.provider === "custom" && (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Endpoint URL</label>
                    <div className="relative">
                      <Globe className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <Input 
                        placeholder="https://sua-api.com/v1/chat" 
                        className="pl-10"
                        value={config.api_url}
                        onChange={e => setConfig({ ...config, api_url: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">API Key (Opcional)</label>
                    <div className="relative">
                      <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <Input 
                        type="password"
                        placeholder="Sua chave de acesso" 
                        className="pl-10"
                        value={config.api_key}
                        onChange={e => setConfig({ ...config, api_key: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Instruções do Agente (Prompt)</CardTitle>
              <CardDescription>Defina como o agente deve se comportar e o que ele deve responder.</CardDescription>
            </CardHeader>
            <CardContent>
              <textarea
                className="w-full min-h-[200px] p-4 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 focus:outline-none text-sm leading-relaxed"
                placeholder="Ex: Você é um assistente de vendas da empresa WhatsCRM. Seu objetivo é agendar reuniões..."
                value={config.instructions}
                onChange={e => setConfig({ ...config, instructions: e.target.value })}
              />
            </CardContent>
            <CardFooter className="bg-slate-50/50 border-t border-slate-100 py-3">
              <p className="text-[10px] text-slate-500">Dica: Seja específico sobre o tom de voz e as informações que o agente pode fornecer.</p>
            </CardFooter>
          </Card>

          <div className="flex justify-end">
            <Button 
              size="lg" 
              className="gap-2 px-8" 
              onClick={handleSave}
              disabled={saving}
            >
              <Save size={18} />
              {saving ? "Salvando..." : "Salvar Configurações"}
            </Button>
          </div>
        </div>

        <div className="space-y-6">
          <Card className="bg-emerald-900 text-white border-none overflow-hidden relative">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <Bot size={120} />
            </div>
            <CardHeader>
              <CardTitle className="text-white">Status do Agente</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "h-3 w-3 rounded-full animate-pulse",
                  config.is_active ? "bg-emerald-400" : "bg-slate-400"
                )} />
                <span className="text-sm font-medium">
                  {config.is_active ? "Operando em tempo real" : "Agente em repouso"}
                </span>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] text-emerald-300 uppercase font-bold">Provedor Ativo</p>
                <p className="text-sm capitalize">{config.provider}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] text-emerald-300 uppercase font-bold">Modelo</p>
                <p className="text-sm">{config.model || "N/A"}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Regras de Segurança</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3">
                <AlertCircle className="text-amber-500 shrink-0" size={16} />
                <p className="text-[11px] text-slate-600">O agente aguarda entre 5 a 15 segundos antes de responder para parecer humano.</p>
              </div>
              <div className="flex gap-3">
                <AlertCircle className="text-amber-500 shrink-0" size={16} />
                <p className="text-[11px] text-slate-600">Mensagens curtas como "ok", "sim", "não" são ignoradas para evitar loops.</p>
              </div>
              <div className="flex gap-3">
                <AlertCircle className="text-amber-500 shrink-0" size={16} />
                <p className="text-[11px] text-slate-600">O agente mantém o contexto das últimas 5 mensagens da conversa.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
