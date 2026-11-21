import { WhatsAppOperatorCard } from "../components/WhatsAppOperatorCard";
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { 
  Calendar as CalendarIcon, 
  Clock, 
  Send, 
  Trash2, 
  Paperclip,
  Image as ImageIcon,
  FileText,
  Music,
  X,
  User,
  Users,
  AlertCircle,
  Upload,
  Settings2,
  Mic,
  Sparkles,
  Smartphone
} from "lucide-react";
import { VoiceRecorder } from "../components/VoiceRecorder";
import { StatusPreview } from "../components/StatusPreview";
import { toast } from "sonner";
import { supabase, getUserId, isAdmin as checkIsAdmin } from "../supabase";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/Card";
import { cn } from "../lib/utils";
import { useActivation } from "../lib/useActivation";
import { apiFetch } from "../lib/api";
import { UpgradePrompt } from "../components/UpgradePrompt";

interface ScheduledMessage {
  id: string;
  contact_id: string;
  contact_name: string;
  message: string;
  media_url?: string;
  media_type?: string;
  media_mimetype?: string;
  media_filename?: string;
  scheduled_at: string;
  status: "pending" | "processing" | "sent" | "failed";
  error?: string | null;
  repeat_days?: number;
  target_type?: "contact" | "status" | "group";
  group_jid?: string;
  group_name?: string;
  created_at: string;
}

interface Contact {
  id: string;
  name: string;
  phone: string;
  tags: string[];
}

export default function Schedule() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ScheduledMessage[]>([]);
  const [groups, setGroups] = useState<Array<{ id: string; subject: string }>>([]);
  const [groupError, setGroupError] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [agendaError, setAgendaError] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const { isActivated, planDetails, plan, loading: activationLoading } = useActivation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  
  // Helper to format Date for input[type=datetime-local] using local clock
  const formatForDateTimeInput = (d: Date) => {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // Helper to parse input[type=datetime-local] string as local Date
  const parseDateTimeInput = (str: string) => {
    const [dPart, tPart] = (str || "").split('T');
    if (!dPart || !tPart) return new Date(str);
    const [y, m, d] = dPart.split('-').map(Number);
    const [hh, mm] = tPart.split(':').map(Number);
    return new Date(y, m - 1, d, hh, mm, 0, 0);
  };

  const [newMessage, setNewMessage] = useState<Partial<ScheduledMessage>>({
    contact_id: "",
    contact_name: "",
    message: "",
    media_url: "",
    media_type: "",
    target_type: "contact",
    scheduled_at: formatForDateTimeInput(new Date(Date.now() + 15 * 60 * 1000))
  });

  useEffect(() => {
    if (!isAdding || newMessage.target_type !== "group") return;
    let active = true;
    setGroupError(false);
    apiFetch("/api/whatsapp/groups").then(({ success, groups }) => {
      if (!success) throw new Error("Grupos indisponíveis");
      if (active) setGroups(groups ?? []);
    }).catch(() => { if (active) setGroupError(true); });
    return () => { active = false; };
  }, [isAdding, newMessage.target_type]);

  const [refreshVersion, setRefreshVersion] = useState(0);
  const refreshAgenda = () => setRefreshVersion((value) => value + 1);

  useEffect(() => {
    if (activationLoading) return;
    let active = true;
    let busy = false;
    let channel: ReturnType<typeof supabase.channel> | undefined;
    let poll: number | undefined;
    let removeVisibilityListener: (() => void) | undefined;

    const init = async () => {
      const userId = await getUserId();
      if (!active) return;
      if (!userId || userId === "guest-user") { setLoading(false); return; }
      const refresh = async () => {
        if (!active || busy || document.hidden) return;
        busy = true;
        try {
          const [contactsResult, messagesResult, statusResult] = await Promise.all([
            supabase.from("contacts").select("id,name,phone,tags").eq("user_id", userId).order("name"),
            supabase.from("scheduled_messages").select("*").eq("user_id", userId).order("scheduled_at"),
            supabase.from("scheduled_status").select("*").eq("user_id", userId).order("scheduled_at")
          ]);
          if (!active) return;
          if (contactsResult.error || messagesResult.error || statusResult.error) throw new Error("Agenda indisponível.");
          const nextContacts = contactsResult.data.map((contact) => ({ ...contact, tags: Array.isArray(contact.tags) ? contact.tags : [] }));
          const names = new Map(nextContacts.map((contact) => [contact.id, contact.name || contact.phone]));
          setAgendaError(false);
          setContacts(nextContacts);
          setMessages([
            ...messagesResult.data.map((item) => ({ ...item, contact_name: names.get(item.contact_id) ?? item.contact_name ?? "Contacto" })),
            ...statusResult.data.map((item) => ({ ...item, target_type: "status", message: item.caption, contact_name: "WhatsApp Status", contact_id: "status" }))
          ].sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at)));
        } finally {
          busy = false;
          if (active) setLoading(false);
        }
      };
      const sync = () => { void refresh().catch(() => { if (active) setAgendaError(true); }); };
      channel = supabase.channel(`agenda-${userId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "scheduled_messages", filter: `user_id=eq.${userId}` }, sync)
        .on("postgres_changes", { event: "*", schema: "public", table: "scheduled_status", filter: `user_id=eq.${userId}` }, sync)
        .subscribe();
      poll = window.setInterval(sync, 10000);
      document.addEventListener("visibilitychange", sync);
      removeVisibilityListener = () => document.removeEventListener("visibilitychange", sync);
      sync();
    };
    void init().catch(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      window.clearInterval(poll);
      removeVisibilityListener?.();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [activationLoading, refreshVersion]);

  const handleImportCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const csv = event.target?.result as string;
        const lines = csv.split('\n');
        const userId = await getUserId();
        
        let importedCount = 0;
        const contactsToInsert = [];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          const parts = line.split(',');
          if (parts.length >= 2) {
            const name = parts[0].trim();
            let phone = parts[1].replace(/\D/g, "");
            
            // Default country code for imports if not present (Mozambique: 9 digits)
            if (phone.length <= 10 && !phone.startsWith("258")) {
              phone = "258" + phone;
            }
            
            if (name && phone) {
              contactsToInsert.push({
                user_id: userId,
                name,
                phone,
                tags: ["Importado"],
                created_at: new Date().toISOString(),
              });
              importedCount++;
            }
          }
        }

        if (contactsToInsert.length > 0) {
          if (planDetails && contacts.length + contactsToInsert.length > planDetails.max_contacts) {
            toast.error(`Limite de contatos atingido (${planDetails.max_contacts}). Você pode importar no máximo ${planDetails.max_contacts - contacts.length} contatos.`);
            return;
          }

          let successCount = 0;
          for (const contact of contactsToInsert) {
            try {
              const { data: existing } = await supabase
                .from("contacts")
                .select("id, tags")
                .eq("user_id", userId)
                .eq("phone", contact.phone)
                .maybeSingle();

              if (existing) {
                const currentTags = Array.isArray(existing.tags) ? existing.tags : [];
                const mergedTags = Array.from(new Set([...currentTags, "Importado"]));
                await supabase
                  .from("contacts")
                  .update({ name: contact.name, tags: mergedTags })
                  .eq("id", existing.id);
              } else {
                await supabase.from("contacts").insert(contact);
              }
              successCount++;
            } catch (err) {
              console.error("Error processing contact in CSV:", err);
            }
          }
          toast.success(`${successCount} contatos processados com sucesso!`);
          
          // Manual refresh as fallback for real-time
          const { data: refreshedContacts } = await supabase
            .from("contacts")
            .select("*")
            .eq("user_id", userId);
          
          if (refreshedContacts) {
            const manualContacts = refreshedContacts
              .map(c => ({ ...c, tags: Array.isArray(c.tags) ? c.tags : [] }))
              .filter(c => {
                const tags = c.tags;
                return tags.includes("Manual") || tags.includes("Importado");
              });
            setContacts(manualContacts);
          }
        } else {
          toast.error("Nenhum contato válido encontrado no CSV. Use o formato: Nome, Telefone");
        }
      } catch (err) {
        console.error("Error importing contacts:", err);
        toast.error("Erro ao importar contatos.");
      }
      
      if (csvInputRef.current) {
        csvInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      toast.error("O arquivo deve ter no máximo 10MB.");
      return;
    }

    setUploadingMedia(true);
    try {
      if (file.type.startsWith("audio/") || /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i.test(file.name)) {
        if (newMessage.target_type === "status") throw new Error("O Status aceita texto, imagem ou vídeo.");
        const body = new FormData();
        body.append("audio", file);
        const result = await apiFetch("/api/media/upload-audio", { method: "POST", body });
        if (!result.success || !result.url) throw new Error("Não foi possível preparar o áudio.");
        setNewMessage((previous) => ({ ...previous, media_url: result.url, media_type: "audio", media_filename: file.name }));
        toast.success("Áudio anexado");
        return;
      }

      const userId = await getUserId();
      if (!userId) throw new Error("Usuário não identificado.");

      const fileExt = file.name.split('.').pop();
      const fileName = `${userId}/${Date.now()}.${fileExt}`;

      const { error } = await supabase.storage
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

      setNewMessage(prev => ({
        ...prev,
        media_url: publicUrl,
        media_type: mediaType,
        media_filename: file.name,
        media_mimetype: file.type || (mediaType === "document" ? "application/pdf" : undefined)
      }));

      toast.success(mediaType === "document" ? "Documento/Fatura anexada com sucesso!" : "Mídia anexada com sucesso!");
    } catch (err: any) {
      console.error("Upload error:", err);
      toast.error(err.message || "Erro ao fazer upload do arquivo.");
    } finally {
      setUploadingMedia(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleAdd = async (publishNow = false) => {
    if (savingSchedule || uploadingMedia) return;
    if (newMessage.target_type === 'contact' && (!newMessage.contact_id || (!newMessage.media_url && !newMessage.message?.trim()))) {
      toast.error("Seleciona um contacto e adiciona texto ou um ficheiro.");
      return;
    }

    if (newMessage.target_type === "group" && (!newMessage.group_jid || !newMessage.message?.trim() || newMessage.media_url)) {
      toast.error("Seleciona um grupo e escreve o anúncio de texto.");
      return;
    }

    if (newMessage.target_type === 'status' && !newMessage.media_url && !newMessage.message?.trim()) {
      toast.error("Informe um texto ou selecione uma mídia para o Status.");
      return;
    }

    if (newMessage.media_type === "audio" && newMessage.message?.trim()) {
      toast.error("Agenda a nota de voz e a mensagem de texto separadamente.");
      return;
    }
    if (newMessage.target_type === "status" && newMessage.media_type && !["image", "video"].includes(newMessage.media_type)) {
      toast.error("O Status aceita texto, imagem ou vídeo.");
      return;
    }

    if (!publishNow && !newMessage.scheduled_at) {
      toast.error("Selecione a data e hora do agendamento.");
      return;
    }

    const scheduledDate = publishNow ? new Date() : parseDateTimeInput(newMessage.scheduled_at!);
    if (isNaN(scheduledDate.getTime())) {
      toast.error("Data ou hora inválida.");
      return;
    }

    // Allow scheduling even if within current minute with a 2-minute buffer
    if (scheduledDate.getTime() < Date.now() - 2 * 60 * 1000) {
      toast.error("A data/hora de agendamento não pode estar no passado.");
      return;
    }

    // Story Limits: Videos max 30s
    if (newMessage.target_type === 'status' && newMessage.media_type === 'video') {
      toast.info("Lembrete: O WhatsApp limita vídeos no Status a 30 segundos.");
    }
    
    setSavingSchedule(true);
    try {
      const userId = await getUserId();
      if (!userId) throw new Error("Usuário não identificado.");

      if (newMessage.target_type === 'status') {
        const statusPayload: any = {
          user_id: userId,
          media_url: newMessage.media_url || null,
          media_type: newMessage.media_type || (newMessage.media_url ? "image" : null),
          caption: newMessage.message || "",
          scheduled_at: scheduledDate.toISOString(),
          status: "pending",
          repeat_days: newMessage.repeat_days ?? 0,
          repeat_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          repeat_anchor_at: scheduledDate.toISOString()
        };

        if (editingId) {
          const { error } = await supabase
            .from("scheduled_status")
            .update(statusPayload)
            .eq("id", editingId).eq("user_id", userId).eq("status", "pending").select("id").single();
          if (error) throw error;
          toast.success("Status atualizado!");
        } else {
          const { data, error } = await supabase.from("scheduled_status").insert(statusPayload).select("id").single();
          if (error) throw error;
          if (publishNow) {
            try {
              await apiFetch("/api/whatsapp/send-scheduled", {
                method: "POST", body: JSON.stringify({ id: data.id, type: "status" })
              });
              toast.success("Publicação aceite pelo WhatsApp.");
            } catch {
              toast.info("Status guardado. Confirma o estado na agenda.");
            }
          } else {
            toast.success("Status agendado.");
          }
        }
      } else {
        // Normal message / invoice scheduling
        const messagePayload: any = {
          user_id: userId,
          contact_id: newMessage.target_type === "group" ? null : newMessage.contact_id,
          group_jid: newMessage.target_type === "group" ? newMessage.group_jid : null,
          group_name: newMessage.target_type === "group" ? groups.find((group) => group.id === newMessage.group_jid)?.subject ?? newMessage.group_name : null,
          message: newMessage.message || "",
          media_url: newMessage.media_url || null,
          media_type: newMessage.media_type || null,
          media_mimetype: newMessage.media_mimetype || null,
          media_filename: newMessage.media_filename || null,
          target_type: newMessage.target_type === "group" ? "group" : "contact",
          status: "pending",
          scheduled_at: scheduledDate.toISOString(),
          repeat_days: newMessage.target_type === "group" ? newMessage.repeat_days ?? 0 : 0,
          repeat_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          repeat_anchor_at: scheduledDate.toISOString()
        };

        if (editingId) {
          const { error } = await supabase
            .from("scheduled_messages")
            .update(messagePayload)
            .eq("id", editingId).eq("user_id", userId).eq("status", "pending").select("id").single();
          if (error) throw error;
          toast.success("Agendamento atualizado!");
        } else {
          const { error } = await supabase
            .from("scheduled_messages")
            .insert(messagePayload);
          if (error) throw error;
          toast.success("Mensagem/Fatura agendada com sucesso!");
        }
      }

      refreshAgenda();
      setIsAdding(false);
      setEditingId(null);
      setNewMessage({
        contact_id: "",
        contact_name: "",
        message: "",
        media_url: "",
        media_type: "",
        media_mimetype: "",
        media_filename: "",
        target_type: "contact",
        scheduled_at: formatForDateTimeInput(new Date(Date.now() + 15 * 60 * 1000))
      });
    } catch (err: any) {
      console.error("Error saving scheduled message:", err);
      toast.error(err.message || "Erro ao salvar agendamento.");
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleSendNow = async (msg: ScheduledMessage) => {
    try {
      toast.loading("Enviando agora...", { id: `send-${msg.id}` });
      const response = await apiFetch(`/api/whatsapp/send-scheduled`, {
        method: "POST",
        body: JSON.stringify({ id: msg.id, type: msg.target_type || 'contact' })
      });

      if (response.success) {
        toast.success("Enviado com sucesso!", { id: `send-${msg.id}` });
        setMessages((items) => items.map((item) => item.id === msg.id ? { ...item, status: "sent" } : item));
      } else {
        throw new Error(response.error || "Falha ao enviar");
      }
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`, { id: `send-${msg.id}` });
    } finally {
      refreshAgenda();
    }
  };

  const handleEdit = (msg: ScheduledMessage) => {
    if (msg.status !== 'pending') {
      toast.error("Apenas agendamentos pendentes podem ser editados.");
      return;
    }

    setNewMessage({
      contact_id: msg.contact_id === "status" ? "" : msg.contact_id,
      contact_name: msg.contact_name,
      message: msg.message || (msg as any).text || "",
      media_url: msg.media_url,
      media_type: msg.media_type,
      media_filename: msg.media_filename,
      media_mimetype: msg.media_mimetype,
      repeat_days: msg.repeat_days,
      group_jid: msg.group_jid,
      group_name: msg.group_name,
      target_type: msg.target_type || "contact",
      scheduled_at: formatForDateTimeInput(new Date(msg.scheduled_at))
    });
    setEditingId(msg.id);
    setIsAdding(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEdit = () => {
    setIsAdding(false);
    setEditingId(null);
    setNewMessage({
      contact_id: "",
      contact_name: "",
      message: "",
      media_url: "",
      media_type: "",
      target_type: "contact",
      scheduled_at: formatForDateTimeInput(new Date(Date.now() + 15 * 60 * 1000))
    });
  };

  const handleDelete = async (id: string, targetType?: string) => {
    const original = [...messages];
    setMessages(prev => prev.filter(m => m.id !== id));

    try {
      const table = targetType === 'status' ? "scheduled_status" : "scheduled_messages";
      const { error } = await supabase
        .from(table)
        .delete()
        .eq("id", id).neq("status", "processing").select("id").single();
      if (error) throw error;
      refreshAgenda();
      toast.success("Agendamento excluído.");
    } catch (err) {
      console.error("Failed to delete scheduled item:", err);
      setMessages(original);
      toast.error("Erro ao excluir agendamento.");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
      </div>
    );
  }

  if (!isActivated || plan === "Free") {
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="py-12 text-center space-y-4">
            <CalendarIcon size={48} className="mx-auto text-amber-400" />
            <h3 className="text-xl font-bold text-amber-900">Recurso Indisponível</h3>
            <p className="text-amber-700 max-w-md mx-auto">
              O agendamento de mensagens não está disponível no plano gratuito. Faça um upgrade para utilizar este recurso.
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
    <div className="space-y-8">
      <WhatsAppOperatorCard agendaLink={false} />
      {agendaError && <p className="text-sm text-red-700" role="status">Não foi possível atualizar a agenda. A lista será consultada novamente.</p>}
      {planDetails && contacts.length >= planDetails.max_contacts && (
        <UpgradePrompt 
          title="Limite de Contatos Atingido"
          description={`Você atingiu o limite de ${planDetails.max_contacts} contatos do seu plano atual. Você não poderá importar novos contatos.`}
        />
      )}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Agendamentos</h2>
          <div className="flex items-center gap-2 text-slate-500">
            <p>Programe mensagens para serem enviadas no futuro.</p>
            <span className="h-1 w-1 rounded-full bg-slate-300" />
            <div className="flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
              <Clock size={12} />
              {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </div>
          </div>
        </div>
        <div className="flex w-full sm:w-auto gap-2">
          <input 
            type="file" 
            accept=".csv" 
            className="hidden" 
            ref={csvInputRef}
            onChange={handleImportCSV}
          />
          <Button 
            variant="outline"
            className="flex-1 sm:flex-none gap-2" 
            onClick={() => isActivated ? csvInputRef.current?.click() : toast.error("Ative sua conta para importar contatos.")}
            disabled={!isActivated}
          >
            <Upload size={18} />
            Importar Contatos
          </Button>
          <Button 
            className="flex-1 sm:flex-none gap-2" 
            onClick={() => isActivated ? setIsAdding(true) : toast.error("Ative sua conta para agendar mensagens.")}
            disabled={!isActivated}
          >
            <CalendarIcon size={18} />
            Novo Agendamento
          </Button>
        </div>
      </div>

      {isAdding && (
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardHeader>
            <CardTitle className="text-lg">{editingId ? "Editar Agendamento" : "Agendar Mensagem"}</CardTitle>
            <CardDescription>{editingId ? "Atualize os dados do seu agendamento." : "Escolha o contato, a data e a mensagem a ser enviada."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col lg:flex-row gap-8">
              <div className="flex-1 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-500">Destino do Agendamento</label>
                  <div className="flex flex-wrap gap-2">
                    <button 
                      disabled={Boolean(editingId && newMessage.target_type === 'status')}
                      onClick={() => setNewMessage({...newMessage, target_type: 'contact'})}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all",
                        newMessage.target_type === 'contact' 
                          ? "border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm" 
                          : "border-slate-100 bg-white text-slate-500 hover:border-slate-200"
                      )}
                    >
                      <User size={18} />
                      <span className="font-bold text-sm">Contato Direto</span>
                    </button>
                    <button 
                      disabled={Boolean(editingId && newMessage.target_type !== 'status')}
                      onClick={() => setNewMessage({...newMessage, target_type: 'status', contact_id: ""})}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all",
                        newMessage.target_type === 'status' 
                          ? "border-purple-500 bg-purple-50 text-purple-700 shadow-sm" 
                          : "border-slate-100 bg-white text-slate-500 hover:border-slate-200"
                      )}
                    >
                      <Sparkles size={18} />
                      <span className="font-bold text-sm">Status (Stories)</span>
                    </button>
                    <button type="button" disabled={Boolean(editingId && newMessage.target_type === "status")}
                      onClick={() => { setIsRecording(false); setNewMessage((previous) => ({ ...previous, target_type: "group",
                        media_url: "", media_type: "", media_filename: "", media_mimetype: "" })); }}
                      className={cn("flex flex-1 items-center justify-center gap-2 rounded-xl border-2 p-3",
                        newMessage.target_type === "group" ? "border-emerald-500 bg-emerald-50" : "border-slate-100 bg-white")}>
                      <Users size={18} />
                      <span className="text-sm font-bold">Anúncio de grupo</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {newMessage.target_type === 'contact' && (
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase text-slate-500">Selecionar Contato</label>
                      <select 
                        className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                        value={newMessage.contact_id}
                        onChange={e => setNewMessage({...newMessage, contact_id: e.target.value})}
                      >
                        <option value="">Selecione um contato...</option>
                        {contacts.map(c => (
                          <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {newMessage.target_type === "group" && (
                    <label className="grid gap-1 text-sm">Grupo do WhatsApp
                      <select className="h-10 rounded-md border border-slate-200 px-3" value={newMessage.group_jid ?? ""}
                        onChange={(event) => setNewMessage((previous) => ({ ...previous, group_jid: event.target.value }))}>
                        <option value="">Seleciona um grupo</option>
                        {groups.map((group) => <option key={group.id} value={group.id}>{group.subject}</option>)}
                      </select>
                      {groupError && <span role="status">Liga o WhatsApp para carregar os grupos.</span>}
                    </label>
                  )}
                  <div className={cn("space-y-2", newMessage.target_type === 'status' && "md:col-span-2")}>
                    <label className="text-xs font-bold uppercase text-slate-500">Data e Hora de Postagem</label>
                    <Input 
                      type="datetime-local"
                      value={newMessage.scheduled_at}
                      onChange={e => setNewMessage({...newMessage, scheduled_at: e.target.value})}
                    />
                  </div>
                </div>

                {newMessage.target_type !== "contact" && (
                  <label className="grid gap-1 text-sm">
                    Repetir publicação
                    <select className="h-10 rounded-md border border-slate-200 px-3"
                      value={newMessage.repeat_days ?? 0}
                      onChange={(event) => setNewMessage((previous) => ({ ...previous, repeat_days: Number(event.target.value) }))}>
                      <option value={0}>Uma vez</option>
                      <option value={1}>Todos os dias</option>
                      <option value={7}>Todas as semanas</option>
                    </select>
                    {Boolean(newMessage.repeat_days) && <span className="text-xs text-slate-600">
                      A próxima publicação é criada após o envio. Para parar, elimina a próxima publicação pendente.
                    </span>}
                  </label>
                )}

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-500">Legenda / Mensagem</label>
                  {isRecording ? (
                    <VoiceRecorder actionLabel="Anexar gravação"
                      onSend={(url) => {
                        setNewMessage(prev => ({ ...prev, media_url: url, media_type: "audio", media_filename: "nota-de-voz.ogg" }));
                        setIsRecording(false);
                      }} 
                      onCancel={() => setIsRecording(false)} 
                    />
                  ) : (
                    <textarea 
                      className="flex min-h-[100px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                      placeholder={newMessage.target_type === 'status' ? "Digite a legenda do seu status..." : "Digite a mensagem que será enviada..."}
                      value={newMessage.message}
                      onChange={e => setNewMessage({...newMessage, message: e.target.value})}
                    />
                  )}
                </div>

                {newMessage.target_type !== "group" && (
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-500">
                    Arquivo de Mídia {newMessage.target_type === 'status' ? "(Opcional se houver texto)" : "(Opcional: PDF/Fatura, Imagem, Áudio)"}
                  </label>
                  <div className="flex items-center gap-4 flex-wrap">
                    <input 
                      type="file" 
                      ref={fileInputRef}
                      className="hidden" 
                      accept={newMessage.target_type === 'status' ? "image/*,video/*" : "image/*,video/*,audio/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx"}
                      onChange={handleFileUpload}
                    />
                    <Button 
                      type="button" 
                      variant="outline" 
                      className="gap-2"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingMedia || isRecording}
                    >
                      {uploadingMedia ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent"></div>
                      ) : (
                        <Paperclip size={16} />
                      )}
                      {uploadingMedia ? "Enviando..." : "Anexar Arquivo / Fatura"}
                    </Button>

                    {newMessage.target_type === 'contact' && (
                      <Button 
                        type="button" 
                        variant="outline" 
                        className="gap-2"
                        onClick={() => setIsRecording(!isRecording)}
                        disabled={uploadingMedia}
                      >
                        <Mic size={16} />
                        {isRecording ? "Cancelar Áudio" : "Gravar Áudio"}
                      </Button>
                    )}

                    {newMessage.media_url && (
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-md text-sm border border-emerald-200">
                        {newMessage.media_type === 'image' && <ImageIcon size={14} />}
                        {newMessage.media_type === 'video' && <Smartphone size={14} />}
                        {newMessage.media_type === 'audio' && <Music size={14} />}
                        {newMessage.media_type === 'document' && <FileText size={14} />}
                        <span className="truncate max-w-[220px] font-medium" title={newMessage.media_filename || ""}>
                          {newMessage.media_filename || (newMessage.media_type === 'document' ? "Fatura/Documento pronto" : "Arquivo pronto")}
                        </span>
                        <button 
                          type="button"
                          onClick={() => setNewMessage(prev => ({ ...prev, media_url: "", media_type: "", media_filename: "", media_mimetype: "" }))}
                          className="p-1 hover:bg-emerald-100 rounded-full transition-colors cursor-pointer"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                  {newMessage.media_type === "audio" && newMessage.media_url &&
                    <audio controls preload="metadata" src={newMessage.media_url} className="w-full max-w-sm" aria-label="Pré-visualizar nota de voz" />}
                  {newMessage.target_type === 'status' && newMessage.media_type === 'video' && (
                    <p className="text-[10px] text-amber-600 font-medium flex items-center gap-1 mt-1">
                      <AlertCircle size={10} /> O WhatsApp corta vídeos no status em 30 segundos.
                    </p>
                  )}
                </div>
                )}
              </div>

              {/* Preview Section */}
              {newMessage.target_type === 'status' && (
                <div className="w-full lg:w-[320px] shrink-0 border-l border-slate-100 pl-0 lg:pl-8 py-4 lg:py-0">
                  <div className="text-center mb-4">
                    <p className="text-xs font-bold uppercase text-slate-400 flex items-center justify-center gap-2">
                      <Smartphone size={14} /> Preview do Status
                    </p>
                  </div>
                  <div className="bg-slate-50 rounded-3xl p-4 border border-slate-100">
                    {newMessage.media_url ? (
                      <StatusPreview 
                        mediaUrl={newMessage.media_url} 
                        mediaType={newMessage.media_type} 
                        caption={newMessage.message} 
                      />
                    ) : (
                      <div className="aspect-[9/16] bg-slate-200 rounded-2xl flex flex-col items-center justify-center text-slate-400 gap-3 border-2 border-dashed border-slate-300">
                        <ImageIcon size={48} strokeWidth={1} />
                        <p className="text-sm font-medium">Anexe uma mídia para ver o preview</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-6 border-t border-slate-100">
              <Button variant="ghost" onClick={cancelEdit}>Cancelar</Button>
              {!editingId && newMessage.target_type === "status" &&
                <Button variant="outline" disabled={savingSchedule || uploadingMedia} onClick={() => void handleAdd(true)}>Publicar agora</Button>}
              <Button onClick={() => void handleAdd()} disabled={savingSchedule || uploadingMedia} className={cn(newMessage.target_type === 'status' ? "bg-purple-600 hover:bg-purple-700" : "bg-emerald-600 hover:bg-emerald-700")}>
                {editingId ? "Atualizar Agendamento" : newMessage.target_type === 'status' ? "Agendar Status" : "Agendar Mensagem"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl border border-dashed border-slate-200 text-slate-400 space-y-4">
            <CalendarIcon size={48} strokeWidth={1} />
            <div className="text-center">
              <p className="font-medium">Nenhum agendamento</p>
              <p className="text-sm">Programe mensagens para enviar depois.</p>
            </div>
            <Button variant="outline" onClick={() => setIsAdding(true)}>Agendar Agora</Button>
          </div>
        ) : (
          messages.map((msg) => (
            <Card key={msg.id} className={cn("transition-all", msg.status !== 'pending' && "opacity-60")}>
              <CardContent className="p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={cn(
                      "h-12 w-12 rounded-2xl flex items-center justify-center shrink-0",
                      msg.status === 'pending' ? "bg-amber-100 text-amber-600" : 
                      msg.status === 'sent' ? "bg-emerald-100 text-emerald-600" : 
                      "bg-red-100 text-red-600"
                    )}>
                      {msg.status === 'pending' ? <Clock size={24} /> : 
                       msg.status === 'sent' ? <Send size={24} /> : 
                       <AlertCircle size={24} />}
                    </div>
                    <div className="min-w-0">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-bold text-slate-900 truncate">
                            {msg.target_type === 'status' ? "Postar no Status" : msg.target_type === "group" ? msg.group_name || "Anúncio de grupo" : `Para: ${msg.contact_name}`}
                          </h3>
                          {msg.target_type === 'status' && (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                              <Sparkles size={10} /> Status
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="flex items-center gap-1 font-medium text-slate-700">
                            <CalendarIcon size={12} />
                            {new Date(msg.scheduled_at).toLocaleString("pt-MZ", { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span>•</span>
                          <span className={cn(
                            "uppercase font-bold tracking-wider text-[10px]",
                            msg.status === 'pending' ? "text-amber-600" : 
                            msg.status === 'sent' ? "text-emerald-600" : 
                            "text-red-600"
                          )}>
                            {msg.status === 'pending' ? 'Pendente' : 
                             msg.status === 'sent' ? 'Enviado' : msg.status === 'processing' ? 'A processar / por confirmar' : 'Falhou'}
                          </span>
                        </div>
                        {Boolean(msg.repeat_days) && <p className="text-sm text-slate-600">{msg.repeat_days === 1 ? "Diário" : "Semanal"}</p>}
                        {msg.error && <p className="text-sm text-slate-600">{msg.error}</p>}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {msg.status === 'pending' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                        onClick={() => handleSendNow(msg)}
                        title="Enviar agora"
                      >
                        <Send size={14} />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                      onClick={() => handleEdit(msg)}
                      disabled={msg.status !== "pending"}
                      title="Editar"
                    >
                      <Settings2 size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50"
                      onClick={() => handleDelete(msg.id, msg.target_type)}
                      disabled={msg.status === "processing"}
                      title="Excluir"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
                <div className="mt-4 p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <p className="text-sm text-slate-600 line-clamp-2 italic">
                    {msg.target_type === 'status' ? (msg.message || "Sem legenda") : `"${msg.message}"`}
                  </p>
                  
                  {msg.media_url && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 w-fit px-2 py-1 rounded-md border border-emerald-100">
                      {msg.media_type === 'image' && <ImageIcon size={12} />}
                      {msg.media_type === 'video' && <Smartphone size={12} />}
                      {msg.media_type === 'audio' && <Music size={12} />}
                      {msg.media_type === 'document' && <FileText size={12} />}
                      <span>{msg.target_type === 'status' ? "Mídia do Status" : "Mídia Anexada"}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
