import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { VoiceRecorder } from "../components/VoiceRecorder";
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
  Rocket,
  Mic,
  Hash
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
  media_mimetype?: string;
  media_filename?: string;
  response_type?: "text" | "audio" | "menu";
  smart_menu_id?: string;
}

export default function Automations() {
  const navigate = useNavigate();
  const { isActivated, planDetails, loading: activationLoading } = useActivation();
  const { subscription, loading: subLoading } = useSubscription();
  const [loading, setLoading] = useState(true);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [menus, setMenus] = useState<any[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [recentMessages, setRecentMessages] = useState<any[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
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
    smart_menu_id: ""
  });

  // WhatsApp Preview Component
  const WhatsAppPreview = ({ automation }: { automation: Partial<Automation> }) => {
    const selectedMenu = menus.find(m => m.id === automation.smart_menu_id);
    
    return (
      <div className="w-full max-w-[320px] mx-auto bg-[#E5DDD5] rounded-[2.5rem] border-[8px] border-slate-900 aspect-[9/18] overflow-hidden shadow-2xl relative flex flex-col">
        {/* Phone Header */}
        <div className="bg-[#075E54] p-4 pt-8 flex items-center gap-3 text-white">
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
              <div className="bg-white p-2 rounded-lg rounded-tl-none shadow-sm max-w-[80%]">
                <p className="text-[11px] text-slate-900">{automation.keyword}</p>
                <p className="text-[9px] text-slate-400 text-right mt-1">10:00</p>
              </div>
            </div>
          )}

          {/* Outgoing Message (Response) */}
          <div className="flex justify-end animate-in fade-in slide-in-from-bottom-2 duration-500 delay-500">
            <div className="bg-[#DCF8C6] p-2 rounded-lg rounded-tr-none shadow-sm max-w-[85%] space-y-2">
              {automation.media_url && (
                <div className="rounded-md overflow-hidden bg-black/5 p-1">
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

              {automation.response_type === 'menu' && selectedMenu ? (
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-900 font-bold">{selectedMenu.message}</p>
                  <div className="space-y-1">
                    {selectedMenu.options?.map((opt: any, i: number) => (
                      <p key={i} className="text-[10px] text-slate-700">
                        {["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"][i + 1] || `${i + 1}️⃣`} {opt.label}
                      </p>
                    ))}
                  </div>
                  {selectedMenu.footer && (
                    <p className="text-[9px] text-slate-400 italic border-t border-emerald-100 pt-1 mt-1">
                      {selectedMenu.footer}
                    </p>
                  )}
                </div>
              ) : automation.response_type === 'audio' ? (
                <div className="flex items-center gap-2 bg-white/20 p-2 rounded-lg">
                  <Mic size={16} className="text-emerald-600" />
                  <div className="h-1 flex-1 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 w-1/3"></div>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-slate-900 whitespace-pre-wrap">
                  {automation.response || "Sua resposta aparecerá aqui..."}
                </p>
              )}
              <p className="text-[9px] text-slate-400 text-right">10:01</p>
            </div>
          </div>
        </div>

        {/* Chat Input */}
        <div className="p-2 bg-white flex items-center gap-2">
          <div className="flex-1 bg-slate-100 h-8 rounded-full px-3 flex items-center text-slate-400 text-[10px]">
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

      // Fetch smart menus
      const { data: initialMenus } = await supabase
        .from("smart_menus")
        .select("*")
        .eq("user_id", userId)
        .eq("active", true);
      
      if (initialMenus) {
        setMenus(initialMenus);
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
        media_type: mediaType,
        media_mimetype: file.type,
        media_filename: file.name
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
    
    if (!newAutomation.name || (!newAutomation.response && newAutomation.response_type === 'text')) {
      if (newAutomation.response_type === 'menu' && !newAutomation.smart_menu_id) {
        toast.error("Selecione um menu inteligente.");
        return;
      }
      if (newAutomation.response_type === 'text') {
        toast.error("Preencha o nome e a resposta.");
        return;
      }
    }
    
    try {
      const userId = await getUserId();
      if (!userId) throw new Error("Usuário não identificado.");
      
      const payload = {
        ...newAutomation,
        user_id: userId,
      };

      if (editingId) {
        const { data, error } = await supabase
          .from("automations")
          .update(payload)
          .eq("id", editingId)
          .select()
          .single();

        if (error) throw error;

        setAutomations(prev => prev.map(a => a.id === editingId ? data : a));
        toast.success("Automação atualizada com sucesso!");
      } else {
        const { data, error } = await supabase.from("automations").insert({
          ...payload,
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
        media_type: "",
        response_type: "text",
        smart_menu_id: ""
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
      smart_menu_id: auto.smart_menu_id || ""
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
      media_type: "",
      response_type: "text",
      smart_menu_id: ""
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
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Automações Inteligentes</h2>
          <p className="text-slate-500 mt-1">Crie fluxos automáticos e menus interativos para seu atendimento.</p>
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
            setNewAutomation({
              name: "",
              trigger: "keyword",
              keyword: "",
              response: "",
              active: true,
              delay: 2,
              media_url: "",
              media_type: "",
              response_type: "text"
            });
            setIsAdding(true);
          }} 
          className="gap-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl px-6 py-6 h-auto font-bold shadow-lg shadow-emerald-500/20 transition-all hover:scale-105 active:scale-95"
        >
          <Plus size={20} />
          Nova Automação
        </Button>
      </div>

      {isAdding && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="lg:col-span-8">
            <Card className="border-emerald-200 bg-emerald-50/30 backdrop-blur-xl overflow-hidden relative">
              <div className="absolute top-0 right-0 p-4 opacity-5">
                <Zap size={120} />
              </div>
              <CardHeader className="pb-4">
                <CardTitle className="text-xl font-bold text-slate-900">
                  {editingId ? "Editar Automação" : "Configurar Nova Automação"}
                </CardTitle>
                <CardDescription>
                  {editingId ? "Atualize os dados da sua automação." : "Defina o gatilho e a resposta automática para seus clientes."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 relative z-10">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Nome da Automação</label>
                    <Input 
                      placeholder="Ex: Boas-vindas" 
                      value={newAutomation.name}
                      onChange={e => setNewAutomation({...newAutomation, name: e.target.value})}
                      className="bg-white border-slate-200 rounded-xl focus:ring-emerald-500/20"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Gatilho (Trigger)</label>
                    <select 
                      className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/20"
                      value={newAutomation.trigger}
                      onChange={e => setNewAutomation({...newAutomation, trigger: e.target.value as any})}
                    >
                      <option value="keyword">Palavra-chave (Keyword)</option>
                      <option value="new_contact">Novo Contato</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
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
                      className="bg-white border-slate-200 rounded-xl focus:ring-emerald-500/20"
                    />
                  </div>
                </div>

                {newAutomation.trigger === "keyword" && (
                  <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
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
                      className="bg-white border-slate-200 rounded-xl focus:ring-emerald-500/20"
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tipo de Resposta</label>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { id: 'text', label: 'Texto', icon: MessageSquare },
                      { id: 'audio', label: 'Áudio', icon: Music },
                      { id: 'menu', label: 'Menu Inteligente', icon: Hash }
                    ].map((type) => (
                      <button
                        type="button"
                        key={type.id}
                        onClick={() => setNewAutomation({...newAutomation, response_type: type.id as any})}
                        className={cn(
                          "flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border transition-all",
                          newAutomation.response_type === type.id 
                            ? "bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-500/20" 
                            : "bg-white border-slate-200 text-slate-500 hover:border-emerald-200"
                        )}
                      >
                        <type.icon size={20} />
                        <span className="text-xs font-bold">{type.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {newAutomation.response_type === "menu" && (
                  <div className="space-y-2 animate-in zoom-in-95">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Selecionar Menu Inteligente</label>
                    <select 
                      className="flex h-12 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/20"
                      value={newAutomation.smart_menu_id}
                      onChange={e => setNewAutomation({...newAutomation, smart_menu_id: e.target.value})}
                    >
                      <option value="">Selecione um menu...</option>
                      {menus.map(menu => (
                        <option key={menu.id} value={menu.id}>{menu.name}</option>
                      ))}
                    </select>
                    {menus.length === 0 && (
                      <p className="text-[10px] text-amber-600 font-medium">Você ainda não criou nenhum menu inteligente. <button onClick={() => navigate('/menu-builder')} className="underline">Criar agora</button></p>
                    )}
                  </div>
                )}

            {(newAutomation.response_type === "text" || newAutomation.response_type === "audio") && (
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Resposta Automática</label>
                <textarea 
                  className="flex min-h-[120px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/20 resize-none"
                  placeholder="Digite a mensagem que será enviada..."
                  value={newAutomation.response}
                  onChange={e => setNewAutomation({...newAutomation, response: e.target.value})}
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Anexo (Opcional)</label>
              <div className="flex flex-wrap items-center gap-4">
                <input 
                  type="file" 
                  ref={fileInputRef}
                  className="hidden" 
                  accept="image/*,audio/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip"
                  onChange={handleFileUpload}
                />
                <Button 
                  type="button" 
                  variant="outline" 
                  className="gap-2 rounded-xl border-slate-200"
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

                <Button 
                  type="button" 
                  variant="outline" 
                  className="gap-2 rounded-xl border-slate-200"
                  onClick={() => setIsRecording(!isRecording)}
                  disabled={uploadingMedia}
                >
                  <Mic size={16} />
                  {isRecording ? "Cancelar Áudio" : "Gravar Áudio"}
                </Button>

                {isRecording && (
                  <div className="w-full mt-4">
                    <VoiceRecorder 
                      onSend={(url) => {
                        setNewAutomation(prev => ({ ...prev, media_url: url, media_type: "audio", media_mimetype: "audio/ogg", media_filename: "audio.ogg" }));
                        setIsRecording(false);
                      }} 
                      onCancel={() => setIsRecording(false)} 
                    />
                  </div>
                )}

                {newAutomation.media_url && !isRecording && (
                  <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 text-emerald-600 rounded-xl text-sm border border-emerald-500/20 animate-in fade-in zoom-in-95">
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
              <p className="text-[10px] text-slate-400 italic">Suporta imagens, áudios e PDFs (Máx 10MB).</p>
            </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                  <Button variant="ghost" onClick={cancelEdit} className="rounded-xl">Cancelar</Button>
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
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 text-center">Pré-visualização WhatsApp</p>
              <WhatsAppPreview automation={newAutomation} />
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        {automations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 md:py-32 bg-white rounded-3xl md:rounded-[3rem] border border-dashed border-slate-200 text-slate-400 space-y-6">
            <div className="w-20 h-20 md:w-24 md:h-24 bg-slate-50 rounded-full flex items-center justify-center">
              <Zap strokeWidth={1} className="size-10 md:size-12 text-slate-200" />
            </div>
            <div className="text-center space-y-2 px-4">
              <p className="text-lg md:text-xl font-bold text-slate-900">Nenhuma automação ativa</p>
              <p className="text-sm md:text-base text-slate-500 max-w-xs mx-auto">Comece criando sua primeira resposta automática para otimizar seu tempo.</p>
            </div>
            <Button 
              variant="outline" 
              onClick={() => setIsAdding(true)}
              className="rounded-2xl px-8 py-6 h-auto font-bold border-slate-200 hover:bg-emerald-50 hover:border-emerald-200"
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
                        auto.active ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20" : "bg-slate-100 text-slate-400"
                      )}>
                        <Zap className="size-6 md:size-7" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-base md:text-lg font-bold text-slate-900 truncate">{auto.name}</h3>
                        <div className="flex flex-wrap items-center gap-2 md:gap-3 mt-1">
                          <span className="flex items-center gap-1 text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            {auto.trigger === "keyword" ? <MessageSquare className="size-2.5 md:size-3" /> : <Users className="size-2.5 md:size-3" />}
                            {auto.trigger === "keyword" ? `"${auto.keyword}"` : "Novo Contato"}
                          </span>
                          <span className="text-slate-200 hidden md:inline">•</span>
                          <span className="flex items-center gap-1 text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-slate-400">
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
                        className="text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-xl h-10 w-10"
                        onClick={() => {
                          handleEdit(auto);
                        }}
                      >
                        <Settings2 size={20} />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon"
                        className={cn("rounded-xl h-10 w-10", auto.active ? "text-amber-500 hover:bg-amber-50" : "text-emerald-500 hover:bg-emerald-50")}
                        onClick={() => toggleActive(auto.id, auto.active)}
                      >
                        {auto.active ? <Pause size={20} /> : <Play size={20} />}
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon"
                        className="text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl h-10 w-10"
                        onClick={() => handleDelete(auto.id)}
                      >
                        <Trash2 size={20} />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-6 p-4 bg-slate-50 rounded-2xl border border-slate-100 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500/20" />
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-2">Resposta Automática</p>
                    <p className="text-sm text-slate-600 line-clamp-2 leading-relaxed">
                      {auto.response}
                    </p>
                    
                    {auto.media_url && (
                      <div className="mt-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-500/5 w-fit px-3 py-1.5 rounded-lg border border-emerald-500/10">
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

      <Card className="bg-slate-900 text-white border-none overflow-hidden relative shadow-2xl rounded-3xl md:rounded-[3rem]">
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
