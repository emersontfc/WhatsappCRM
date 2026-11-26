import { WhatsAppOperatorCard } from "../components/WhatsAppOperatorCard";
import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import { VoicePreview } from "../components/VoicePreview";
import { StatusPreview } from "../components/StatusPreview";
import { toast } from "sonner";
import { supabase, getUserId, isAdmin as checkIsAdmin } from "../supabase";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/Card";
import { cn } from "../lib/utils";
import { useActivation } from "../lib/useActivation";
import { ApiError, apiFetch, resolveApiUrl } from "../lib/api";
import { uploadVoiceAudio } from "../lib/voiceAudio";
import { isAudioAttachment, WHATSAPP_VOICE_MIME } from "../../shared/voiceAudio";
import { importContactsCsv } from "../lib/contactImport";
import { UpgradePrompt } from "../components/UpgradePrompt";

interface ScheduledMessage {
  id: string;
  contact_id: string;
  contact_name: string;
  phone?: string;
  message: string;
  media_url?: string;
  media_type?: string;
  media_mimetype?: string;
  media_filename?: string;
  reply_to_message_id?: string | null;
  campaign_id?: string | null;
  scheduled_at: string;
  retry_at?: string | null;
  attempts?: number;
  source_table?: "scheduled_messages" | "scheduled_status";
  repeat_zone?: string | null;
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
  phone: string | null;
}

type AgendaData = {
  contacts: Contact[] | null;
  messages: ScheduledMessage[] | null;
  statuses: Array<ScheduledMessage & { caption?: string }> | null;
  warnings: string[];
  schedulerEnabled: boolean;
};

function agendaErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 401) return "A sessão expirou. Volta a entrar no AgentX.";
  return error instanceof Error ? error.message : "Não foi possível concluir a operação na Agenda.";
}

function mediaPreview(url: string | undefined) {
  return url?.startsWith("/uploads/") ? resolveApiUrl(url) : url;
}

export default function Schedule() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedType = searchParams.get("new");
  const requestedGroup = searchParams.get("group");
  const [messages, setMessages] = useState<ScheduledMessage[]>([]);
  const [groups, setGroups] = useState<Array<{ id: string; subject: string }>>([]);
  const [groupError, setGroupError] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [agendaWarnings, setAgendaWarnings] = useState<string[]>([]);
  const [automaticSendDisabled, setAutomaticSendDisabled] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const requestKey = useRef<string | undefined>(undefined);
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
    if (requestedType !== "group" && requestedType !== "status" && requestedType !== "contact") return;
    const group = requestedType === "group" && requestedGroup && /^\d+(?:-\d+)?@g\.us$/.test(requestedGroup)
      ? requestedGroup : undefined;
    setNewMessage((previous) => ({ ...previous, target_type: requestedType, group_jid: group }));
    setIsAdding(true);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("new");
      next.delete("group");
      return next;
    }, { replace: true });
  }, [requestedType, requestedGroup, setSearchParams]);

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
    const controller = new AbortController();
    let busy = false;
    let channel: ReturnType<typeof supabase.channel> | undefined;
    const sync = async () => {
      if (controller.signal.aborted || busy || document.hidden) return;
      busy = true;
      try {
        const result = await apiFetch("/api/schedule", { signal: controller.signal, timeout: 15000 });
        if (controller.signal.aborted) return;
        if (result?.success !== true || !result.data) throw new Error("A API não confirmou a consulta da Agenda.");
        const data: AgendaData = result.data;
        const names = new Map(data.contacts?.map((contact) => [contact.id, contact.name || contact.phone]));
        if (data.contacts) setContacts(data.contacts);
        setAutomaticSendDisabled(data.schedulerEnabled === false);
        setAgendaWarnings(data.warnings);
        setMessages((previous) => {
          const previousNames = new Map(previous.map((item) => [item.id, item.contact_name]));
          const messages = data.messages?.map((item): ScheduledMessage => ({
            ...item, source_table: "scheduled_messages", contact_name: names.get(item.contact_id) ??
              item.contact_name ?? previousNames.get(item.id) ?? item.phone ?? "Contacto"
          })) ?? previous.filter((item) => item.source_table === "scheduled_messages");
          const statuses = data.statuses?.map((item): ScheduledMessage => ({
            ...item, target_type: "status", source_table: "scheduled_status", message: item.caption ?? "",
            contact_name: "WhatsApp Status", contact_id: "status"
          })) ?? previous.filter((item) => item.source_table === "scheduled_status");
          return [...messages, ...statuses].sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at));
        });
      } catch (error) {
        if (!controller.signal.aborted) setAgendaWarnings([agendaErrorMessage(error)]);
      } finally {
        busy = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void sync();
    const poll = window.setInterval(sync, 10000);
    document.addEventListener("visibilitychange", sync);
    void getUserId().then((userId) => {
      if (controller.signal.aborted || !userId || userId === "guest-user") return;
      channel = supabase.channel(`agenda-${userId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "scheduled_messages", filter: `user_id=eq.${userId}` }, sync)
        .on("postgres_changes", { event: "*", schema: "public", table: "scheduled_status", filter: `user_id=eq.${userId}` }, sync)
        .subscribe();
    }).catch(() => { /* API polling remains available. */ });
    return () => {
      controller.abort();
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", sync);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [activationLoading, refreshVersion]);

  const handleImportCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await importContactsCsv(file);
      if (result.warning) toast.warning(result.message);
      else toast.success(result.message);
      refreshAgenda();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível importar os contactos.");
    } finally {
      if (csvInputRef.current) csvInputRef.current.value = "";
    }
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
      if (isAudioAttachment(file.type, file.name)) {
        if (newMessage.target_type !== "contact") throw new Error("A nota de voz pode ser agendada para um contacto direto.");
        const audio = await uploadVoiceAudio(file, file.name);
        setNewMessage((previous) => ({ ...previous, media_url: audio.url, media_type: "audio",
          media_filename: file.name, media_mimetype: audio.mimetype }));
        toast.success("Áudio anexado");
        return;
      }

      const userId = await getUserId();
      if (!userId || userId === "guest-user") throw new Error("Inicia sessão para guardar o agendamento.");

      const fileExt = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").slice(0, 10) || "bin";
      const fileName = `${userId}/${crypto.randomUUID()}.${fileExt}`;

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

    if (newMessage.target_type === "group" && (!newMessage.group_jid || (!newMessage.message?.trim() && !newMessage.media_url))) {
      toast.error("Seleciona um grupo e adiciona texto ou um ficheiro.");
      return;
    }
    if (newMessage.target_type === "group" && !groups.some((group) => group.id === newMessage.group_jid)) {
      toast.error("O grupo precisa de estar disponível na lista do WhatsApp.");
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

    const scheduledDate = publishNow ? new Date() : new Date(newMessage.scheduled_at!);
    if (Number.isNaN(scheduledDate.getTime()) ||
        (!publishNow && formatForDateTimeInput(scheduledDate) !== newMessage.scheduled_at)) {
      setSaveError("Seleciona uma data e hora válida no teu fuso horário.");
      return;
    }
    if (scheduledDate.getTime() < Date.now() - 120000) {
      setSaveError("Seleciona uma data e hora futura.");
      return;
    }

    setSavingSchedule(true);
    setSaveError(null);
    try {
      if (!editingId) requestKey.current ??= crypto.randomUUID();
      const result = await apiFetch(editingId ? `/api/schedule/${editingId}` : "/api/schedule", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify({ ...newMessage, target_type: newMessage.target_type ?? "contact",
          request_key: requestKey.current, scheduled_at: scheduledDate.toISOString(),
          repeat_zone: newMessage.repeat_zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone })
      });
      if (result?.success !== true || typeof result.id !== "string") throw new Error("A API não confirmou a gravação.");
      const createdId = result.id;
      const target = newMessage.target_type;
      cancelEdit();
      refreshAgenda();
      if (publishNow) {
        try {
          await sendNow(createdId, target ?? "status");
          toast.success("Publicação aceite pelo WhatsApp.");
        } catch (error) {
          toast.info(`Status guardado. ${agendaErrorMessage(error)}`);
        } finally {
          refreshAgenda();
        }
      } else {
        toast.success(editingId ? "Agendamento atualizado." : "Agendamento guardado.");
      }
    } catch (error) {
      setSaveError(agendaErrorMessage(error));
    } finally {
      setSavingSchedule(false);
    }
  };

  const sendNow = async (id: string, target: ScheduledMessage["target_type"], source?: ScheduledMessage["source_table"]) => {
    const response = await apiFetch(`/api/schedule/${id}/send`, {
      method: "POST", timeout: 65000,
      body: JSON.stringify({ target_type: target ?? "contact", source_table: source })
    });
    if (response?.success !== true || response.status !== "sent") {
      throw new Error(response?.error || "Envio por confirmar. Verifica a Agenda.");
    }
  };

  const handleSendNow = async (msg: ScheduledMessage) => {
    if (sendingId) return;
    setSendingId(msg.id);
    try {
      toast.loading("A enviar…", { id: `send-${msg.id}` });
      await sendNow(msg.id, msg.target_type, msg.source_table);
      toast.success("Envio aceite pelo WhatsApp.", { id: `send-${msg.id}` });
    } catch (error) {
      toast.error(agendaErrorMessage(error), { id: `send-${msg.id}` });
    } finally {
      setSendingId(null);
      refreshAgenda();
    }
  };

  const handleEdit = (msg: ScheduledMessage) => {
    if (msg.status !== 'pending') {
      toast.error("Apenas agendamentos pendentes podem ser editados.");
      return;
    }
    if (msg.campaign_id) {
      navigate("/seller#campanhas");
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
      reply_to_message_id: msg.reply_to_message_id,
      repeat_days: msg.repeat_days,
      repeat_zone: msg.repeat_zone,
      source_table: msg.source_table,
      group_jid: msg.group_jid,
      group_name: msg.group_name,
      target_type: msg.target_type || "contact",
      scheduled_at: formatForDateTimeInput(new Date(msg.scheduled_at))
    });
    setSaveError(null);
    setEditingId(msg.id);
    setIsAdding(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEdit = () => {
    requestKey.current = undefined;
    setSaveError(null);
    setIsRecording(false);
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

  const handleDelete = async (msg: ScheduledMessage) => {
    const query = new URLSearchParams({ target_type: msg.target_type ?? "contact" });
    if (msg.source_table) query.set("source_table", msg.source_table);
    try {
      await apiFetch(`/api/schedule/${msg.id}?${query}`, { method: "DELETE" });
      toast.success("Agendamento removido.");
    } catch (error) {
      toast.error(agendaErrorMessage(error));
    } finally {
      refreshAgenda();
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
      {agendaWarnings.length > 0 && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        {agendaWarnings.map((warning) => <p key={warning}>{warning}</p>)}
        <Button variant="outline" size="sm" className="mt-2" onClick={refreshAgenda}>Atualizar agenda</Button>
      </div>}
      {automaticSendDisabled && <p role="status" className="text-sm text-amber-800">O envio automático está desligado. Ainda podes enviar um agendamento manualmente.</p>}
      {planDetails && contacts.length >= planDetails.max_contacts && (
        <UpgradePrompt 
          title="Limite de Contatos Atingido"
          description={`Você atingiu o limite de ${planDetails.max_contacts} contatos do seu plano atual. Você não poderá importar novos contatos.`}
        />
      )}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Mensagens e publicações</h2>
          <div className="flex items-center gap-2 text-slate-500">
            <p>Agenda mensagens, Status e anúncios de grupo no WhatsApp.</p>
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
                      disabled={Boolean(editingId && newMessage.target_type !== 'contact')}
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
                      onClick={() => {
                        setIsRecording(false);
                        setNewMessage((previous) => ({ ...previous, target_type: "status", contact_id: "",
                          ...(!["image", "video"].includes(previous.media_type ?? "")
                            ? { media_url: "", media_type: "", media_filename: "", media_mimetype: "" } : {}) }));
                      }}
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
                    <button type="button" disabled={Boolean(editingId && newMessage.target_type !== "group")}
                      onClick={() => { setIsRecording(false); setNewMessage((previous) => ({ ...previous, target_type: "group",
                        ...(previous.media_type === "audio" ? { media_url: "", media_type: "", media_filename: "", media_mimetype: "" } : {}) })); }}
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
                        disabled={Boolean(newMessage.reply_to_message_id)}
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

                {newMessage.reply_to_message_id && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-900">
                    <span>Esta resposta inclui uma citação. Retira-a para mudar o contacto ou anexar um ficheiro.</span>
                    <Button type="button" variant="outline" size="sm" onClick={() =>
                      setNewMessage((current) => ({ ...current, reply_to_message_id: null }))}>Retirar citação</Button>
                  </div>
                )}

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
                        setNewMessage(prev => ({ ...prev, media_url: url, media_type: "audio", media_filename: "nota-de-voz.ogg", media_mimetype: WHATSAPP_VOICE_MIME }));
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

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-500">
                    {newMessage.target_type === "status" ? "Imagem ou vídeo"
                      : newMessage.target_type === "group" ? "Imagem, vídeo ou documento" : "Imagem, vídeo, documento ou áudio"}
                  </label>
                  <div className="flex items-center gap-4 flex-wrap">
                    <input 
                      type="file" 
                      ref={fileInputRef}
                      className="hidden" 
                      accept={newMessage.target_type === "status" ? "image/*,video/*"
                        : `image/*,video/*,${newMessage.target_type === "contact" ? "audio/*," : ""}application/pdf,.pdf,.doc,.docx,.xls,.xlsx`}
                      onChange={handleFileUpload}
                    />
                    <Button 
                      type="button" 
                      variant="outline" 
                      className="gap-2"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingMedia || isRecording || Boolean(newMessage.reply_to_message_id)}
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
                        disabled={uploadingMedia || Boolean(newMessage.reply_to_message_id)}
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
                    <VoicePreview url={newMessage.media_url} legacyUrl={mediaPreview(newMessage.media_url)} />}
                  {newMessage.target_type === 'status' && newMessage.media_type === 'video' && (
                    <p className="text-[10px] text-amber-600 font-medium flex items-center gap-1 mt-1">
                      <AlertCircle size={10} /> O WhatsApp corta vídeos no status em 30 segundos.
                    </p>
                  )}
                </div>
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
                        mediaUrl={mediaPreview(newMessage.media_url)}
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

            <div className="border-t border-slate-100 pt-6">
              {saveError && <p role="alert" className="mb-3 text-sm font-medium text-red-700">{saveError}</p>}
              <div className="flex flex-wrap justify-end gap-3">
                <Button variant="ghost" disabled={savingSchedule} onClick={cancelEdit}>Cancelar</Button>
                {!editingId && newMessage.target_type === "status" &&
                  <Button variant="outline" disabled={savingSchedule || uploadingMedia} onClick={() => void handleAdd(true)}>Publicar agora</Button>}
                <Button onClick={() => void handleAdd()} disabled={savingSchedule || uploadingMedia} className={cn(newMessage.target_type === 'status' ? "bg-purple-600 hover:bg-purple-700" : "bg-emerald-600 hover:bg-emerald-700")}>
                  {editingId ? "Atualizar Agendamento" : newMessage.target_type === 'status' ? "Agendar Status" : "Agendar Mensagem"}
                </Button>
              </div>
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
                        {msg.reply_to_message_id && <p className="text-xs text-slate-600">Resposta citada</p>}
                        {msg.campaign_id && <p className="text-xs text-slate-600">Campanha do catálogo</p>}
                        {msg.error && <p className="text-sm text-slate-600">{msg.error}</p>}
                        {msg.status === "pending" && msg.retry_at && <p className="text-xs text-slate-600">
                          Próxima tentativa {new Date(msg.retry_at).toLocaleString("pt-MZ")}
                        </p>}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {msg.status === 'pending' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                        onClick={() => handleSendNow(msg)} disabled={sendingId !== null}
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
                      title={msg.campaign_id ? "Editar no Vendedor" : "Editar"}
                    >
                      <Settings2 size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50"
                      onClick={() => handleDelete(msg)}
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
