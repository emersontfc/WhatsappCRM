import React, { useState, useEffect } from "react";
import { Plus, Trash2, MessageSquare, Smartphone, Save, ChevronRight, Hash, Mic, X, Image, FileText, Upload } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "./ui/Card";
import { cn } from "../lib/utils";
import { VoiceRecorder } from "./VoiceRecorder";

interface MenuOption {
  id: string;
  key: string;
  label: string;
  response_type: "text" | "audio" | "image" | "document";
  response: string;
  media_url?: string;
  submenu?: MenuData;
}

interface MenuData {
  type: "menu";
  name: string;
  body: string;
  footer?: string;
  options: MenuOption[];
}

interface MenuBuilderProps {
  initialData?: any;
  onSave: (data: any) => void;
  title?: string;
}

const numberEmojis = ["0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

export function MenuBuilder({ initialData, onSave, title = "Construtor de Menu Numérico" }: MenuBuilderProps) {
  const [name, setName] = useState(initialData?.name || "");
  const [body, setBody] = useState(initialData?.body || initialData?.message || "Olá! Como posso ajudar hoje?");
  const [footer, setFooter] = useState(initialData?.footer || "Digite o número da opção desejada.");
  const [options, setOptions] = useState<MenuOption[]>(
    initialData?.options?.map((opt: any) => ({
      ...opt,
      id: opt.id || crypto.randomUUID(),
      response_type: opt.response_type || "text"
    })) || [
      { id: crypto.randomUUID(), key: "1", label: "Falar com Atendente", response_type: "text", response: "Um momento, vou te transferir." },
      { id: crypto.randomUUID(), key: "2", label: "Ver Preços", response_type: "text", response: "Nossos planos começam em R$ 99/mês." }
    ]
  );

  useEffect(() => {
    if (initialData) {
      setName(initialData.name || "");
      setBody(initialData.body || initialData.message || "");
      setFooter(initialData.footer || "");
      setOptions(initialData.options?.map((opt: any) => ({
        ...opt,
        id: opt.id || crypto.randomUUID(),
        response_type: opt.response_type || "text"
      })) || []);
    }
  }, [initialData]);

  const addOption = () => {
    const nextKey = (options.length + 1).toString();
    setOptions([
      ...options,
      { id: crypto.randomUUID(), key: nextKey, label: "", response_type: "text", response: "" }
    ]);
  };

  const removeOption = (id: string) => {
    const newOptions = options.filter(opt => opt.id !== id).map((opt, index) => ({
      ...opt,
      key: (index + 1).toString()
    }));
    setOptions(newOptions);
  };

  const updateOption = (id: string, field: keyof MenuOption, value: any) => {
    setOptions(options.map(opt => opt.id === id ? { ...opt, [field]: value } : opt));
  };

  const handleSave = () => {
    if (!name.trim()) {
      alert("Por favor, dê um nome ao menu.");
      return;
    }
    onSave({
      type: "menu",
      name,
      message: body,
      footer,
      options: options.map(({ id, ...rest }) => rest as MenuOption)
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Editor Side */}
      <div className="space-y-6">
        <Card className="border-slate-100 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <Hash className="w-5 h-5 text-emerald-600" />
              {title}
            </CardTitle>
            <CardDescription>Crie menus de texto puro que funcionam em qualquer aparelho.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Nome do Menu (Interno)</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Menu Principal, Suporte, Vendas..."
                className="h-11 rounded-xl bg-slate-50 border-slate-100 focus:bg-white transition-all"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Mensagem Principal</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Digite a mensagem que o cliente receberá..."
                className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:ring-2 focus:ring-emerald-500/20 outline-none min-h-[100px] resize-none transition-all"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Rodapé (Opcional)</label>
              <Input
                value={footer}
                onChange={(e) => setFooter(e.target.value)}
                placeholder="Ex: Digite o número da opção..."
                className="h-11 rounded-xl bg-slate-50 border-slate-100 focus:bg-white transition-all"
              />
            </div>

            <div className="space-y-4 pt-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Opções do Menu</label>
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm" 
                  onClick={addOption}
                  className="h-8 rounded-lg text-[10px] font-bold uppercase tracking-widest border-emerald-100 text-emerald-600 hover:bg-emerald-50"
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Adicionar Opção
                </Button>
              </div>

              <div className="space-y-3">
                {options.map((option, index) => (
                  <div key={option.id} className="p-4 bg-white border border-slate-100 rounded-2xl shadow-sm space-y-3 relative group hover:border-emerald-200 transition-all">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600 font-bold text-sm">
                        {index + 1}
                      </div>
                      <Input
                        value={option.label}
                        onChange={(e) => updateOption(option.id, "label", e.target.value)}
                        placeholder="Ex: Ver Catálogo"
                        className="h-9 text-sm font-semibold border-none bg-slate-50 focus:bg-white transition-all"
                      />
                      <button 
                        onClick={() => removeOption(option.id)}
                        className="p-2 text-slate-300 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <button
                          onClick={() => updateOption(option.id, "response_type", "text")}
                          className={cn(
                            "text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full border transition-all",
                            option.response_type === "text" ? "bg-emerald-500 border-emerald-500 text-white" : "bg-slate-50 border-slate-200 text-slate-500"
                          )}
                        >
                          Texto
                        </button>
                        <button
                          onClick={() => updateOption(option.id, "response_type", "audio")}
                          className={cn(
                            "text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full border transition-all",
                            option.response_type === "audio" ? "bg-emerald-500 border-emerald-500 text-white" : "bg-slate-50 border-slate-200 text-slate-500"
                          )}
                        >
                          Áudio
                        </button>
                        <button
                          onClick={() => updateOption(option.id, "response_type", "image")}
                          className={cn(
                            "text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full border transition-all",
                            option.response_type === "image" ? "bg-emerald-500 border-emerald-500 text-white" : "bg-slate-50 border-slate-200 text-slate-500"
                          )}
                        >
                          Foto
                        </button>
                        <button
                          onClick={() => updateOption(option.id, "response_type", "document")}
                          className={cn(
                            "text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full border transition-all",
                            option.response_type === "document" ? "bg-emerald-500 border-emerald-500 text-white" : "bg-slate-50 border-slate-200 text-slate-500"
                          )}
                        >
                          Doc
                        </button>
                      </div>

                      {option.response_type === "text" ? (
                        <textarea
                          value={option.response}
                          onChange={(e) => updateOption(option.id, "response", e.target.value)}
                          placeholder="O que o bot responde..."
                          className="w-full p-3 bg-slate-50 border-none rounded-xl text-xs focus:ring-1 focus:ring-emerald-500/20 outline-none min-h-[60px] resize-none"
                        />
                      ) : option.response_type === "audio" ? (
                        <div className="space-y-2">
                          <VoiceRecorder 
                            onSend={(url) => updateOption(option.id, "media_url", url)} 
                            onCancel={() => {}} 
                          />
                          {option.media_url && (
                            <div className="flex items-center gap-2 p-2 bg-emerald-50 rounded-lg border border-emerald-100">
                              <Mic className="w-3 h-3 text-emerald-600" />
                              <span className="text-[9px] text-emerald-700 font-medium truncate flex-1">Áudio gravado</span>
                              <Button variant="ghost" size="icon" className="h-5 w-5 text-emerald-600 hover:text-red-500" onClick={() => updateOption(option.id, "media_url", "")}>
                                <X className="w-3 h-3" />
                              </Button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <Input
                              value={option.media_url || ""}
                              onChange={(e) => updateOption(option.id, "media_url", e.target.value)}
                              placeholder={option.response_type === "image" ? "URL da Imagem..." : "URL do Documento..."}
                              className="h-9 text-xs bg-slate-50 border-slate-100"
                            />
                            <div className="relative">
                              <input
                                type="file"
                                id={`file-${option.id}`}
                                className="hidden"
                                accept={option.response_type === "image" ? "image/*" : ".pdf,.doc,.docx,.xls,.xlsx"}
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;

                                  const formData = new FormData();
                                  formData.append("file", file);

                                  try {
                                    const response = await fetch("/api/media/upload", {
                                      method: "POST",
                                      headers: {
                                        "Authorization": `Bearer ${localStorage.getItem("sb-access-token") || ""}`
                                      },
                                      body: formData
                                    });
                                    const data = await response.json();
                                    if (data.success) {
                                      updateOption(option.id, "media_url", data.url);
                                    }
                                  } catch (err) {
                                    console.error("Upload failed:", err);
                                  }
                                }}
                              />
                              <Button 
                                type="button" 
                                variant="outline" 
                                size="icon" 
                                className="h-9 w-9 rounded-lg border-slate-100 text-slate-400 hover:text-emerald-600"
                                onClick={() => document.getElementById(`file-${option.id}`)?.click()}
                              >
                                <Upload className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                          
                          {option.media_url && (
                            <div className="flex items-center gap-2 p-2 bg-emerald-50 rounded-lg border border-emerald-100">
                              {option.response_type === "image" ? <Image className="w-3 h-3 text-emerald-600" /> : <FileText className="w-3 h-3 text-emerald-600" />}
                              <span className="text-[9px] text-emerald-700 font-medium truncate flex-1">{option.media_url.split('/').pop()}</span>
                              <Button variant="ghost" size="icon" className="h-5 w-5 text-emerald-600 hover:text-red-500" onClick={() => updateOption(option.id, "media_url", "")}>
                                <X className="w-3 h-3" />
                              </Button>
                            </div>
                          )}

                          {option.response_type === "image" && (
                            <textarea
                              value={option.response}
                              onChange={(e) => updateOption(option.id, "response", e.target.value)}
                              placeholder="Legenda da imagem (opcional)..."
                              className="w-full p-3 bg-slate-50 border-none rounded-xl text-xs focus:ring-1 focus:ring-emerald-500/20 outline-none min-h-[60px] resize-none"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4">
              <Button onClick={handleSave} className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-600/20 font-bold uppercase tracking-widest">
                <Save className="w-4 h-4 mr-2" />
                Salvar Menu
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Preview Side */}
      <div className="sticky top-24 h-fit">
        <div className="relative mx-auto w-[320px] h-[640px] bg-slate-900 rounded-[3rem] border-[8px] border-slate-800 shadow-2xl overflow-hidden">
          {/* Phone Notch */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-slate-800 rounded-b-2xl z-20" />
          
          {/* WhatsApp Header */}
          <div className="bg-[#075e54] p-6 pt-10 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-slate-200/20 flex items-center justify-center text-white">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div>
              <p className="text-white text-xs font-bold">Seu Bot WhatsApp</p>
              <p className="text-white/60 text-[10px]">online</p>
            </div>
          </div>

          {/* Chat Background */}
          <div className="absolute inset-0 top-24 bg-[#e5ddd5] overflow-y-auto p-4 space-y-4 custom-scrollbar">
            <div className="bg-white p-3 rounded-xl rounded-tl-none shadow-sm max-w-[85%] relative">
              <div className="absolute -left-2 top-0 w-0 h-0 border-t-[10px] border-t-white border-l-[10px] border-l-transparent" />
              
              <p className="text-sm whitespace-pre-wrap leading-relaxed text-slate-800">{body}</p>
              
              <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                {options.map((opt, i) => (
                  <p key={opt.id} className="text-sm text-slate-800 font-medium">
                    {numberEmojis[i + 1] || `${i + 1}️⃣`} {opt.label || "Opção sem nome"}
                  </p>
                ))}
              </div>

              {footer && (
                <p className="mt-3 text-[11px] text-slate-400 italic border-t border-slate-50 pt-2">
                  {footer}
                </p>
              )}

              <p className="text-[9px] text-slate-400 text-right mt-1">
                {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>

            {/* User Reply Example */}
            <div className="bg-[#dcf8c6] p-2 px-3 rounded-xl rounded-tr-none shadow-sm max-w-[40%] ml-auto relative">
              <div className="absolute -right-2 top-0 w-0 h-0 border-t-[10px] border-t-[#dcf8c6] border-r-[10px] border-r-transparent" />
              <p className="text-sm text-slate-800">1</p>
              <p className="text-[9px] text-slate-400 text-right mt-0.5">
                {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>

          {/* Bottom Input Bar */}
          <div className="absolute bottom-0 left-0 right-0 bg-white p-3 flex items-center gap-2">
            <div className="flex-1 h-10 bg-slate-50 rounded-full border border-slate-100 px-4 flex items-center">
              <p className="text-slate-300 text-xs">Mensagem</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-[#128c7e] flex items-center justify-center text-white shadow-md">
              <Smartphone className="w-5 h-5" />
            </div>
          </div>
        </div>
        
        <div className="mt-6 text-center">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Visualização em Tempo Real</p>
        </div>
      </div>
    </div>
  );
}
