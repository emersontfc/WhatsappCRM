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
  CheckCircle2,
  RefreshCw,
  Rocket
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
import { FlowBuilder, Node as FlowNode } from "../components/FlowBuilder";

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
  response_type?: "text" | "audio" | "buttons" | "list";
  buttons_json?: string;
  list_json?: string;
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
  const [recentMessages, setRecentMessages] = useState<any[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [showFlowBuilder, setShowFlowBuilder] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const responseTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [newAutomation, setNewAutomation] = useState<Partial<Automation>>({
    name: "",
    trigger: "keyword",
    keyword: "",
    response: "",
    active: true,
    delay: 2,
    media_type: "",
    response_type: "text",
    buttons_json: JSON.stringify({ text: "Como posso ajudar?", buttons: [] }),
    list_json: JSON.stringify({ 
      title: "Escolha uma opção", 
      description: "Selecione o serviço desejado abaixo:",
      footer: "Agentex Automation",
      buttonText: "Ver Opções",
      sections: [{ title: "Serviços", rows: [] }] 
    })
  });

  // WhatsApp Preview Component
  const WhatsAppPreview = ({ automation }: { automation: Partial<Automation> }) => {
    let buttons = null;
    try {
      buttons = automation.response_type === 'buttons' 
        ? JSON.parse(automation.buttons_json || '{"text": "Como posso ajudar?", "buttons": []}')
        : null;
    } catch (e) {
      buttons = { text: automation.response || "Erro no formato dos botões", buttons: [] };
    }
    
    let list = null;
    try {
      list = automation.response_type === 'list'
        ? JSON.parse(automation.list_json || '{"title": "Escolha uma opção", "buttonText": "Ver Opções", "sections": [{"rows": []}]}')
        : null;
    } catch (e) {
      list = { title: "Erro no formato da lista", buttonText: "Erro", sections: [] };
    }

    return (
      <div className="w-full max-w-[320px] mx-auto bg-[#E5DDD5] dark:bg-slate-950 rounded-[2.5rem] border-[8px] border-slate-900 dark:border-slate-800 aspect-[9/18] overflow-hidden shadow-2xl relative flex flex-col">
        {/* Phone Header */}
        <div className="bg-[#075E54] dark:bg-slate-900 p-4 pt-8 flex items-center gap-3 text-white">
          <div className="h-8 w-8 rounded-full bg-slate-200/20 flex items-center justify-center">
            <Users size={16} />
          </div>
          <div className="flex-1">
            <p className="text-xs font-bold">Seu Cliente</p>
            <p className="text-[10px] opacity-70">online</p>
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 p-3 space-y-4 overflow-y-auto custom-scrollbar bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat">
          {/* Incoming Message (Trigger) */}
          {automation.trigger === 'keyword' && automation.keyword && (
            <div className="flex justify-start">
              <div className="bg-white dark:bg-slate-800 p-2 rounded-lg rounded-tl-none shadow-sm max-w-[80%]">
                <p className="text-[11px] text-slate-900 dark:text-slate-100">{automation.keyword}</p>
                <p className="text-[9px] text-slate-400 text-right mt-1">10:00</p>
              </div>
            </div>
          )}

          {/* Outgoing Message (Response) */}
          <div className="flex justify-end animate-in fade-in slide-in-from-bottom-2 duration-500 delay-500">
            <div className="bg-[#DCF8C6] dark:bg-emerald-900/40 p-2 rounded-lg rounded-tr-none shadow-sm max-w-[85%] space-y-2">
              {automation.media_url && (
                <div className="rounded-md overflow-hidden bg-black/5 dark:bg-white/5 p-1">
                  {automation.media_type === 'image' ? (
                    <img src={automation.media_url} alt="Preview" className="w-full h-32 object-cover rounded" />
                  ) : (
                    <div className="flex items-center gap-2 p-2">
                      <FileText size={16} className="text-emerald-600" />
                      <span className="text-[10px] truncate">Documento anexo</span>
                    </div>
                  )}
                </div>
              )}

              {automation.response_type === 'buttons' && buttons ? (
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-900 dark:text-slate-100">{buttons.text}</p>
                  <div className="space-y-1">
                    {buttons.buttons.map((btn: any, i: number) => (
                      <div key={i} className="bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold py-2 px-3 rounded-md text-center shadow-sm border border-slate-100 dark:border-slate-700">
                        {btn.label || "Botão"}
                      </div>
                    ))}
                  </div>
                </div>
              ) : automation.response_type === 'list' && list ? (
                <div className="space-y-2">
                  <p className="text-[11px] font-bold text-slate-900 dark:text-slate-100">{list.title}</p>
                  <p className="text-[10px] text-slate-600 dark:text-slate-400">{list.description}</p>
                  <div className="bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold py-2 px-3 rounded-md text-center shadow-sm border border-slate-100 dark:border-slate-700 flex items-center justify-center gap-2">
                    <MessageSquare size={12} />
                    {list.buttonText || "Ver Opções"}
                  </div>
                  <p className="text-[8px] text-slate-400 italic">{list.footer}</p>
                </div>
              ) : (
                <p className="text-[11px] text-slate-900 dark:text-slate-100 whitespace-pre-wrap">
                  {automation.response || "Sua resposta aparecerá aqui..."}
                </p>
              )}
              <p className="text-[9px] text-slate-400 text-right">10:01</p>
            </div>
          </div>
        </div>

        {/* Chat Input */}
        <div className="p-2 bg-white dark:bg-slate-900 flex items-center gap-2">
          <div className="flex-1 bg-slate-100 dark:bg-slate-800 h-8 rounded-full px-3 flex items-center text-slate-400 text-[10px]">
            Mensagem
          </div>
          <div className="h-8 w-8 rounded-full bg-[#128C7E] flex items-center justify-center text-white">
            <Play size={14} fill="currentColor" />
          </div>
        </div>
      </div>
    );
  };

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
      buttons_json: auto.buttons_json || JSON.stringify({ text: "Como posso ajudar?", buttons: [] }),
      list_json: auto.list_json || JSON.stringify({ 
        title: "Escolha uma opção", 
        description: "Selecione o serviço desejado abaixo:",
        footer: "Agentex Automation",
        buttonText: "Ver Opções",
        sections: [{ title: "Serviços", rows: [] }] 
      })
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
      // Delete nodes and options first
      await supabase.from("nodes").delete().eq("automation_id", id);
      
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

  const handleSaveFlow = async (nodes: FlowNode[], name: string, keyword: string) => {
    try {
      const userId = await getUserId();
      if (!userId) throw new Error("Usuário não identificado.");

      let automation_id = editingId;

      if (!automation_id) {
        // Create automation first
        const { data: auto, error: autoError } = await supabase
          .from("automations")
          .insert({
            name: name || "Novo Fluxo",
            user_id: userId,
            active: true,
            trigger: "keyword",
            keyword: keyword || "fluxo",
            created_at: new Date().toISOString()
          })
          .select()
          .single();

        if (autoError) throw autoError;
        automation_id = auto.id;
      } else {
        // Update existing automation name and keyword
        await supabase
          .from("automations")
          .update({ name, keyword })
          .eq("id", automation_id);
      }

      // Save nodes and options
      // 1. Delete existing nodes (cascades to options if set up, otherwise delete options first)
      await supabase.from("nodes").delete().eq("automation_id", automation_id);

      // 2. Insert new nodes
      for (const node of nodes) {
        const { data: savedNode, error: nodeError } = await supabase
          .from("nodes")
          .insert({
            id: node.id,
            automation_id: automation_id,
            type: node.type,
            content: node.content,
            order_index: node.order_index
          })
          .select()
          .single();

        if (nodeError) throw nodeError;

        // 3. Insert options for this node
        if (node.options && node.options.length > 0) {
          const optionsToInsert = node.options.map(opt => ({
            id: opt.id,
            node_id: savedNode.id,
            label: opt.label,
            next_node_id: opt.next_node_id
          }));

          const { error: optError } = await supabase.from("options").insert(optionsToInsert);
          if (optError) throw optError;
        }
      }

      toast.success("Fluxo salvo com sucesso!");
      setShowFlowBuilder(false);
      setEditingId(null);
      // Refresh automations
      const { data: updatedAutomations } = await supabase
        .from("automations")
        .select("*")
        .eq("user_id", userId);
      if (updatedAutomations) setAutomations(updatedAutomations);
    } catch (err: any) {
      console.error("Error saving flow:", err);
      toast.error(err.message || "Erro ao salvar fluxo.");
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

  if (showFlowBuilder) {
    return (
      <div className="fixed inset-0 z-[100] bg-white dark:bg-slate-950 overflow-hidden">
        <FlowBuilder 
          automationId={editingId || "new"} 
          automationName={newAutomation.name || "Novo Fluxo"}
          automationKeyword={newAutomation.keyword || ""}
          onSave={handleSaveFlow}
          onCancel={() => setShowFlowBuilder(false)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Automações Inteligentes</h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Crie fluxos automáticos e menus interativos para seu atendimento.</p>
          {planDetails && automations.length >= (planDetails.automation_level === 'basic' ? 5 : 100) && (
            <div className="mt-4">
              <UpgradePrompt 
                title="Limite de Automações Atingido"
                description={`Você atingiu o limite de ${planDetails.automation_level === 'basic' ? 5 : 100} automações do seu plano.`} 
              />
            </div>
          )}
        </div>
        <Button 
          onClick={() => {
            setEditingId(null);
            setNewAutomation({ name: "" });
            setShowFlowBuilder(true);
          }} 
          className="gap-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl px-6 py-6 h-auto font-bold shadow-lg shadow-emerald-500/20 transition-all hover:scale-105 active:scale-95"
        >
          <Plus size={20} />
          Novo Fluxo (Chatbot)
        </Button>
      </div>

      {isAdding && !showFlowBuilder && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="lg:col-span-8">
            <Card className="border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-500/5 backdrop-blur-xl overflow-hidden relative">
              <div className="absolute top-0 right-0 p-4 opacity-5">
                <Zap size={120} />
              </div>
              <CardHeader className="pb-4">
                <CardTitle className="text-xl font-bold text-slate-900 dark:text-white">
                  {editingId ? "Editar Automação" : "Configurar Nova Automação"}
                </CardTitle>
                <CardDescription className="dark:text-slate-400">
                  {editingId ? "Atualize os dados da sua automação." : "Defina o gatilho e a resposta automática para seus clientes."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 relative z-10">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Nome da Automação</label>
                    <Input 
                      placeholder="Ex: Boas-vindas" 
                      value={newAutomation.name}
                      onChange={e => setNewAutomation({...newAutomation, name: e.target.value})}
                      className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-xl focus:ring-emerald-500/20"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Gatilho (Trigger)</label>
                    <select 
                      className="flex h-10 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/20 dark:text-white"
                      value={newAutomation.trigger}
                      onChange={e => setNewAutomation({...newAutomation, trigger: e.target.value as any})}
                    >
                      <option value="keyword">Palavra-chave (Keyword)</option>
                      <option value="new_contact">Novo Contato</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 flex items-center gap-1">
                      Delay (Segundos)
                      <div className="group relative">
                        <Info size={12} className="text-slate-400 cursor-help" />
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-48 p-3 bg-slate-900 text-white text-[10px] rounded-xl shadow-xl z-50 leading-relaxed">
                          Tempo de espera antes de enviar a resposta. Recomendado: 2-5s para parecer humano.
                        </div>
                      </div>
                    </label>
                    <Input 
                      type="number"
                      min="0"
                      max="60"
                      value={newAutomation.delay}
                      onChange={e => setNewAutomation({...newAutomation, delay: parseInt(e.target.value) || 0})}
                      className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-xl focus:ring-emerald-500/20"
                    />
                  </div>
                </div>

                {newAutomation.trigger === "keyword" && (
                  <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 flex items-center gap-1">
                      Palavra-chave
                      <div className="group relative">
                        <Info size={12} className="text-slate-400 cursor-help" />
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-48 p-3 bg-slate-900 text-white text-[10px] rounded-xl shadow-xl z-50 leading-relaxed">
                          O bot responderá se a mensagem contiver esta palavra. Não diferencia maiúsculas/minúsculas.
                        </div>
                      </div>
                    </label>
                    <Input 
                      placeholder="Ex: preco, ajuda, ola" 
                      value={newAutomation.keyword}
                      onChange={e => setNewAutomation({...newAutomation, keyword: e.target.value})}
                      className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-xl focus:ring-emerald-500/20"
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Tipo de Resposta</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { id: 'text', label: 'Texto', icon: MessageSquare },
                      { id: 'audio', label: 'Áudio', icon: Music },
                      { id: 'buttons', label: 'Botões', icon: Zap },
                      { id: 'list', label: 'Lista', icon: ChevronRight }
                    ].map((type) => (
                      <button
                        key={type.id}
                        onClick={() => setNewAutomation({...newAutomation, response_type: type.id as any})}
                        className={cn(
                          "flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border transition-all",
                          newAutomation.response_type === type.id 
                            ? "bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-500/20" 
                            : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-emerald-200 dark:hover:border-emerald-500/30"
                        )}
                      >
                        <type.icon size={20} />
                        <span className="text-xs font-bold">{type.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

            {newAutomation.response_type === "buttons" && (
              <div className="space-y-4 border border-slate-200 dark:border-slate-700 p-6 rounded-2xl bg-slate-50/50 dark:bg-slate-800/50 animate-in zoom-in-95">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Título do Menu</label>
                  <Input 
                    placeholder="Ex: Como posso ajudar hoje?" 
                    value={JSON.parse(newAutomation.buttons_json || '{"text": "Como posso ajudar?", "buttons": []}').text}
                    onChange={e => {
                      const current = JSON.parse(newAutomation.buttons_json || '{"text": "Como posso ajudar?", "buttons": []}');
                      setNewAutomation({...newAutomation, buttons_json: JSON.stringify({...current, text: e.target.value})});
                    }}
                    className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>
                
                <div className="space-y-3">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Botões (Máx 3)</label>
                  {JSON.parse(newAutomation.buttons_json || '{"text": "Como posso ajudar?", "buttons": []}').buttons.map((btn: any, index: number) => {
                    const slug = slugify(btn.label);
                    const automationExists = automations.some(a => a.trigger === 'keyword' && a.keyword === slug);
                    
                    return (
                      <div key={index} className="flex flex-col gap-3 p-4 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 shadow-sm group">
                        <div className="flex items-center justify-between gap-3">
                          <Input 
                            placeholder="Texto do Botão" 
                            value={btn.label}
                            onChange={e => {
                              const current = JSON.parse(newAutomation.buttons_json || '{"text": "Como posso ajudar?", "buttons": []}');
                              const newButtons = [...current.buttons];
                              newButtons[index].label = e.target.value;
                              newButtons[index].id = slugify(e.target.value);
                              setNewAutomation({...newAutomation, buttons_json: JSON.stringify({...current, buttons: newButtons})});
                            }}
                            className="bg-slate-50 dark:bg-slate-900 border-none rounded-lg"
                          />
                          <Button 
                            variant="ghost" 
                            size="icon"
                            className="shrink-0 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20" 
                            onClick={() => {
                              const current = JSON.parse(newAutomation.buttons_json || '{"text": "Como posso ajudar?", "buttons": []}');
                              const newButtons = current.buttons.filter((_: any, i: number) => i !== index);
                              setNewAutomation({...newAutomation, buttons_json: JSON.stringify({...current, buttons: newButtons})});
                            }}
                          >
                            <X size={18} />
                          </Button>
                        </div>
                        
                        <div className="flex items-center justify-between text-[10px]">
                          {automationExists ? (
                            <span className="flex items-center gap-1 text-emerald-500 font-bold uppercase tracking-wider">
                              <CheckCircle2 size={12} /> Fluxo Conectado
                            </span>
                          ) : (
                            <div className="flex items-center justify-between w-full">
                              <span className="flex items-center gap-1 text-amber-500 font-bold uppercase tracking-wider">
                                <AlertTriangle size={12} /> Sem Resposta
                              </span>
                              <button 
                                onClick={() => createResponseForButton(btn.label)}
                                className="text-emerald-500 hover:underline font-bold uppercase tracking-wider"
                              >
                                Configurar Resposta
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  
                  {JSON.parse(newAutomation.buttons_json || '{"text": "Como posso ajudar?", "buttons": []}').buttons.length < 3 && (
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        const current = JSON.parse(newAutomation.buttons_json || '{"text": "Como posso ajudar?", "buttons": []}');
                        setNewAutomation({...newAutomation, buttons_json: JSON.stringify({...current, buttons: [...current.buttons, {id: "", label: ""}]})});
                      }}
                      className="w-full border-dashed border-2 border-slate-200 dark:border-slate-700 text-slate-400 hover:text-emerald-500 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 rounded-xl py-6"
                    >
                      <Plus size={18} className="mr-2" />
                      Adicionar Botão
                    </Button>
                  )}
                </div>
              </div>
            )}

            {newAutomation.response_type === "list" && (
              <div className="space-y-4 border border-slate-200 dark:border-slate-700 p-6 rounded-2xl bg-slate-50/50 dark:bg-slate-800/50 animate-in zoom-in-95">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Título da Lista</label>
                    <Input 
                      placeholder="Ex: Nossos Serviços" 
                      value={JSON.parse(newAutomation.list_json || '{"title": "Escolha uma opção", "sections": []}').title}
                      onChange={e => {
                        const current = JSON.parse(newAutomation.list_json || '{"title": "Escolha uma opção", "sections": []}');
                        setNewAutomation({...newAutomation, list_json: JSON.stringify({...current, title: e.target.value})});
                      }}
                      className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Texto do Botão</label>
                    <Input 
                      placeholder="Ex: Ver Opções" 
                      value={JSON.parse(newAutomation.list_json || '{"buttonText": "Ver Opções", "sections": []}').buttonText}
                      onChange={e => {
                        const current = JSON.parse(newAutomation.list_json || '{"buttonText": "Ver Opções", "sections": []}');
                        setNewAutomation({...newAutomation, list_json: JSON.stringify({...current, buttonText: e.target.value})});
                      }}
                      className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-xl"
                    />
                  </div>
                </div>
                
                <div className="space-y-3">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Itens da Lista</label>
                  {JSON.parse(newAutomation.list_json || '{"sections": [{"rows": []}]}').sections[0].rows.map((row: any, index: number) => {
                    const slug = slugify(row.title);
                    const automationExists = automations.some(a => a.trigger === 'keyword' && a.keyword === slug);
                    
                    return (
                      <div key={index} className="flex flex-col gap-3 p-4 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 shadow-sm group">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex-1 space-y-2">
                            <Input 
                              placeholder="Título do Item" 
                              value={row.title}
                              onChange={e => {
                                const current = JSON.parse(newAutomation.list_json || '{"sections": [{"rows": []}]}');
                                const newRows = [...current.sections[0].rows];
                                newRows[index].title = e.target.value;
                                newRows[index].id = slugify(e.target.value);
                                current.sections[0].rows = newRows;
                                setNewAutomation({...newAutomation, list_json: JSON.stringify(current)});
                              }}
                              className="bg-slate-50 dark:bg-slate-900 border-none rounded-lg text-sm font-bold"
                            />
                            <Input 
                              placeholder="Descrição (Opcional)" 
                              value={row.description}
                              onChange={e => {
                                const current = JSON.parse(newAutomation.list_json || '{"sections": [{"rows": []}]}');
                                const newRows = [...current.sections[0].rows];
                                newRows[index].description = e.target.value;
                                current.sections[0].rows = newRows;
                                setNewAutomation({...newAutomation, list_json: JSON.stringify(current)});
                              }}
                              className="bg-slate-50 dark:bg-slate-900 border-none rounded-lg text-xs"
                            />
                          </div>
                          <Button 
                            variant="ghost" 
                            size="icon"
                            className="shrink-0 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20" 
                            onClick={() => {
                              const current = JSON.parse(newAutomation.list_json || '{"sections": [{"rows": []}]}');
                              const newRows = current.sections[0].rows.filter((_: any, i: number) => i !== index);
                              current.sections[0].rows = newRows;
                              setNewAutomation({...newAutomation, list_json: JSON.stringify(current)});
                            }}
                          >
                            <X size={18} />
                          </Button>
                        </div>
                        
                        <div className="flex items-center justify-between text-[10px]">
                          {automationExists ? (
                            <span className="flex items-center gap-1 text-emerald-500 font-bold uppercase tracking-wider">
                              <CheckCircle2 size={12} /> Fluxo Conectado
                            </span>
                          ) : (
                            <div className="flex items-center justify-between w-full">
                              <span className="flex items-center gap-1 text-amber-500 font-bold uppercase tracking-wider">
                                <AlertTriangle size={12} /> Sem Resposta
                              </span>
                              <button 
                                onClick={() => createResponseForButton(row.title)}
                                className="text-emerald-500 hover:underline font-bold uppercase tracking-wider"
                              >
                                Configurar Resposta
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  
                  {JSON.parse(newAutomation.list_json || '{"sections": [{"rows": []}]}').sections[0].rows.length < 10 && (
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        const current = JSON.parse(newAutomation.list_json || '{"sections": [{"rows": []}]}');
                        current.sections[0].rows.push({id: "", title: "", description: ""});
                        setNewAutomation({...newAutomation, list_json: JSON.stringify(current)});
                      }}
                      className="w-full border-dashed border-2 border-slate-200 dark:border-slate-700 text-slate-400 hover:text-emerald-500 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 rounded-xl py-6"
                    >
                      <Plus size={18} className="mr-2" />
                      Adicionar Item à Lista
                    </Button>
                  )}
                </div>
              </div>
            )}

            {(newAutomation.response_type === "text" || newAutomation.response_type === "audio") && (
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Resposta Automática</label>
                <textarea 
                  className="flex min-h-[120px] w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/20 dark:text-white resize-none"
                  placeholder="Digite a mensagem que será enviada..."
                  value={newAutomation.response}
                  onChange={e => setNewAutomation({...newAutomation, response: e.target.value})}
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Anexo (Opcional)</label>
              <div className="flex flex-wrap items-center gap-4">
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
                  className="gap-2 rounded-xl border-slate-200 dark:border-slate-700 dark:text-slate-300"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingMedia}
                >
                  {uploadingMedia ? (
                    <RefreshCw size={16} className="animate-spin" />
                  ) : (
                    <Paperclip size={16} />
                  )}
                  {uploadingMedia ? "Enviando..." : "Anexar Mídia"}
                </Button>

                {newAutomation.media_url && (
                  <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl text-sm border border-emerald-500/20 animate-in fade-in zoom-in-95">
                    {newAutomation.media_type === 'image' && <ImageIcon size={16} />}
                    {newAutomation.media_type === 'audio' && <Music size={16} />}
                    {newAutomation.media_type === 'document' && <FileText size={16} />}
                    <span className="font-medium">Mídia anexada</span>
                    <button 
                      type="button"
                      onClick={() => setNewAutomation(prev => ({ ...prev, media_url: "", media_type: "" }))}
                      className="ml-2 hover:text-red-500 transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
              </div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">Suporta imagens, áudios e PDFs (Máx 10MB).</p>
            </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                  <Button variant="ghost" onClick={cancelEdit} className="rounded-xl dark:text-slate-400">Cancelar</Button>
                  <Button 
                    onClick={handleAdd}
                    className="bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl px-8 font-bold"
                  >
                    {editingId ? "Atualizar Automação" : "Salvar Automação"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-4 sticky top-24">
            <div className="space-y-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 text-center">Pré-visualização WhatsApp</p>
              <WhatsAppPreview automation={newAutomation} />
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        {automations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 md:py-32 bg-white dark:bg-slate-900 rounded-3xl md:rounded-[3rem] border border-dashed border-slate-200 dark:border-slate-800 text-slate-400 space-y-6">
            <div className="w-20 h-20 md:w-24 md:h-24 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center">
              <Zap strokeWidth={1} className="size-10 md:size-12 text-slate-200 dark:text-slate-700" />
            </div>
            <div className="text-center space-y-2 px-4">
              <p className="text-lg md:text-xl font-bold text-slate-900 dark:text-white">Nenhuma automação ativa</p>
              <p className="text-sm md:text-base text-slate-500 dark:text-slate-400 max-w-xs mx-auto">Comece criando sua primeira resposta automática para otimizar seu tempo.</p>
            </div>
            <Button 
              variant="outline" 
              onClick={() => setIsAdding(true)}
              className="rounded-2xl px-8 py-6 h-auto font-bold border-slate-200 dark:border-slate-700 dark:text-slate-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 hover:border-emerald-200"
            >
              Criar Agora
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {automations.map((auto) => (
              <Card key={auto.id} className={cn(
                "group transition-all duration-500 hover:scale-[1.02] hover:shadow-xl hover:shadow-emerald-500/5",
                !auto.active && "opacity-60 grayscale-[0.5]"
              )}>
                <CardContent className="p-5 md:p-8">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className={cn(
                        "h-12 w-12 md:h-14 md:w-14 rounded-2xl flex items-center justify-center shrink-0 transition-colors duration-500",
                        auto.active ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20" : "bg-slate-100 dark:bg-slate-800 text-slate-400"
                      )}>
                        <Zap className="size-6 md:size-7" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-base md:text-lg font-bold text-slate-900 dark:text-white truncate">{auto.name}</h3>
                        <div className="flex flex-wrap items-center gap-2 md:gap-3 mt-1">
                          <span className="flex items-center gap-1 text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                            {auto.trigger === "keyword" ? <MessageSquare className="size-2.5 md:size-3" /> : <Users className="size-2.5 md:size-3" />}
                            {auto.trigger === "keyword" ? `"${auto.keyword}"` : "Novo Contato"}
                          </span>
                          <span className="text-slate-200 dark:text-slate-800 hidden md:inline">•</span>
                          <span className="flex items-center gap-1 text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                            <Clock className="size-2.5 md:size-3" />
                            {auto.delay || 0}s
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-all duration-300 self-end sm:self-start">
                      <Button 
                        variant="ghost" 
                        size="icon"
                        className="text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 rounded-xl h-10 w-10"
                        onClick={() => {
                          handleEdit(auto);
                          setShowFlowBuilder(true);
                        }}
                      >
                        <Settings2 size={20} />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon"
                        className={cn("rounded-xl h-10 w-10", auto.active ? "text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/20" : "text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/20")}
                        onClick={() => toggleActive(auto.id, auto.active)}
                      >
                        {auto.active ? <Pause size={20} /> : <Play size={20} />}
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon"
                        className="text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-xl h-10 w-10"
                        onClick={() => handleDelete(auto.id)}
                      >
                        <Trash2 size={20} />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-6 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800/50 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500/20" />
                    <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] mb-2">Resposta Automática</p>
                    <p className="text-sm text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed">
                      {auto.response_type === 'buttons' ? 'Menu de Botões Interativo' : 
                       auto.response_type === 'list' ? 'Menu de Lista Interativo' : 
                       auto.response}
                    </p>
                    
                    {auto.media_url && (
                      <div className="mt-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 w-fit px-3 py-1.5 rounded-lg border border-emerald-500/10">
                        {auto.media_type === 'image' && <ImageIcon size={12} />}
                        {auto.media_type === 'audio' && <Music size={12} />}
                        {auto.media_type === 'document' && <FileText size={12} />}
                        <span>Mídia Anexada</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Card className="bg-slate-900 dark:bg-emerald-950 text-white border-none overflow-hidden relative shadow-2xl rounded-3xl md:rounded-[3rem]">
        <div className="absolute top-0 right-0 p-6 md:p-12 opacity-10 rotate-12">
          <Zap className="size-[120px] md:size-[180px]" />
        </div>
        <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 via-blue-500 to-purple-500" />
        <CardContent className="p-8 md:p-12 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-12 items-center">
            <div className="space-y-6">
              <div className="flex items-center gap-3 text-emerald-400">
                <div className="h-10 w-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                  <AlertCircle size={20} />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-[0.3em]">Dica de Especialista</span>
              </div>
              <div className="space-y-4">
                <h3 className="text-2xl md:text-4xl font-bold tracking-tight leading-tight">Potencialize seu atendimento 24/7</h3>
                <p className="text-slate-400 text-base md:text-lg leading-relaxed">
                  Use automações inteligentes para responder perguntas frequentes instantaneamente. Isso economiza tempo e garante que seu cliente nunca fique sem resposta.
                </p>
              </div>
              <div className="flex flex-wrap gap-4 pt-4">
                <Button className="flex-1 md:flex-none bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl px-8 py-6 h-auto font-bold shadow-lg shadow-emerald-500/20 transition-all">
                  Ver Exemplos
                </Button>
                <Button variant="ghost" className="flex-1 md:flex-none text-white hover:bg-white/10 rounded-2xl px-8 py-6 h-auto font-bold">
                  Docs
                </Button>
              </div>
            </div>
            <div className="hidden lg:grid grid-cols-2 gap-4">
              {[
                { label: 'Taxa de Resposta', value: '100%', icon: CheckCircle2 },
                { label: 'Tempo Economizado', value: '12h/dia', icon: Clock },
                { label: 'Satisfação', value: '4.9/5', icon: Zap },
                { label: 'Conversão', value: '+35%', icon: Rocket }
              ].map((stat, i) => (
                <div key={i} className="p-6 bg-white/5 backdrop-blur-lg border border-white/10 rounded-3xl space-y-2">
                  <stat.icon size={24} className="text-emerald-400 mb-2" />
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
