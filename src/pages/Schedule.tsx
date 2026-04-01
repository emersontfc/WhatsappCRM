import { useState, useEffect, useRef } from "react";
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
  AlertCircle,
  Upload,
  Settings2
} from "lucide-react";
import { toast } from "sonner";
import { supabase, getUserId, isAdmin as checkIsAdmin } from "../supabase";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/Card";
import { cn } from "../lib/utils";
import { useActivation } from "../lib/useActivation";
import { UpgradePrompt } from "../components/UpgradePrompt";

interface ScheduledMessage {
  id: string;
  contact_id: string;
  contact_name: string;
  message: string;
  media_url?: string;
  media_type?: string;
  scheduled_at: string;
  status: "pending" | "sent" | "failed";
  created_at: string;
}

interface Contact {
  id: string;
  name: string;
  phone: string;
  tags: string[];
}

export default function Schedule() {
  const [messages, setMessages] = useState<ScheduledMessage[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const { isActivated, planDetails, loading: activationLoading } = useActivation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  
  const [newMessage, setNewMessage] = useState<Partial<ScheduledMessage>>({
    contact_id: "",
    contact_name: "",
    message: "",
    media_url: "",
    media_type: "",
    scheduled_at: new Date(Date.now() + 3600000).toISOString().slice(0, 16)
  });

  useEffect(() => {
    if (activationLoading) return;
    const init = async () => {
      const userId = await getUserId();
      if (!userId) {
        setLoading(false);
        return;
      }

      // Fetch contacts for dropdown
      const { data: contactsData } = await supabase
        .from("contacts")
        .select("id, name, phone, tags")
        .eq("user_id", userId)
        .order("name", { ascending: true });
      
      if (contactsData) {
        // Show contacts that are Manual, Imported, or NOT from WhatsApp
        const manualContacts = contactsData
          .map(c => ({ ...c, tags: Array.isArray(c.tags) ? c.tags : [] }))
          .filter(c => {
            const tags = c.tags;
            // Show if it's explicitly manual/imported OR if it doesn't have the WhatsApp tag
            return tags.includes("Manual") || tags.includes("Importado") || !tags.includes("WhatsApp");
          });
        setContacts(manualContacts);
      }

      // Fetch scheduled messages
      const { data: messagesData } = await supabase
        .from("scheduled_messages")
        .select("*")
        .eq("user_id", userId)
        .order("scheduled_at", { ascending: true });
      
      if (messagesData) setMessages(messagesData);
      setLoading(false);

      // Real-time subscription
      const channel = supabase
        .channel(`scheduled-${userId}`)
        .on('postgres_changes', { 
          event: '*', 
          schema: 'public', 
          table: 'scheduled_messages',
          filter: `user_id=eq.${userId}`
        }, (payload) => {
          if (payload.eventType === 'INSERT') {
            setMessages(prev => [...prev, payload.new as ScheduledMessage].sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()));
          } else if (payload.eventType === 'UPDATE') {
            setMessages(prev => prev.map(m => m.id === payload.new.id ? payload.new as ScheduledMessage : m));
          } else if (payload.eventType === 'DELETE') {
            setMessages(prev => prev.filter(m => m.id !== payload.old.id));
          }
        })
        .subscribe();

      // Contacts subscription to update dropdown
      const contactsChannel = supabase
        .channel(`contacts-${userId}`)
        .on('postgres_changes', { 
          event: '*', 
          schema: 'public', 
          table: 'contacts',
          filter: `user_id=eq.${userId}`
        }, async () => {
          const { data: updatedContacts } = await supabase
            .from("contacts")
            .select("id, name, phone, tags")
            .eq("user_id", userId)
            .order("name", { ascending: true });
          
          if (updatedContacts) {
            const manualContacts = updatedContacts
              .map(c => ({ ...c, tags: Array.isArray(c.tags) ? c.tags : [] }))
              .filter(c => {
                const tags = c.tags;
                return tags.includes("Manual") || tags.includes("Importado") || !tags.includes("WhatsApp");
              });
            setContacts(manualContacts);
          }
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
        supabase.removeChannel(contactsChannel);
      };
    };

    let cleanup: any;
    init().then(c => cleanup = c);
    return () => {
      if (cleanup) cleanup();
    };
  }, [activationLoading]);

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
    if (!newMessage.contact_id || !newMessage.message || !newMessage.scheduled_at) {
      toast.error("Preencha o contato, a mensagem e a data/hora.");
      return;
    }

    const scheduledDate = new Date(newMessage.scheduled_at);
    if (scheduledDate <= new Date()) {
      toast.error("A data/hora de agendamento deve ser no futuro.");
      return;
    }
    
    try {
      const userId = await getUserId();
      if (!userId) throw new Error("Usuário não identificado.");
      
      const selectedContact = contacts.find(c => c.id === newMessage.contact_id);

      if (editingId) {
        const { data, error } = await supabase
          .from("scheduled_messages")
          .update({
            ...newMessage,
            contact_name: selectedContact?.name || "Desconhecido",
            phone: selectedContact?.phone || "",
            text: newMessage.message || "",
            user_id: userId,
            status: "pending",
            scheduled_at: scheduledDate.toISOString(),
          })
          .eq("id", editingId)
          .select()
          .single();

        if (error) throw error;

        setMessages(prev => prev.map(m => m.id === editingId ? data : m).sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()));
        toast.success("Agendamento atualizado com sucesso!");
      } else {
        const { data, error } = await supabase.from("scheduled_messages").insert({
          ...newMessage,
          contact_name: selectedContact?.name || "Desconhecido",
          phone: selectedContact?.phone || "", // Satisfy old DB constraint
          text: newMessage.message || "", // Satisfy old DB constraint
          user_id: userId,
          status: "pending",
          scheduled_at: scheduledDate.toISOString(),
        }).select().single();

        if (error) throw error;

        if (data) {
          setMessages(prev => [...prev, data].sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()));
        }
        toast.success("Mensagem agendada com sucesso!");
      }

      setIsAdding(false);
      setEditingId(null);
      setNewMessage({
        contact_id: "",
        contact_name: "",
        message: "",
        media_url: "",
        media_type: "",
        scheduled_at: new Date(Date.now() + 3600000).toISOString().slice(0, 16)
      });
    } catch (err: any) {
      console.error("Error saving scheduled message:", err);
      toast.error(err.message || "Erro ao salvar agendamento.");
    }
  };

  const handleEdit = (msg: ScheduledMessage) => {
    if (msg.status !== 'pending') {
      toast.error("Apenas agendamentos pendentes podem ser editados.");
      return;
    }

    setNewMessage({
      contact_id: msg.contact_id,
      contact_name: msg.contact_name,
      message: msg.message,
      media_url: msg.media_url,
      media_type: msg.media_type,
      scheduled_at: new Date(msg.scheduled_at).toISOString().slice(0, 16)
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
      scheduled_at: new Date(Date.now() + 3600000).toISOString().slice(0, 16)
    });
  };

  const handleDelete = async (id: string) => {
    const original = [...messages];
    setMessages(prev => prev.filter(m => m.id !== id));

    try {
      const { error } = await supabase
        .from("scheduled_messages")
        .delete()
        .eq("id", id);
      if (error) throw error;
      toast.success("Agendamento excluído.");
    } catch (err) {
      console.error("Failed to delete scheduled message:", err);
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

  return (
    <div className="space-y-8">
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
              GMT+2 África/Harare
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-500">Contato</label>
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
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-500">Data e Hora</label>
                <Input 
                  type="datetime-local"
                  value={newMessage.scheduled_at}
                  onChange={e => setNewMessage({...newMessage, scheduled_at: e.target.value})}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-slate-500">Mensagem</label>
              <textarea 
                className="flex min-h-[100px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                placeholder="Digite a mensagem que será enviada..."
                value={newMessage.message}
                onChange={e => setNewMessage({...newMessage, message: e.target.value})}
              />
            </div>

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

                {newMessage.media_url && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-md text-sm border border-emerald-200">
                    {newMessage.media_type === 'image' && <ImageIcon size={14} />}
                    {newMessage.media_type === 'audio' && <Music size={14} />}
                    {newMessage.media_type === 'document' && <FileText size={14} />}
                    <span className="truncate max-w-[200px]">Mídia anexada</span>
                    <button 
                      type="button"
                      onClick={() => setNewMessage(prev => ({ ...prev, media_url: "", media_type: "" }))}
                      className="ml-2 text-emerald-600 hover:text-emerald-800"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="ghost" onClick={cancelEdit}>Cancelar</Button>
              <Button onClick={handleAdd}>{editingId ? "Atualizar Agendamento" : "Agendar Mensagem"}</Button>
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
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
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
                      <h3 className="font-bold text-slate-900 truncate">Para: {msg.contact_name}</h3>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span className="flex items-center gap-1 font-medium text-slate-700">
                          <CalendarIcon size={12} />
                          {new Date(msg.scheduled_at).toLocaleString()}
                        </span>
                        <span>•</span>
                        <span className={cn(
                          "uppercase font-bold tracking-wider text-[10px]",
                          msg.status === 'pending' ? "text-amber-600" : 
                          msg.status === 'sent' ? "text-emerald-600" : 
                          "text-red-600"
                        )}>
                          {msg.status === 'pending' ? 'Pendente' : 
                           msg.status === 'sent' ? 'Enviado' : 'Falhou'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {msg.status === 'pending' && (
                      <Button 
                        variant="ghost" 
                        size="icon"
                        className="text-slate-500 hover:bg-slate-50"
                        onClick={() => handleEdit(msg)}
                      >
                        <Settings2 size={18} />
                      </Button>
                    )}
                    <Button 
                      variant="ghost" 
                      size="icon"
                      className="text-red-500 hover:bg-red-50"
                      onClick={() => handleDelete(msg.id)}
                    >
                      <Trash2 size={18} />
                    </Button>
                  </div>
                </div>
                <div className="mt-4 p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <p className="text-sm text-slate-600 line-clamp-2 italic">"{msg.message}"</p>
                  
                  {msg.media_url && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 w-fit px-2 py-1 rounded-md border border-emerald-100">
                      {msg.media_type === 'image' && <ImageIcon size={12} />}
                      {msg.media_type === 'audio' && <Music size={12} />}
                      {msg.media_type === 'document' && <FileText size={12} />}
                      <span>Mídia Anexada</span>
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
