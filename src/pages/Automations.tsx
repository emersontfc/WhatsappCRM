import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { 
  Zap, 
  Plus, 
  Play, 
  Pause, 
  Trash2, 
  MessageSquare, 
  Clock, 
  Users,
  ChevronRight,
  Settings2,
  AlertCircle,
  Info,
  Paperclip,
  Image as ImageIcon,
  FileText,
  Music,
  X,
  AlertTriangle,
  CheckCircle2
} from "lucide-react";
import { toast } from "sonner";
import { supabase, getUserId, getUser, isAdmin as checkIsAdmin } from "../supabase";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/Card";
import { cn, slugify } from "../lib/utils";
import { useActivation } from "../lib/useActivation";
import { useSubscription } from "../lib/useSubscription";
import { UpgradePrompt } from "../components/UpgradePrompt";

interface Automation {
  id: string;
  name: string;
  trigger: "keyword" | "new_contact" | "scheduled";
  keyword?: string;
  response: string;
  active: boolean;
  delay?: number; // Delay in seconds
  created_at: string;
  media_url?: string;
  media_type?: string;
  response_type?: "text" | "audio" | "buttons";
  buttons_json?: string;
}

export default function Automations() {
  const navigate = useNavigate();
  const { isActivated, planDetails, loading: activationLoading } = useActivation();
  const { subscription, loading: subLoading } = useSubscription();
  const [loading, setLoading] = useState(true);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const responseTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [newAutomation, setNewAutomation] = useState<Partial<Automation>>({
    name: "",
    trigger: "keyword",
    keyword: "",
    response: "",
    active: true,
    delay: 2,
    media_url: "",
    media_type: "",
    response_type: "text",
    buttons_json: JSON.stringify({ text: "", buttons: [] })
  });

  const createResponseForButton = (label: string) => {
    const slug = slugify(label);
    setNewAutomation({
      name: `Resposta para: ${label}`,
      trigger: "keyword",
      keyword: slug,
      response: "",
      active: true,
      delay: 2,
      response_type: "text",
    });
    setIsAdding(true);
    setEditingId(null);
    setTimeout(() => responseTextareaRef.current?.focus(), 100);
  };

  useEffect(() => {
    if (activationLoading) return;
    const init = async () => {
      const userId = await getUserId();
      if (!userId) {
        setLoading(false);
        return;
      }

      // Initial automations fetch
      const { data: initialAutomations } = await supabase
        .from("automations")
        .select("*")
        .eq("user_id", userId);
      
      if (initialAutomations) {
        setAutomations(initialAutomations);
      }

      // Real-time automations subscription
      const channel = supabase
        .channel(`automations-${userId}`)
        .on('postgres_changes', { 
          event: '*', 
          schema: 'public', 
          table: 'automations',
          filter: `user_id=eq.${userId}`
        }, (payload) => {
          console.log("Realtime update:", payload);
          if (payload.eventType === 'INSERT') {
            setAutomations(prev => [...prev, payload.new as Automation]);
          } else if (payload.eventType === 'UPDATE') {
            setAutomations(prev => prev.map(a => a.id === payload.new.id ? payload.new as Automation : a));
          } else if (payload.eventType === 'DELETE') {
            setAutomations(prev => prev.filter(a => a.id !== payload.old.id));
          }
        })
        .subscribe();

      setLoading(false);

      return () => {
        supabase.removeChannel(channel);
      };
    };
    init();
  }, [activationLoading]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error("O arquivo deve ter no máximo 10MB.");
      return;
    }

    setUploadingMedia(true);
    try {
      const userId = await getUserId();
      if (!userId) throw new Error("Usuário não identificado.");

      const fileExt = file.name.split('.').pop();
      const fileName = `${userId}/${Date.now()}.${fileExt}`;

      const { data, error } = await supabase.storage
        .from('media')
        .upload(fileName, file);

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from('media')
        .getPublicUrl(fileName);

      let mediaType = "document";
      if (file.type.startsWith("image/")) mediaType = "image";
      else if (file.type.startsWith("audio/")) mediaType = "audio";
      else if (file.type.startsWith("video/")) mediaType = "video";

      setNewAutomation(prev => ({
        ...prev,
        media_url: publicUrl,
        media_type: mediaType
      }));

      toast.success("Mídia anexada com sucesso!");
    } catch (err: any) {
      console.error("Upload error:", err);
      toast.error(err.message || "Erro ao fazer upload da mídia.");
    } finally {
      setUploadingMedia(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleAdd = async () => {
    const maxAutomations = planDetails?.automation_level === 'basic' ? 5 : 100;
    if (automations.length >= maxAutomations) {
      toast.error("Limite de automações atingido!");
      return;
    }
    
    if (!newAutomation.name || (!newAutomation.response && newAutomation.response_type !== 'buttons')) {
      toast.error("Preencha o nome e a resposta.");
      return;
    }
    
    try {
      const userId = await getUserId();
      if (!userId) throw new Error("Usuário não identificado.");
      
      if (editingId) {
        const { data, error } = await supabase
          .from("automations")
          .update({
            ...newAutomation,
            user_id: userId,
          })
          .eq("id", editingId)
          .select()
          .single();

        if (error) throw error;

        setAutomations(prev => prev.map(a => a.id === editingId ? data : a));
        toast.success("Automação atualizada com sucesso!");
      } else {
        const { data, error } = await supabase.from("automations").insert({
          ...newAutomation,
          user_id: userId,
          created_at: new Date().toISOString()
        }).select().single();

        if (error) throw error;

        if (data) {
          setAutomations(prev => [...prev, data]);
        }
        toast.success("Automação criada com sucesso!");
      }

      setIsAdding(false);
      setEditingId(null);
      setNewAutomation({
        name: "",
        trigger: "keyword",
        keyword: "",
        response: "",
        active: true,
        delay: 2,
        media_url: "",
        media_type: ""
      });
    } catch (err: any) {
      console.error("Error saving automation:", err);
      toast.error(err.message || "Erro ao salvar automação.");
    }
  };

  const handleEdit = (auto: Automation) => {
    setNewAutomation({
      name: auto.name,
      trigger: auto.trigger,
      keyword: auto.keyword,
      response: auto.response,
      active: auto.active,
      delay: auto.delay,
      media_url: auto.media_url,
      media_type: auto.media_type,
      response_type: auto.response_type || "text",
      buttons_json: auto.buttons_json || JSON.stringify({ text: "", buttons: [] })
    });
    setEditingId(auto.id);
    setIsAdding(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEdit = () => {
    setIsAdding(false);
    setEditingId(null);
    setNewAutomation({
      name: "",
      trigger: "keyword",
      keyword: "",
      response: "",
      active: true,
      delay: 2,
      media_url: "",
      media_type: ""
    });
  };

  const toggleActive = async (id: string, current: boolean) => {
    // Optimistic update
    setAutomations(prev => prev.map(a => a.id === id ? { ...a, active: !current } : a));
    
    try {
      const { error } = await supabase
        .from("automations")
        .update({ active: !current })
        .eq("id", id);
      if (error) throw error;
      toast.success(`Automação ${!current ? 'ativada' : 'desativada'}.`);
    } catch (err) {
      console.error("Failed to toggle automation:", err);
      // Rollback
      setAutomations(prev => prev.map(a => a.id === id ? { ...a, active: current } : a));
      toast.error("Erro ao alterar status da automação.");
    }
  };

  const handleDelete = async (id: string) => {
    // Optimistic update
    const original = [...automations];
    setAutomations(prev => prev.filter(a => a.id !== id));

    try {
      const { error } = await supabase
        .from("automations")
        .delete()
        .eq("id", id);
      if (error) throw error;
      toast.success("Automação excluída.");
    } catch (err) {
      console.error("Failed to delete automation:", err);
      // Rollback
      setAutomations(original);
      toast.error("Erro ao excluir automação.");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
      </div>
    );
  }

  if (!isActivated) {
    return (
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Automações</h2>
            <p className="text-slate-500">Crie fluxos automáticos para responder seus clientes.</p>
          </div>
        </div>

        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="py-12 text-center space-y-4">
            <Zap size={48} className="mx-auto text-amber-400" />
            <h3 className="text-xl font-bold text-amber-900">Conta não Ativada</h3>
            <p className="text-amber-700 max-w-md mx-auto">
              Você precisa ativar sua conta com um código de licença para usar as automações.
            </p>
            <Button onClick={() => navigate("/activate")} className="bg-amber-600 hover:bg-amber-700">
              Ativar Agora
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Automações</h2>
          <p className="text-slate-500">Crie fluxos automáticos para responder seus clientes.</p>
          {planDetails && automations.length >= (planDetails.automation_level === 'basic' ? 5 : 100) && (
            <UpgradePrompt message={`Você atingiu o limite de ${planDetails.automation_level === 'basic' ? 5 : 100} automações do seu plano.`} />
          )}
        </div>
        <Button onClick={() => setIsAdding(true)} className="gap-2">
          <Plus size={18} />
          Nova Automação
        </Button>
      </div>

      {isAdding && (
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardHeader>
            <CardTitle className="text-lg">{editingId ? "Editar Automação" : "Configurar Nova Automação"}</CardTitle>
            <CardDescription>{editingId ? "Atualize os dados da sua automação." : "Defina o gatilho e a resposta automática."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-500">Nome da Automação</label>
                <Input 
                  placeholder="Ex: Boas-vindas" 
                  value={newAutomation.name}
                  onChange={e => setNewAutomation({...newAutomation, name: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-500">Gatilho (Trigger)</label>
                <select 
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                  value={newAutomation.trigger}
                  onChange={e => setNewAutomation({...newAutomation, trigger: e.target.value as any})}
                >
                  <option value="keyword">Palavra-chave (Keyword)</option>
                  <option value="new_contact">Novo Contato</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-500 flex items-center gap-1">
                  Delay (Segundos)
                  <div className="group relative">
                    <Info size={12} className="text-slate-400 cursor-help" />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-48 p-2 bg-slate-800 text-white text-[10px] rounded shadow-lg z-50">
                      Tempo de espera antes de enviar a resposta (evita bloqueios).
                    </div>
                  </div>
                </label>
                <Input 
                  type="number"
                  min="0"
                  max="60"
                  value={newAutomation.delay}
                  onChange={e => setNewAutomation({...newAutomation, delay: parseInt(e.target.value) || 0})}
                />
              </div>
            </div>

            {newAutomation.trigger === "keyword" && (
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-500 flex items-center gap-1">
                  Palavra-chave
                  <div className="group relative">
                    <Info size={12} className="text-slate-400 cursor-help" />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-48 p-2 bg-slate-800 text-white text-[10px] rounded shadow-lg z-50">
                      O bot responderá se a mensagem contiver esta palavra (Fuzzy Matching).
                    </div>
                  </div>
                </label>
                <Input 
                  placeholder="Ex: preco, ajuda, ola" 
                  value={newAutomation.keyword}
                  onChange={e => setNewAutomation({...newAutomation, keyword: e.target.value})}
                />
                <p className="text-[10px] text-slate-500 italic">A automação será ativada quando o cliente enviar uma mensagem que contenha esta palavra.</p>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-slate-500">Tipo de Resposta</label>
              <select 
                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                value={newAutomation.response_type || "text"}
                onChange={e => setNewAutomation({...newAutomation, response_type: e.target.value as any})}
              >
                <option value="text">Texto</option>
                <option value="audio">Áudio</option>
                <option value="buttons">Menu de Botões</option>
              </select>
            </div>

            {newAutomation.response_type === "buttons" ? (
              <div className="space-y-4 border p-4 rounded-lg bg-slate-50">
                <Input 
                  placeholder="Título do Menu (Ex: Como posso ajudar?)" 
                  value={JSON.parse(newAutomation.buttons_json || '{"text": "", "buttons": []}').text}
                  onChange={e => {
                    const current = JSON.parse(newAutomation.buttons_json || '{"text": "", "buttons": []}');
                    setNewAutomation({...newAutomation, buttons_json: JSON.stringify({...current, text: e.target.value})});
                  }}
                />
                {JSON.parse(newAutomation.buttons_json || '{"text": "", "buttons": []}').buttons.map((btn: any, index: number) => {
                  const slug = slugify(btn.label);
                  const automationExists = automations.some(a => a.trigger === 'keyword' && a.keyword === slug);
                  
                  return (
                    <div key={index} className="flex flex-col gap-2 p-3 border rounded-lg bg-white">
                      <div className="flex items-center justify-between">
                        <Input 
                          placeholder="Label do Botão" 
                          value={btn.label}
                          onChange={e => {
                            const current = JSON.parse(newAutomation.buttons_json || '{"text": "", "buttons": []}');
                            const newButtons = [...current.buttons];
                            newButtons[index].label = e.target.value;
                            newButtons[index].id = slugify(e.target.value);
                            setNewAutomation({...newAutomation, buttons_json: JSON.stringify({...current, buttons: newButtons})});
                          }}
                        />
                        <Button variant="ghost" className="shrink-0" onClick={() => {
                            const current = JSON.parse(newAutomation.buttons_json || '{"text": "", "buttons": []}');
                            const newButtons = current.buttons.filter((_: any, i: number) => i !== index);
                            setNewAutomation({...newAutomation, buttons_json: JSON.stringify({...current, buttons: newButtons})});
                        }}>
                          <X size={16} />
                        </Button>
                      </div>
                      
                      <div className="flex items-center gap-2 text-xs">
                        {automationExists ? (
                          <span className="flex items-center gap-1 text-emerald-600 font-medium">
                            <CheckCircle2 size={14} /> Configurado
                          </span>
                        ) : (
                          <div className="flex flex-col gap-1 w-full">
                            <span className="flex items-center gap-1 text-red-600 font-medium">
                              <AlertTriangle size={14} /> Sem resposta
                            </span>
                            <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => createResponseForButton(btn.label)}>
                              Criar resposta para este botão
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {JSON.parse(newAutomation.buttons_json || '{"text": "", "buttons": []}').buttons.length < 3 && (
                  <Button variant="outline" onClick={() => {
                    const current = JSON.parse(newAutomation.buttons_json || '{"text": "", "buttons": []}');
                    setNewAutomation({...newAutomation, buttons_json: JSON.stringify({...current, buttons: [...current.buttons, {id: "", label: ""}]})});
                  }}>
                    Adicionar Botão
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-500">Resposta Automática</label>
                <textarea 
                  className="flex min-h-[100px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                  placeholder="Digite a mensagem que será enviada..."
                  value={newAutomation.response}
                  onChange={e => setNewAutomation({...newAutomation, response: e.target.value})}
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-slate-500">Anexo (Opcional)</label>
              <div className="flex items-center gap-4">
                <input 
                  type="file" 
                  ref={fileInputRef}
                  className="hidden" 
                  accept="image/*,audio/*,application/pdf"
                  onChange={handleFileUpload}
                />
                <Button 
                  type="button" 
                  variant="outline" 
                  className="gap-2"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingMedia}
                >
                  {uploadingMedia ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent"></div>
                  ) : (
                    <Paperclip size={16} />
                  )}
                  {uploadingMedia ? "Enviando..." : "Anexar Mídia"}
                </Button>

                {newAutomation.media_url && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-md text-sm border border-emerald-200">
                    {newAutomation.media_type === 'image' && <ImageIcon size={14} />}
                    {newAutomation.media_type === 'audio' && <Music size={14} />}
                    {newAutomation.media_type === 'document' && <FileText size={14} />}
                    <span className="truncate max-w-[200px]">Mídia anexada</span>
                    <button 
                      type="button"
                      onClick={() => setNewAutomation(prev => ({ ...prev, media_url: "", media_type: "" }))}
                      className="ml-2 text-emerald-600 hover:text-emerald-800"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>
              <p className="text-[10px] text-slate-500 italic">Suporta imagens, áudios e PDFs (Máx 10MB).</p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="ghost" onClick={cancelEdit}>Cancelar</Button>
              <Button onClick={handleAdd}>{editingId ? "Atualizar Automação" : "Salvar Automação"}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4">
        {automations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl border border-dashed border-slate-200 text-slate-400 space-y-4">
            <Zap size={48} strokeWidth={1} />
            <div className="text-center">
              <p className="font-medium">Nenhuma automação criada</p>
              <p className="text-sm">Comece criando sua primeira resposta automática.</p>
            </div>
            <Button variant="outline" onClick={() => setIsAdding(true)}>Criar Agora</Button>
          </div>
        ) : (
          automations.map((auto) => (
            <Card key={auto.id} className={cn("transition-all", !auto.active && "opacity-60 grayscale-[0.5]")}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={cn(
                      "h-12 w-12 rounded-2xl flex items-center justify-center shrink-0",
                      auto.active ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-400"
                    )}>
                      <Zap size={24} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-slate-900 truncate">{auto.name}</h3>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          {auto.trigger === "keyword" ? <MessageSquare size={12} /> : <Users size={12} />}
                          {auto.trigger === "keyword" ? `Gatilho: "${auto.keyword}"` : "Gatilho: Novo Contato"}
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Clock size={12} />
                          Delay: {auto.delay || 0}s
                        </span>
                        <span>•</span>
                        <span>Criado em {new Date(auto.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button 
                      variant="ghost" 
                      size="icon"
                      className="text-slate-500 hover:bg-slate-50"
                      onClick={() => handleEdit(auto)}
                    >
                      <Settings2 size={18} />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      className={cn(auto.active ? "text-amber-600 hover:bg-amber-50" : "text-emerald-600 hover:bg-emerald-50")}
                      onClick={() => toggleActive(auto.id, auto.active)}
                    >
                      {auto.active ? <Pause size={18} /> : <Play size={18} />}
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      className="text-red-500 hover:bg-red-50"
                      onClick={() => handleDelete(auto.id)}
                    >
                      <Trash2 size={18} />
                    </Button>
                  </div>
                </div>
                <div className="mt-4 p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Resposta:</p>
                  <p className="text-sm text-slate-600 line-clamp-2 italic">"{auto.response}"</p>
                  
                  {auto.media_url && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 w-fit px-2 py-1 rounded-md border border-emerald-100">
                      {auto.media_type === 'image' && <ImageIcon size={12} />}
                      {auto.media_type === 'audio' && <Music size={12} />}
                      {auto.media_type === 'document' && <FileText size={12} />}
                      <span>Mídia Anexada</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Card className="bg-slate-900 text-white border-none overflow-hidden relative">
        <div className="absolute top-0 right-0 p-8 opacity-10">
          <Zap size={120} />
        </div>
        <CardContent className="p-8 relative z-10 space-y-4">
          <div className="flex items-center gap-2 text-emerald-400">
            <AlertCircle size={20} />
            <span className="text-sm font-bold uppercase tracking-widest">Dica Pro</span>
          </div>
          <h3 className="text-xl font-bold">Potencialize seu atendimento</h3>
          <p className="text-slate-400 text-sm max-w-xl">
            Use automações para responder perguntas frequentes instantaneamente. Isso economiza tempo e garante que seu cliente nunca fique sem resposta, mesmo fora do horário comercial.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
